import { z } from "zod";
import type { Kind, Status } from "./types";
import type { ImportInput } from "./import-types";
import type { CatalogItem } from "./catalog-metadata";
import { canonicalISBN } from "./isbn";
export const importInputSchema = z.object({
  title: z.string().trim().min(1, "请填写作品名称").max(200), year: z.number().int().min(1).max(2200).nullable(),
  creator: z.string().trim().max(200), isbn: z.string().max(40), status: z.enum(["planned", "in_progress", "completed"]),
  startedOn: z.iso.date().nullable(), completedOn: z.iso.date().nullable(),
}).strict();
export class ImportValidationError extends Error {}
export function validateImportInput(value: unknown, kind: Kind): ImportInput {
  const row = importInputSchema.parse(value);
  if (kind === "movie" && row.status === "in_progress") throw new ImportValidationError("电影只能选择想看或已看。");
  if ((kind === "movie" || row.status === "planned") && row.startedOn) throw new ImportValidationError("当前状态不支持开始日期。");
  if (row.status !== "completed" && row.completedOn) throw new ImportValidationError("完成后才能填写完成日期。");
  if (row.startedOn && row.completedOn && row.startedOn > row.completedOn) throw new ImportValidationError("完成日期不能早于开始日期。");
  if (row.isbn && (kind !== "book" || !canonicalISBN(row.isbn))) throw new ImportValidationError("请检查 ISBN，电影不需要 ISBN。");
  return { ...row, isbn: canonicalISBN(row.isbn) };
}
export const matchText = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}]/gu, "");
export const needsExpansion = (s: string) => /全系列|全[集套]|三部曲|[（(]\s*\d+(?:\s*[,，、]\s*\d+)+\s*[)）]/.test(s);
export function exactCandidates(row: ImportInput, candidates: CatalogItem[]) {
  return candidates.filter(c => {
    if (row.isbn) return canonicalISBN(c.metadata.isbn) === row.isbn;
    return [c.title, c.metadata.originalTitle].some(t => matchText(t) === matchText(row.title))
      && (!row.year || c.year === row.year) && (!row.creator || matchText(c.creator).includes(matchText(row.creator)));
  });
}
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else if (quoted || !value) quoted = !quoted; else throw new Error("CSV 引号格式不正确。"); }
    else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(value.trim()); value = "";
      if (c !== ",") { if (row.some(Boolean)) rows.push(row); row = []; if (c === "\r" && text[i + 1] === "\n") i++; }
    } else value += c;
  }
  if (quoted) throw new Error("CSV 有未闭合的引号。");
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
const headers: Record<string, keyof ImportInput> = { "名称": "title", "片名": "title", "书名": "title", title: "title", "年份": "year", year: "year", "导演/作者": "creator", "导演": "creator", "作者": "creator", creator: "creator", ISBN: "isbn", isbn: "isbn", "状态": "status", status: "status", "开始日期": "startedOn", startedOn: "startedOn", "完成日期": "completedOn", completedOn: "completedOn" };
const statusNames: Record<string, Status> = { "想看": "planned", "想读": "planned", "在读": "in_progress", "已读": "completed", "已看": "completed", planned: "planned", in_progress: "in_progress", completed: "completed" };
export function parseImport(text: string, format: "text" | "csv", kind: Kind, status: Status): ImportInput[] {
  if (text.length > 1_000_000) throw new Error("清单过大，请拆成每批最多 500 条。");
  text = text.replace(/^\uFEFF/, "");
  const base = { year: null, creator: "", isbn: "", status, startedOn: null, completedOn: null };
  let rows: unknown[];
  if (format === "csv") {
    const [head, ...body] = csvRows(text);
    if (!head || !head.some(h => headers[h] === "title")) throw new Error("CSV 需要“名称”列，可先下载模板。");
    const keys = head.map(h => Object.hasOwn(headers, h) ? headers[h] : undefined);
    if (keys.some(k => !k) || new Set(keys).size !== keys.length) throw new Error("CSV 包含未知或重复列，请使用模板列名。");
    rows = body.map((r, index) => {
      if (r.length !== keys.length) throw new Error(`第 ${index + 2} 行列数不正确。`);
      const result: Record<string, unknown> = { ...base, title: "" };
      keys.forEach((k, i) => { if (r[i]) result[k!] = k === "year" ? Number(r[i]) : k === "status" ? statusNames[r[i]] ?? r[i] : r[i]; });
      return result;
    });
  } else {
    const titles: string[] = []; let title = "", depth = 0;
    for (const c of text) {
      if ("《（(".includes(c)) depth++;
      if ("》）)".includes(c)) depth = Math.max(0, depth - 1);
      if ((/[\n\r、,，;；]/.test(c) && depth === 0)) { if (title.trim()) titles.push(title); title = ""; } else title += c;
    }
    if (title.trim()) titles.push(title);
    rows = titles.map(t => {
      let name = t.trim().replace(/^\d+[.、]\s*/, ""); const year = name.match(/[（(](\d{4})[)）]\s*$/)?.[1];
      if (year) name = name.replace(/[（(]\d{4}[)）]\s*$/, "").trim();
      name = name.replace(/^《(.*)》$/s, "$1").trim();
      return { ...base, title: name, year: year ? Number(year) : null };
    });
  }
  if (!rows.length || rows.length > 500) throw new Error("每批需要 1–500 条作品，请拆分后再导入。");
  return rows.map((r, i) => { try { return validateImportInput(r, kind); } catch (e) { throw new Error(`第 ${i + 1} 条：${e instanceof z.ZodError ? e.issues[0].message : (e as Error).message}`); } });
}
export function csvCell(v: unknown) { let s = String(v ?? ""); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }
export const importTemplate = "\uFEFF名称,年份,导演/作者,ISBN,状态,开始日期,完成日期\r\n";
