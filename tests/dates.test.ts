import { expect, it } from "vitest";
import { timelineMoments } from "../src/lib/timeline";
import { beijingDateKey, dateLabel, dateTimestamp } from "../src/lib/domain";
import type { Entry, Memory, PersonalRecord } from "../src/lib/types";
const rec = (userId: string, start: string | null, end: string | null): PersonalRecord => ({ userId, entryId: "book", status: "completed", startedOn: start, completedOn: end, pinned: false, removedAt: null, revision: 1, createdAt: 100, updatedAt: 100 });
const entry: Entry = { id: "book", kind: "book", title: "书", creator: "", summary: "", coverId: null, links: [], tags: [], year: null, deletedAt: null, createdAt: 100, updatedAt: 100, revision: 0, sharedStatus: "completed", together: null, personalRecords: [rec("a", "2020-01-01", "2020-01-02"), rec("b", "2020-02-01", "2020-02-05")] };
it("个人日期独立，共同分支不自动推测日期或经历", () => {
  expect(timelineMoments([entry], [], null)).toHaveLength(0);
  expect(timelineMoments([entry], [], "a").map(m => m.date)).toEqual(["2020-01-02", "2020-01-01"]);
  expect(timelineMoments([entry], [], "b").map(m => m.date)).toEqual(["2020-02-05", "2020-02-01"]);
});
it("同作品同天合并；未知日期不使用创建时间；想读不生成事件", () => {
  const e = { ...entry, personalRecords: [rec("a", "2020-01-01", "2020-01-01")] };
  expect(timelineMoments([e], [], "a")[0].events).toEqual(["开始阅读", "读完"]);
  expect(timelineMoments([{ ...e, personalRecords: [rec("a", null, null)] }], [], "a")[0].date).toBeNull();
  expect(timelineMoments([{ ...e, personalRecords: [{ ...rec("a", null, null), status: "planned" }] }], [], "a")).toHaveLength(0);
});
it("共同确认和同日回忆合并，修正个人状态不删除回忆", () => {
  const e: Entry = { ...entry, sharedStatus: null, personalRecords: [], together: { entryId: "book", recordedBy: "a", completedOn: "2019-01-01", revision: 1, createdAt: 100, revokedAt: null } };
  const memory: Memory = { id: "memory", entryId: "book", date: "2019-01-01", place: "家", body: "回忆", photos: [], revision: 0, createdAt: 101 };
  expect(timelineMoments([e], [memory], null)).toHaveLength(1);
  expect(timelineMoments([e], [memory], null)[0].memories).toHaveLength(1);
  const revoked = { ...e, together: { ...e.together!, revokedAt: 102 } };
  expect(timelineMoments([revoked], [memory], null)[0].events).toEqual([]);
  expect(timelineMoments([revoked], [memory], null)[0].memories).toHaveLength(1);
});
it("北京时间日期往返稳定", () => {
  expect(beijingDateKey(dateTimestamp("2010-03-04")!)).toBe("2010-03-04");
  expect(dateLabel(null)).toBe("日期未记");
});
