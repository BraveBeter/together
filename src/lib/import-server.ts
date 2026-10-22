import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as s from "../db/schema";
import { CatalogRateLimitError, catalogRefSchema, getCatalogCover, getCatalogItem, searchCatalog, mergeCatalogResults } from "./catalog-server";
import { type CatalogItem, type CatalogRef, sameCatalogItem } from "./catalog-metadata";
import { storeAsset } from "./assets";
import { createSharedEntry, findCatalogEntry, getEntry, InputError, ConflictError, personalWhere, writePersonal } from "./records";
import { readData, updateMilestones } from "./data";
import { pendingRecommendation } from "./domain";
import { exactCandidates, matchText, needsExpansion, validateImportInput, csvCell } from "./import-parser";
import type { ImportBatch, ImportExpected, ImportInput, ImportItem, ImportSummary } from "./import-types";
import type { Kind, Member, Status } from "./types";

type RawItem = { id: string; batch_id: string; position: number; input: string; state: ImportItem["state"]; selected: number; candidates: string; catalog: string | null; expected: string | null; entry_id: string | null; outcome: string; warning: string; error: string; revision: number; lease_until: number; retry_at: number; new_work: number };
function decode(r: RawItem): ImportItem {
  return { id: r.id, batchId: r.batch_id, position: r.position, input: JSON.parse(r.input), state: r.state, selected: !!r.selected, candidates: JSON.parse(r.candidates), catalog: r.catalog ? JSON.parse(r.catalog) : null, expected: r.expected ? JSON.parse(r.expected) : null, entryId: r.entry_id, outcome: r.outcome, warning: r.warning, error: r.error, revision: r.revision, leaseUntil: r.lease_until, retryAt: r.retry_at, newWork: !!r.new_work };
}
function owner(member: Member, batchId: string) {
  const batch = sqlite.prepare("SELECT id, kind, label, created_at AS createdAt, updated_at AS updatedAt FROM import_batches WHERE id=? AND user_id=?").get(batchId, member.id) as Omit<ImportBatch, "items"> | undefined;
  if (!batch) throw new InputError("找不到这份导入任务，或它不属于当前账户。");
  return batch;
}
function itemFor(member: Member, batchId: string, itemId: string) {
  owner(member, batchId);
  const item = sqlite.prepare("SELECT * FROM import_items WHERE id=? AND batch_id=?").get(itemId, batchId) as RawItem | undefined;
  if (!item) throw new InputError("导入条目不存在。");
  return decode(item);
}
function touch(batchId: string) { sqlite.prepare("UPDATE import_batches SET updated_at=MAX(updated_at+1,?) WHERE id=?").run(Date.now(), batchId); }
export function listImports(member: Member, all = false): ImportSummary[] {
  return sqlite.prepare("SELECT b.id, b.kind, b.label, b.created_at AS createdAt, b.updated_at AS updatedAt, COUNT(i.id) AS total, SUM(CASE WHEN i.state IN ('done','skipped') THEN 1 ELSE 0 END) AS done FROM import_batches b LEFT JOIN import_items i ON i.batch_id=b.id WHERE b.user_id=? GROUP BY b.id ORDER BY b.updated_at DESC LIMIT ?").all(member.id, all ? -1 : 50) as ImportSummary[];
}
export function getImport(member: Member, id: string): ImportBatch {
  const batch = owner(member, id);
  return { ...batch, items: (sqlite.prepare("SELECT * FROM import_items WHERE batch_id=? ORDER BY position").all(id) as RawItem[]).map(decode) };
}
export function createImport(member: Member, kind: Kind, inputs: ImportInput[], label = "", id: string = randomUUID()) {
  if (!["movie", "book"].includes(kind) || !inputs.length || inputs.length > 500) throw new InputError("每批需要 1–500 条电影或书籍。");
  const parsed = inputs.map(row => validateImportInput(row, kind));
  return sqlite.transaction(() => {
    const previous = sqlite.prepare("SELECT user_id FROM import_batches WHERE id=?").get(id) as { user_id: string } | undefined;
    if (previous) { owner(member, id); return getImport(member, id); }
    const now = Date.now();
    sqlite.prepare("INSERT INTO import_batches(id,user_id,kind,label,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, member.id, kind, label.trim().slice(0, 100) || `${kind === "movie" ? "电影" : "书单"} · ${inputs.length} 条`, now, now);
    const insert = sqlite.prepare("INSERT INTO import_items(id,batch_id,position,input) VALUES(?,?,?,?)");
    parsed.forEach((row, position) => insert.run(randomUUID(), id, position + 1, JSON.stringify(row)));
    return getImport(member, id);
  })();
}
function currentExpected(entryId: string, member: Member): ImportExpected {
  const entry = db.select().from(s.entries).where(eq(s.entries.id, entryId)).get();
  if (!entry) throw new InputError("作品不存在。");
  const record = db.select().from(s.personalRecords).where(personalWhere(entryId, member.id)).get();
  return { entryId, entryRevision: entry.revision, recordRevision: record?.revision ?? 0 };
}
function sameTitleLegacy(item: CatalogItem) {
  return db.select().from(s.entries).all().filter(e => !e.metadata && e.kind === item.ref.kind && matchText(e.title) === matchText(item.title));
}
function stage(member: Member, row: ImportItem, catalog: CatalogItem, explicitId?: string | null, newWork = false) {
  const strong = findCatalogEntry(catalog);
  const entry = strong ?? (explicitId ? db.select().from(s.entries).where(eq(s.entries.id, explicitId)).get() : undefined);
  if (entry && (entry.kind !== catalog.ref.kind || (explicitId && !strong && matchText(entry.title) !== matchText(catalog.title)))) throw new InputError("只能复用同类型、同名的已有作品。");
  const record = entry ? db.select().from(s.personalRecords).where(personalWhere(entry.id, member.id)).get() : undefined;
  const recycled = !!entry?.deletedAt || !!record?.removedAt;
  const ambiguous = !entry && !newWork && sameTitleLegacy(catalog).length > 0;
  const state = recycled || ambiguous ? "confirm" : entry ? "existing" : "ready";
  const error = recycled ? "作品或你的记录在回收站。请先恢复，再重新检查此项。" : ambiguous ? "空间里有同名手动资料，请选择复用已有作品，或确认是不同作品。" : "";
  sqlite.prepare("UPDATE import_items SET catalog=?, expected=?, state=?, selected=?, error=?, warning='', retry_at=0, new_work=?, revision=revision+1 WHERE id=?").run(JSON.stringify(catalog), entry ? JSON.stringify(currentExpected(entry.id, member)) : null, state, state === "ready" || state === "existing" ? 1 : 0, error, +newWork, row.id);
}
function assertEditable(row: ImportItem, revision: number) {
  if (row.revision !== revision || row.leaseUntil > Date.now()) throw new ConflictError("这项导入已在处理或被其他页面修改，请加载最新结果。");
  if (row.state === "done") throw new InputError("此项已导入，请在作品详情修改个人记录。");
}
export async function chooseImport(member: Member, batchId: string, itemId: string, revision: number, ref: CatalogRef, existingId?: string | null, newWork = false) {
  const batch = owner(member, batchId), row = itemFor(member, batchId, itemId); assertEditable(row, revision);
  ref = catalogRefSchema.parse(ref); if (ref.kind !== batch.kind) throw new InputError("作品类型不匹配。");
  const item = await getCatalogItem(ref);
  sqlite.transaction(() => { assertEditable(itemFor(member, batchId, itemId), revision); stage(member, row, item, existingId, newWork); touch(batchId); })();
  return itemFor(member, batchId, itemId);
}
export function editImport(member: Member, batchId: string, itemId: string, revision: number, command: "select" | "skip" | "retry" | "edit", input?: ImportInput, selected?: boolean) {
  return sqlite.transaction(() => {
    const batch = owner(member, batchId), row = itemFor(member, batchId, itemId); assertEditable(row, revision);
    if (command === "select") {
      if (!["ready", "existing"].includes(row.state)) throw new InputError("请先确认作品资料。");
      sqlite.prepare("UPDATE import_items SET selected=?, revision=revision+1 WHERE id=?").run(+!!selected, itemId);
    } else if (command === "skip") sqlite.prepare("UPDATE import_items SET state='skipped',selected=0,outcome='手动跳过',error='',revision=revision+1 WHERE id=?").run(itemId);
    else if (command === "edit" && input) {
      const parsed = validateImportInput(input, batch.kind);
      const identityUnchanged = ["title", "creator", "year", "isbn"].every(key => parsed[key as keyof ImportInput] === row.input[key as keyof ImportInput]);
      sqlite.prepare("UPDATE import_items SET input=?,revision=revision+1 WHERE id=?").run(JSON.stringify(parsed), itemId);
      if (identityUnchanged && row.catalog) stage(member, row, row.catalog, row.expected?.entryId, row.newWork);
      else sqlite.prepare("UPDATE import_items SET state='pending',catalog=NULL,candidates='[]',expected=NULL,new_work=0,selected=0,error='',warning='',retry_at=0 WHERE id=?").run(itemId);
    } else if (command === "retry") {
      if (row.catalog) stage(member, row, row.catalog, row.expected?.entryId, row.newWork);
      else sqlite.prepare("UPDATE import_items SET state='pending',error='',warning='',retry_at=0,revision=revision+1 WHERE id=?").run(itemId);
    } else throw new InputError("无效的修改。");
    touch(batchId); return itemFor(member, batchId, itemId);
  })();
}
export function setImportStatus(member: Member, batchId: string, updatedAt: number, status: Status) {
  return sqlite.transaction(() => {
    const batch = getImport(member, batchId);
    if (batch.updatedAt !== updatedAt || batch.items.some(i => i.leaseUntil > Date.now())) throw new ConflictError("任务已更新，请加载最新结果后再统一修改。");
    for (const row of batch.items.filter(i => !["done", "skipped"].includes(i.state))) {
      const input = validateImportInput({ ...row.input, status, startedOn: status === "planned" ? null : row.input.startedOn, completedOn: status === "completed" ? row.input.completedOn : null }, batch.kind);
      sqlite.prepare("UPDATE import_items SET input=?,revision=revision+1 WHERE id=?").run(JSON.stringify(input), row.id);
    }
    touch(batchId); return getImport(member, batchId);
  })();
}
function claim(member: Member, batchId: string, itemId: string, operation: "match" | "commit" | "cover") {
  return sqlite.transaction(() => {
    const row = itemFor(member, batchId, itemId);
    if (row.leaseUntil > Date.now() || row.retryAt > Date.now()) return null;
    const eligible = operation === "match" ? row.state === "pending" : operation === "commit" ? ["ready", "existing"].includes(row.state) && row.selected : row.state === "done" && !!row.warning && !!row.catalog && !!row.entryId;
    if (!eligible) return null;
    const lease = Date.now() + 90_000;
    sqlite.prepare("UPDATE import_items SET lease_until=? WHERE id=?").run(lease, itemId);
    return { ...row, leaseUntil: lease };
  })();
}
function verifyClaim(row: ImportItem) {
  const raw = sqlite.prepare("SELECT revision,lease_until FROM import_items WHERE id=?").get(row.id) as { revision: number; lease_until: number };
  if (raw.revision !== row.revision || raw.lease_until !== row.leaseUntil) throw new ConflictError("任务已被其他页面接手，请加载最新结果。");
}
function fillMissing(entryId: string, item: CatalogItem, coverId: string | null) {
  const entry = getEntry(entryId);
  const mergedMetadata = entry.metadata ? { ...entry.metadata,
    identities: [...new Set([...entry.metadata.identities, ...item.metadata.identities])].slice(0, 30),
    originalTitle: entry.metadata.originalTitle || item.metadata.originalTitle,
    isbn: entry.metadata.isbn || item.metadata.isbn, publisher: entry.metadata.publisher || item.metadata.publisher,
    translator: entry.metadata.translator || item.metadata.translator, pages: entry.metadata.pages ?? item.metadata.pages,
    minutes: entry.metadata.minutes ?? item.metadata.minutes, genres: entry.metadata.genres.length ? entry.metadata.genres : item.metadata.genres,
  } : item.metadata;
  const values = { summary: entry.summary || item.summary, coverId: entry.coverId || coverId, metadata: mergedMetadata, links: entry.links.length ? entry.links : item.links };
  const info = entry.kind === "movie" ? db.select().from(s.movies).where(eq(s.movies.entryId, entryId)).get()! : db.select().from(s.books).where(eq(s.books.entryId, entryId)).get()!;
  const creator = "director" in info ? info.director : info.author;
  const detailChanged = !creator && !!item.creator || !info.year && !!item.year;
  if (detailChanged || JSON.stringify([entry.summary, entry.coverId, entry.metadata, entry.links]) !== JSON.stringify([values.summary, values.coverId, values.metadata, values.links])) db.update(s.entries).set({ ...values, revision: entry.revision + 1, updatedAt: Date.now() }).where(eq(s.entries.id, entry.id)).run();
  if (entry.kind === "movie") { const info = db.select().from(s.movies).where(eq(s.movies.entryId, entryId)).get()!; db.update(s.movies).set({ director: info.director || item.creator, year: info.year || item.year }).where(eq(s.movies.entryId, entryId)).run(); }
  else { const info = db.select().from(s.books).where(eq(s.books.entryId, entryId)).get()!; db.update(s.books).set({ author: info.author || item.creator, year: info.year || item.year }).where(eq(s.books.entryId, entryId)).run(); }
}
function syncDerived(member: Member) {
  const data = readData(member);
  for (const r of data.recommendations) if (r.status === "pending" && !pendingRecommendation(r, data.entries.find(e => e.id === r.entryId))) db.update(s.recommendations).set({ status: "resolved", revision: r.revision + 1, updatedAt: Date.now() }).where(and(eq(s.recommendations.id, r.id), eq(s.recommendations.revision, r.revision))).run();
  updateMilestones(member);
}
async function importCover(member: Member, item: CatalogItem) {
  let coverId: string | null = null, warning = "";
  if (item.hasCover) {
    try { const bytes = await getCatalogCover(item.ref); if (bytes) coverId = await storeAsset(bytes, `${item.title}-cover`, member.id); else warning = "信源封面暂不可用，可稍后重试补图。"; }
    catch (e) { if (e instanceof CatalogRateLimitError) throw e; warning = "资料已保存，封面下载失败，可稍后重试补图。"; }
  } else warning = "信源未提供封面，可以稍后上传或重试。";
  return { coverId, warning };
}
export async function processImportItem(member: Member, batchId: string, itemId: string, operation: "match" | "commit" | "cover") {
  const batch = owner(member, batchId), row = claim(member, batchId, itemId, operation);
  if (!row) return itemFor(member, batchId, itemId);
  try {
    if (operation === "match") {
      if (needsExpansion(row.input.title)) {
        sqlite.prepare("UPDATE import_items SET state='confirm',error='请先将系列展开为具体片名，避免误记未看过的续集。',revision=revision+1 WHERE id=?").run(row.id);
      } else {
        let result = await searchCatalog(batch.kind, row.input.isbn || row.input.title);
        if (!row.input.isbn && !exactCandidates(row.input, result.items).length && (row.input.year || row.input.creator)) {
          const refined = await searchCatalog(batch.kind, [row.input.title, row.input.year || row.input.creator].join(" "));
          result = { items: mergeCatalogResults([...result.items, ...refined.items], row.input.title), warning: refined.warning || result.warning };
        }
        const exact = exactCandidates(row.input, result.items);
        sqlite.transaction(() => {
          verifyClaim(row);
          const candidates = [...exact, ...result.items.filter(c => !exact.includes(c))].slice(0, 10).map(c => ({ ...c, summary: c.summary.slice(0, 500) }));
          sqlite.prepare("UPDATE import_items SET candidates=? WHERE id=?").run(JSON.stringify(candidates), row.id);
          if (exact.length === 1 && !result.warning) stage(member, row, exact[0]);
          else sqlite.prepare("UPDATE import_items SET state=?,selected=0,error=?,warning=?,revision=revision+1 WHERE id=?").run(result.items.length ? "confirm" : "not_found", result.items.length ? "请核对年份、作者或版本后选择。" : "没有找到匹配资料，可调整名称或跳过。", result.warning, row.id);
        })();
      }
    } else if (operation === "cover") {
      const item = await getCatalogItem(row.catalog!.ref), entry = getEntry(row.entryId!);
      const image = entry.coverId ? { coverId: entry.coverId, warning: "" } : await importCover(member, item);
      sqlite.transaction(() => { verifyClaim(row); const latest = getEntry(entry.id); if (!latest.coverId && image.coverId) db.update(s.entries).set({ coverId: image.coverId, revision: latest.revision + 1, updatedAt: Date.now() }).where(eq(s.entries.id, entry.id)).run(); sqlite.prepare("UPDATE import_items SET warning=?,error='',revision=revision+1 WHERE id=?").run(image.warning, row.id); })();
    } else {
      if (!row.catalog) throw new InputError("请先选择作品资料。");
      const item = await getCatalogItem(row.catalog.ref);
      if (!sameCatalogItem(item.metadata, row.catalog.metadata) || matchText(item.title) !== matchText(row.catalog.title) || item.year !== row.catalog.year) throw new ConflictError("信源资料发生变化，请重新选择后导入。");
      let existing = findCatalogEntry(item);
      if (!existing && row.expected) existing = db.select().from(s.entries).where(eq(s.entries.id, row.expected.entryId)).get();
      const image = existing?.coverId ? { coverId: existing.coverId, warning: "" } : await importCover(member, item);
      sqlite.transaction(() => {
        verifyClaim(row);
        let entry = findCatalogEntry(item);
        if (!entry && row.expected) entry = db.select().from(s.entries).where(eq(s.entries.id, row.expected.entryId)).get();
        if (entry?.deletedAt) throw new ConflictError("作品在回收站，请先恢复再重新检查。");
        const old = entry ? db.select().from(s.personalRecords).where(personalWhere(entry.id, member.id)).get() : undefined;
        if (old?.removedAt) throw new ConflictError("你的记录在回收站，请先恢复再重新检查。");
        if (row.expected && (!entry || entry.id !== row.expected.entryId || entry.revision !== row.expected.entryRevision || (old?.revision ?? 0) !== row.expected.recordRevision)) throw new ConflictError("作品或个人记录已更新，请重新检查此项；原有输入已保留。");
        if (!row.expected && old && old.status !== row.input.status) throw new ConflictError("另一页面刚刚记录了这部作品，请重新检查。");
        if (!entry && !row.newWork && sameTitleLegacy(item).length) throw new ConflictError("空间里出现了同名作品，请先确认是否复用。");
        const wasNew = !entry, entryId = entry?.id ?? randomUUID();
        if (wasNew) createSharedEntry({ id: entryId, kind: batch.kind, title: item.title, creator: item.creator, year: item.year, summary: item.summary, coverId: image.coverId, metadata: item.metadata, links: item.links, tags: [] });
        else fillMissing(entryId, item, image.coverId);
        let outcome = wasNew ? "新增作品与个人记录" : old ? "更新个人状态" : "复用作品，新增个人记录";
        // Import is additive: do not downgrade completed records or erase existing dates.
        const keep = old?.status === "completed" || old?.status === "in_progress" && row.input.status === "planned";
        if (keep || old?.status === row.input.status && !row.input.startedOn && !row.input.completedOn) outcome = "已在清单，保留原记录";
        else writePersonal(entryId, member.id, old?.revision ?? 0, { status: row.input.status, startedOn: old?.startedOn || row.input.startedOn, completedOn: old?.completedOn || row.input.completedOn, pinned: old?.pinned ?? false });
        sqlite.prepare("UPDATE import_items SET state='done',selected=0,entry_id=?,catalog=?,outcome=?,warning=?,error='',revision=revision+1 WHERE id=?").run(entryId, JSON.stringify(item), outcome, image.warning, row.id);
        syncDerived(member);
      })();
    }
  } catch (e) {
    const raw = sqlite.prepare("SELECT revision,lease_until FROM import_items WHERE id=?").get(row.id) as { revision: number; lease_until: number };
    if (raw.revision === row.revision && raw.lease_until === row.leaseUntil) {
      const error = e instanceof Error ? e.message : "暂时无法处理，请重试。";
      if (e instanceof CatalogRateLimitError) sqlite.prepare("UPDATE import_items SET retry_at=?,error=? WHERE id=?").run(e.retryAt, error, row.id);
      else sqlite.prepare("UPDATE import_items SET state=?,selected=0,error=?,revision=revision+1 WHERE id=?").run(operation === "cover" ? "done" : e instanceof ConflictError ? "confirm" : "failed", error, row.id);
    }
  } finally {
    sqlite.prepare("UPDATE import_items SET lease_until=0 WHERE id=? AND lease_until=?").run(row.id, row.leaseUntil); touch(batchId);
  }
  return itemFor(member, batchId, itemId);
}
export function importReport(batch: ImportBatch) {
  return "\uFEFF" + [["序号", "原始名称", "匹配名称", "年份", "导演/作者", "ISBN", "状态", "处理结果", "说明", "作品ID", "来源"], ...batch.items.map(i => [i.position, i.input.title, i.catalog?.title, i.catalog?.year, i.catalog?.creator, i.catalog?.metadata.isbn, i.input.status, i.outcome || i.state, [i.warning, i.error].filter(Boolean).join("；"), i.entryId, i.catalog?.links[0]?.url])].map(r => r.map(csvCell).join(",")).join("\r\n");
}
