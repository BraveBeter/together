import { activeRecord } from "./domain";
import type { Entry, Memory } from "./types";
export type TimelineMoment = { id: string; date: string | null; order: number; entry: Entry; events: string[]; memories: Memory[] };
export function timelineMoments(entries: Entry[], memories: Memory[], userId: string | null): TimelineMoment[] {
  const days = new Map<string, TimelineMoment>();
  function day(entry: Entry, date: string | null, order: number) {
    const id = `${entry.id}-${date ?? "undated"}`;
    if (!days.has(id)) days.set(id, { id, entry, date, order, events: [], memories: [] });
    return days.get(id)!;
  }
  for (const entry of entries.filter(e => !e.deletedAt)) {
    if (userId) {
      const record = activeRecord(entry, userId);
      if (!record || record.status === "planned") continue;
      if (entry.kind === "book") day(entry, record.startedOn, record.createdAt).events.push("开始阅读");
      if (record.status === "completed") day(entry, record.completedOn, record.createdAt).events.push(entry.kind === "book" ? "读完" : "看完");
    } else if (entry.together && entry.together.revokedAt === null) {
      day(entry, entry.together.completedOn, entry.together.createdAt).events.push(entry.kind === "book" ? "一起读完" : "一起看完");
    }
  }
  if (!userId) for (const memory of memories) {
    const entry = entries.find(e => e.id === memory.entryId && !e.deletedAt);
    if (entry) day(entry, memory.date, memory.createdAt).memories.push(memory);
  }
  return [...days.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.order - a.order || a.id.localeCompare(b.id));
}
