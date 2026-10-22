import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/catalog-server", async original => ({ ...await original<object>(), searchCatalog: vi.fn(), getCatalogItem: vi.fn(), getCatalogCover: vi.fn() }));
import { db, sqlite } from "../src/db";
import * as s from "../src/db/schema";
import { searchCatalog, getCatalogItem, getCatalogCover, normalizeCatalogItem, CatalogRateLimitError } from "../src/lib/catalog-server";
import { createImport, getImport, listImports, chooseImport, editImport, processImportItem, setImportStatus, importReport } from "../src/lib/import-server";
import { parseImport, exactCandidates } from "../src/lib/import-parser";
import { canonicalISBN } from "../src/lib/isbn";
import { createBackup, restoreBackup } from "../src/lib/backup";
import { readData } from "../src/lib/data";
import { writePersonal, personalWhere } from "../src/lib/records";
import { sameCatalogItem, type CatalogItem } from "../src/lib/catalog-metadata";
import { primaryMovieTheme, groupMovies } from "../src/lib/movie-themes";
import type { ImportInput } from "../src/lib/import-types";
import type { Member } from "../src/lib/types";
const a: Member = { id: "bulk-a", name: "成员一", email: "first@test.invalid", seat: 0, color: "#abcdef", avatarId: null }, b: Member = { ...a, id: "bulk-b", name: "成员二", email: "second@test.invalid", seat: 1 };
let catalog: CatalogItem, bytes: Buffer;
const input = (title: string, rest = {}): ImportInput => ({ title, year: 2014, creator: "", isbn: "", status: "completed", startedOn: null, completedOn: null, ...rest });
const make = (rest = {}): CatalogItem => normalizeCatalogItem({ uuid: randomUUID().replaceAll("-", "").slice(0, 22), category: "movie", title: `星河${randomUUID().slice(0, 8)}`, release_date: "2014-11-07", director: ["导演"], description: "客观简介", genre: ["Science Fiction", "Drama"], cover_image_url: "https://film.upstairs.cn/m/test.jpg", ...rest }, "upstairs", rest && "isbn" in rest ? "book" : "movie")!;
async function prepared(member = a, data = input(catalog.title), kind = catalog.ref.kind) { const batch = createImport(member, kind, [data]); const row = await processImportItem(member, batch.id, batch.items[0].id, "match"); return { batch, row }; }
beforeAll(async () => {
  for (const m of [a, b]) { db.insert(s.user).values({ id: m.id, name: m.name, email: m.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() }).run(); db.insert(s.members).values({ userId: m.id, seat: m.seat, color: m.color }).run(); }
  bytes = await sharp({ create: { width: 12, height: 18, channels: 3, background: "#345645" } }).png().toBuffer();
});
beforeEach(() => { catalog = make(); vi.mocked(searchCatalog).mockReset().mockResolvedValue({ items: [catalog], warning: "" }); vi.mocked(getCatalogItem).mockReset().mockImplementation(async () => catalog); vi.mocked(getCatalogCover).mockReset().mockResolvedValue(bytes); });
describe("批量清单解析和主题分类", () => {
  it("书名号与括号内的分隔符保持完整，日期不会自动填入", () => {
    expect(parseImport("《心灵奇旅》、蜘蛛侠(1,2,3)\n《飞屋环游记》 (2009)", "text", "movie", "completed").map(r => [r.title, r.year, r.completedOn])).toEqual([["心灵奇旅", null, null], ["蜘蛛侠(1,2,3)", null, null], ["飞屋环游记", 2009, null]]);
  });
  it("CSV 支持 BOM、引号与跨行内容；验证状态、ISBN 和日期顺序", () => {
    expect(parseImport('\uFEFF名称,年份,导演/作者,ISBN,状态,开始日期,完成日期\r\n"Hello, World",2012,余华,9787506365437,已读,2020-01-01,2020-01-02', "csv", "book", "planned")[0]).toMatchObject({ title: "Hello, World", status: "completed", completedOn: "2020-01-02" });
    expect(() => parseImport("名称,状态\n电影,在读", "csv", "movie", "planned")).toThrow("电影只能");
    expect(() => parseImport("名称,完成日期\n书,2020-01-01", "csv", "book", "planned")).toThrow("完成后");
    expect(() => parseImport("名称,ISBN\n书,9787506365438", "csv", "book", "completed")).toThrow("ISBN");
    expect(() => parseImport('名称\n"没闭合', "csv", "book", "completed")).toThrow("引号");
    expect(parseImport(Array.from({ length: 500 }, (_, i) => `电影${i}`).join("\n"), "text", "movie", "completed")).toHaveLength(500);
    expect(() => parseImport(Array(501).fill("电影").join("\n"), "text", "movie", "completed")).toThrow("500");
  });
  it("ISBN-10 与 ISBN-13 为同一版；作品年份用于精确匹配", () => {
    expect(canonicalISBN("0-306-40615-2")).toBe("9780306406157");
    expect(sameCatalogItem({ ...catalog.metadata, kind: "book", isbn: "0306406152", identities: ["a"] }, { ...catalog.metadata, kind: "book", isbn: "9780306406157", identities: ["b"] })).toBe(true);
    expect(exactCandidates(input(catalog.title), [catalog, { ...catalog, year: 2019 }])).toHaveLength(1);
  });
  it("多类型片只归一个主题，未知类型可显示，英文大小写兼容", () => {
    expect(primaryMovieTheme({ metadata: { ...catalog.metadata, genres: ["Drama", "Animation", "Sci-Fi"] } })).toBe("animation");
    expect(primaryMovieTheme({ metadata: { ...catalog.metadata, genres: ["SCI-FI", "Drama"] } })).toBe("science-fiction");
    expect(primaryMovieTheme({ metadata: null })).toBe("other");
    const entries = Array.from({ length: 500 }, (_, i) => ({ id: String(i), metadata: { ...catalog.metadata, genres: i % 2 ? ["动画", "科幻"] : ["crime", "drama"] } })) as Parameters<typeof groupMovies>[0];
    expect(groupMovies(entries).flatMap(g => g.entries)).toHaveLength(500); expect(new Set(groupMovies(entries).flatMap(g => g.entries.map(e => e.id))).size).toBe(500);
  });
});
describe("持久化导入与权限", () => {
  it("创建重试幂等，任务仅本人可读、可修改", async () => {
    const id = randomUUID(), first = createImport(a, "movie", [input(catalog.title)], "片单", id);
    expect(createImport(a, "movie", [input(catalog.title)], "片单", id).items[0].id).toBe(first.items[0].id);
    expect(() => getImport(b, id)).toThrow(); expect(() => editImport(b, id, first.items[0].id, 1, "skip")).toThrow();
    await expect(processImportItem(b, id, first.items[0].id, "match")).rejects.toThrow(); expect(listImports(b)).toHaveLength(0);
  });
  it("同名版本、未展开系列、信源部分失败均须确认", async () => {
    vi.mocked(searchCatalog).mockResolvedValue({ items: [catalog, { ...make(), title: catalog.title, year: 2019 }], warning: "" });
    const one = await prepared(a, input(catalog.title, { year: null })); expect(one.row.state).toBe("confirm"); expect(one.row.selected).toBe(false);
    const series = await prepared(a, input("电影全系列")); expect(series.row.error).toContain("展开");
    vi.mocked(searchCatalog).mockResolvedValue({ items: [catalog], warning: "部分信源暂不可用" }); expect((await prepared()).row.state).toBe("confirm");
  });
  it("明确导入只写本人，日期、评价与共同确认留空，重试无副本", async () => {
    const { batch, row } = await prepared(); expect(row.state).toBe("ready");
    const [first, raced] = await Promise.all([processImportItem(a, batch.id, row.id, "commit"), processImportItem(a, batch.id, row.id, "commit")]);
    expect(first.state).toBe("done"); expect(raced.id).toBe(row.id);
    expect((await processImportItem(a, batch.id, row.id, "commit")).entryId).toBe(first.entryId);
    const data = readData(a), entry = data.entries.find(e => e.id === first.entryId)!;
    expect(entry.personalRecords).toHaveLength(1); expect(entry.personalRecords[0]).toMatchObject({ userId: a.id, status: "completed", completedOn: null, startedOn: null });
    expect(entry.coverId).toBeTruthy(); expect(entry.sharedStatus).toBeNull(); expect(entry.together).toBeNull();
    expect(data.reviews.filter(r => r.entryId === entry.id)).toHaveLength(0); expect(data.challenges.every(c => !c.entryIds.includes(entry.id))).toBe(true);
  });
  it("复用他人条目、保留已有评价资料；想看升级已看", async () => {
    const p = await prepared(b, input(catalog.title, { status: "planned" })); const existing = await processImportItem(b, p.batch.id, p.row.id, "commit");
    const before = readData(b).entries.find(e => e.id === existing.entryId)!;
    db.insert(s.reviews).values({ id: randomUUID(), entryId: before.id, userId: b.id, rating: 4.5, body: "保留她的评价" }).run();
    const own = await prepared(); expect(own.row.state).toBe("existing");
    const result = await processImportItem(a, own.batch.id, own.row.id, "commit"); expect(result.entryId).toBe(before.id);
    expect(readData(b).entries.find(e => e.id === before.id)!.personalRecords.find(r => r.userId === b.id)).toEqual(before.personalRecords[0]);
    const next = await prepared(b); await processImportItem(b, next.batch.id, next.row.id, "commit");
    const entry = readData(b).entries.find(e => e.id === before.id)!;
    expect(entry.sharedStatus).toBe("completed"); expect(entry.together).toBeNull(); expect(readData(b).reviews.find(r => r.entryId === entry.id)?.body).toBe("保留她的评价");
  });
  it("已看不降级，不清除日期评分；共同记录不会产生", async () => {
    const p = await prepared(a, input(catalog.title, { completedOn: "2018-02-03" })); const r = await processImportItem(a, p.batch.id, p.row.id, "commit");
    const before = readData(a).entries.find(e => e.id === r.entryId)!.personalRecords[0];
    const next = await prepared(a, input(catalog.title, { status: "planned" })); const result = await processImportItem(a, next.batch.id, next.row.id, "commit");
    expect(result.outcome).toContain("保留"); expect(readData(a).entries.find(e => e.id === r.entryId)!.personalRecords[0]).toEqual(before);
  });
  it("补齐缺失客观资料会推进共同版本，并保留已经填写的资料", async () => {
    const p = await prepared(); const imported = await processImportItem(a, p.batch.id, p.row.id, "commit");
    const before = readData(a).entries.find(e => e.id === imported.entryId)!;
    sqlite.prepare("UPDATE movies SET director='',year=NULL WHERE entry_id=?").run(before.id);
    const next = await prepared(); await processImportItem(a, next.batch.id, next.row.id, "commit");
    const after = readData(a).entries.find(e => e.id === before.id)!;
    expect(after.revision).toBe(before.revision + 1); expect(after.creator).toBe(catalog.creator); expect(after.year).toBe(2014);
    expect(after.summary).toBe(before.summary); expect(after.coverId).toBe(before.coverId);
  });
  it("回收站不自动恢复，资料与个人状态冲突可重新检查", async () => {
    const p = await prepared(); const r = await processImportItem(a, p.batch.id, p.row.id, "commit"), id = r.entryId!;
    const pending = await prepared(); const record = db.select().from(s.personalRecords).where(personalWhere(id, a.id)).get()!;
    writePersonal(id, a.id, record.revision, { status: "planned", pinned: false, startedOn: null, completedOn: null });
    expect((await processImportItem(a, pending.batch.id, pending.row.id, "commit")).state).toBe("confirm");
    const current = getImport(a, pending.batch.id).items[0]; const refreshed = await chooseImport(a, pending.batch.id, current.id, current.revision, catalog.ref);
    expect(refreshed.state).toBe("existing");
    db.update(s.personalRecords).set({ removedAt: Date.now() }).where(personalWhere(id, a.id)).run();
    expect((await prepared()).row.state).toBe("confirm");
    expect((await processImportItem(a, pending.batch.id, current.id, "commit")).state).toBe("confirm");
  });
  it("封面失败保留资料，可单独重试；限流保留原阶段", async () => {
    vi.mocked(getCatalogCover).mockRejectedValue(new Error("offline"));
    const p = await prepared(); const r = await processImportItem(a, p.batch.id, p.row.id, "commit"); expect(r.state).toBe("done"); expect(r.warning).toContain("封面");
    vi.mocked(getCatalogCover).mockResolvedValue(bytes); const retried = await processImportItem(a, p.batch.id, p.row.id, "cover"); expect(retried.warning).toBe("");
    vi.mocked(searchCatalog).mockRejectedValue(new CatalogRateLimitError(Date.now() + 60_000));
    const limited = await prepared(); expect(limited.row.state).toBe("pending"); expect(limited.row.retryAt).toBeGreaterThan(Date.now());
  });
  it("500条任务分页数据可持久恢复、统一状态，不影响已成功项", async () => {
    const batch = createImport(a, "book", Array.from({ length: 500 }, (_, i) => input(`书${i}`)));
    expect(getImport(a, batch.id).items).toHaveLength(500);
    const edited = setImportStatus(a, batch.id, batch.updatedAt, "in_progress"); expect(edited.items.every(i => i.input.status === "in_progress")).toBe(true);
    expect(() => setImportStatus(a, batch.id, batch.updatedAt, "completed")).toThrow("更新");
    const row = edited.items[0]; editImport(a, batch.id, row.id, row.revision, "skip"); expect(getImport(a, batch.id).items[0].state).toBe("skipped");
    expect(importReport(getImport(a, batch.id))).toContain("手动跳过");
  });
  it("完整备份恢复导入任务、状态、媒体和校验信息", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "tongye-import-backup-"));
    try { const backup = await createBackup(path.join(temp, "backup")); await restoreBackup(backup, path.join(temp, "restored")); const restored = new Database(path.join(temp, "restored/journal.sqlite"), { readonly: true });
      try { expect(restored.prepare("SELECT count(*) n FROM import_items").get()).toEqual(sqlite.prepare("SELECT count(*) n FROM import_items").get()); expect(restored.pragma("foreign_key_check")).toEqual([]); } finally { restored.close(); }
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
