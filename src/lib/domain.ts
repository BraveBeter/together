import type { Challenge, Entry, Kind, PersonalRecord, Recommendation, Status } from "./types";
export const statusLabels: Record<Kind, Record<Status, string>> = {
  movie: { planned: "想看", in_progress: "在看", completed: "已看" },
  book: { planned: "想读", in_progress: "在读", completed: "已读" },
};
export const sharedLabels: Record<Kind, Record<Status, string>> = {
  movie: { planned: "共同想看", in_progress: "一起在看", completed: "共同看完" },
  book: { planned: "共同想读", in_progress: "共读中", completed: "共同读完" },
};
export function statuses(kind: Kind): Status[] { return kind === "book" ? ["in_progress", "planned", "completed"] : ["planned", "completed"]; }
export function validStatus(kind: Kind, value: unknown): value is Status { return statuses(kind).includes(value as Status); }
export function activeRecord(entry: Pick<Entry, "personalRecords" | "deletedAt">, userId: string) {
  return entry.deletedAt ? undefined : entry.personalRecords.find(r => r.userId === userId && r.removedAt === null);
}
export function intersectionStatus(records: PersonalRecord[], memberIds: string[], kind: Kind): Status | null {
  if (memberIds.length !== 2 || new Set(memberIds).size !== 2) return null;
  const own = memberIds.map(id => records.find(r => r.userId === id && r.removedAt === null));
  return own.every(Boolean) && own[0]!.status === own[1]!.status && validStatus(kind, own[0]!.status) ? own[0]!.status : null;
}
export function completedEntries(challenge: Challenge, entries: Entry[]): Entry[] {
  const ids = new Set(challenge.entryIds), seen = new Set<string>();
  return entries.filter(e => {
    if (seen.has(e.id) || !ids.has(e.id) || e.kind !== challenge.kind || e.deletedAt || e.sharedStatus !== "completed" || !e.together || e.together.revokedAt !== null) return false;
    seen.add(e.id); return true;
  }).sort((a, b) => (dateTimestamp(a.together!.completedOn) ?? a.together!.createdAt) - (dateTimestamp(b.together!.completedOn) ?? b.together!.createdAt) || a.id.localeCompare(b.id));
}
export function canRecommend(entry: Entry, senderId: string, recipientId: string) {
  return senderId !== recipientId && activeRecord(entry, senderId)?.status === "completed" && !activeRecord(entry, recipientId);
}
export function pendingRecommendation(recommendation: Recommendation, entry: Entry | undefined) {
  return !!entry && recommendation.status === "pending" && canRecommend(entry, recommendation.senderId, recommendation.recipientId);
}
export function dateTimestamp(value: string | null): number | null { return value ? Date.parse(`${value}T12:00:00+08:00`) : null; }
export function dateLabel(value: number | string | null, options?: Intl.DateTimeFormatOptions): string {
  if (value === null) return "日期未记";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", ...options }).format(new Date(typeof value === "string" ? `${value}T12:00:00+08:00` : value));
}
export function shortDate(value: number): string { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(value).replace("/", "."); }
export function normalizeTitle(value: string) { return value.trim().normalize("NFKC").toLocaleLowerCase(); }
export function beijingDateKey(value: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
