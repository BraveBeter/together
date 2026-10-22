import { describe, expect, it } from "vitest";
import { activeRecord, completedEntries, intersectionStatus, normalizeTitle, statuses } from "../src/lib/domain";
import type { Entry, Kind, PersonalRecord, Status } from "../src/lib/types";
function record(userId: string, status: Status, removedAt: number | null = null): PersonalRecord { return { entryId: "work", userId, status, startedOn: null, completedOn: null, pinned: false, createdAt: 1, updatedAt: 1, revision: 1, removedAt }; }
function entry(rest: Partial<Entry> = {}): Entry { return { id: "work", kind: "book", title: "一本书", creator: "", year: null, summary: "", coverId: null, tags: [], links: [], personalRecords: [], sharedStatus: null, together: null, revision: 0, createdAt: 1, updatedAt: 1, deletedAt: null, ...rest }; }
describe("严格交集", () => {
  for (const kind of ["book", "movie"] as Kind[]) {
    const values = [null, ...statuses(kind)];
    for (const a of values) for (const b of values) for (const removed of [null, "a", "b"]) {
      it(`${kind}: ${a}/${b}, removed=${removed}`, () => {
        const records = [a ? record("a", a, removed === "a" ? 12 : null) : null, b ? record("b", b, removed === "b" ? 12 : null) : null].filter((r): r is PersonalRecord => r !== null);
        expect(intersectionStatus(records, ["a", "b"], kind)).toBe(a && a === b && !removed ? a : null);
        for (const r of records) r.removedAt = null;
        expect(intersectionStatus(records, ["a", "b"], kind)).toBe(a && a === b ? a : null);
      });
    }
  }
  it("人数、重复身份和电影非法状态不能形成交集", () => {
    expect(intersectionStatus([record("a", "completed")], ["a", "a"], "book")).toBeNull();
    expect(intersectionStatus([record("a", "completed")], ["a"], "book")).toBeNull();
    expect(intersectionStatus([record("a", "in_progress"), record("b", "in_progress")], ["a", "b"], "movie")).toBeNull();
  });
});
it("挑战同时检查加入、双方已完成和有效共同确认，按 ID 去重", () => {
  const challenge = { id: "books-100", kind: "book" as const, title: "挑战", target: 100, entryIds: ["work", "work"], achievedAt: null };
  const work = entry({ sharedStatus: "completed", together: { entryId: "work", completedOn: null, recordedBy: "a", createdAt: 2, revision: 1, revokedAt: null } });
  expect(completedEntries(challenge, [work, work])).toHaveLength(1);
  for (const rest of [{ sharedStatus: null }, { together: null }, { deletedAt: 5 }, { together: { ...work.together!, revokedAt: 4 } }, { kind: "movie" as const }]) expect(completedEntries(challenge, [{ ...work, ...rest }])).toHaveLength(0);
  expect(completedEntries({ ...challenge, entryIds: [] }, [work])).toHaveLength(0);
});
it("个人状态不继承任何共同记录，同名规范化保留作品 ID 判定", () => {
  expect(activeRecord(entry({ sharedStatus: "completed" }), "a")).toBeUndefined();
  expect(normalizeTitle(" ＡＢＣ ")).toBe("abc");
});
