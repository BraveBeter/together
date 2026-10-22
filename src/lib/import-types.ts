import type { CatalogItem } from "./catalog-metadata";
import type { Kind, Status } from "./types";
export type ImportInput = { title: string; year: number | null; creator: string; isbn: string; status: Status; startedOn: string | null; completedOn: string | null };
export type ImportState = "pending" | "ready" | "existing" | "confirm" | "not_found" | "failed" | "done" | "skipped";
export type ImportExpected = { entryId: string; entryRevision: number; recordRevision: number };
export type ImportItem = {
  id: string; batchId: string; position: number; input: ImportInput; state: ImportState; selected: boolean;
  candidates: CatalogItem[]; catalog: CatalogItem | null; expected: ImportExpected | null;
  entryId: string | null; outcome: string; warning: string; error: string; revision: number; leaseUntil: number; retryAt: number; newWork: boolean;
};
export type ImportBatch = { id: string; kind: Kind; label: string; createdAt: number; updatedAt: number; items: ImportItem[] };
export type ImportSummary = Omit<ImportBatch, "items"> & { total: number; done: number };
export const importStateLabels: Record<ImportState, string> = { pending: "待匹配", ready: "可导入", existing: "已存在", confirm: "待确认", not_found: "未找到", failed: "失败", done: "已处理", skipped: "已跳过" };
