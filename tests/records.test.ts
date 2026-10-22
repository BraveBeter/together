import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Member, Status } from "../src/lib/types";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
let me: Member | null;
vi.mock("../src/lib/session", () => ({ currentMember: async () => me }));
import { db } from "../src/db";
import * as s from "../src/db/schema";
import { saveEntry, savePersonalRecord, personalRecordCommand, saveTogether, saveReview, saveMemory, setChallenge, saveRecommendation, actOnRecommendation } from "../src/lib/actions";
import { readData } from "../src/lib/data";
import { completedEntries } from "../src/lib/domain";
import { storeAsset } from "../src/lib/assets";
import { normalizeCatalogItem } from "../src/lib/catalog-server";
import { createBackup, restoreBackup } from "../src/lib/backup";
const first: Member = { id: "member-first", name: "第一位", email: "first@test.invalid", seat: 0, color: "#6d7359", avatarId: null };
const second: Member = { id: "member-second", name: "第二位", email: "second@test.invalid", seat: 1, color: "#a66b53", avatarId: null };
const bookId = randomUUID(), movieId = randomUUID();
const input = (id: string, kind: "movie" | "book", rest = {}) => ({ id, kind, title: kind === "book" ? "书的故事" : "电影的故事", creator: "", year: null, summary: "", coverId: null, links: [], tags: [], create: true, revision: 0, personal: { status: "planned", startedOn: null, completedOn: null, pinned: false }, ...rest });
const entry = (id: string) => readData(first).entries.find(e => e.id === id)!;
const own = (id: string) => entry(id).personalRecords.find(r => r.userId === me!.id);
const update = (id: string, status: Status, rest = {}) => savePersonalRecord({ entryId: id, revision: own(id)?.revision ?? 0, status, startedOn: null, completedOn: null, pinned: false, ...rest });
const count = (kind: string) => { const d = readData(first); return completedEntries(d.challenges.find(c => c.kind === kind)!, d.entries).length; };
beforeAll(() => {
  for (const m of [first, second]) { db.insert(s.user).values({ id: m.id, name: m.name, email: m.email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() }).run(); db.insert(s.members).values({ userId: m.id, seat: m.seat, color: m.color }).run(); }
  me = first;
});
describe("完整清单、双人权限与保存", () => {
  // Existing record scenarios run before the catalog race case below so their
  // exact fixture counts remain useful assertions.
  it("创建只写本人，重试幂等；服务端同名拦截，可明确另建", async () => {
    expect((await saveEntry(input(bookId, "book"))).ok).toBe(true); expect((await saveEntry(input(bookId, "book"))).ok).toBe(true);
    expect(entry(bookId).personalRecords).toHaveLength(1); expect(entry(bookId).sharedStatus).toBeNull();
    expect((await saveEntry(input(randomUUID(), "book"))).ok).toBe(false);
    expect(db.select().from(s.entries).all()).toHaveLength(1);
    expect((await saveEntry(input(movieId, "movie"))).ok).toBe(true);
  });
  it("双方进度独立，完成相同进入共同列表，挑战仍需一起确认", async () => {
    await setChallenge({ entryId: bookId, revision: entry(bookId).revision, joined: true });
    await update(bookId, "completed", { startedOn: "2010-01-01", completedOn: "2010-02-01" });
    expect(entry(bookId).sharedStatus).toBeNull(); expect(count("book")).toBe(0);
    me = second; await update(bookId, "in_progress", { startedOn: "2020-01-01" }); expect(entry(bookId).sharedStatus).toBeNull();
    await update(bookId, "completed", { startedOn: "2020-01-01", completedOn: "2020-03-01" });
    expect(entry(bookId).sharedStatus).toBe("completed"); expect(count("book")).toBe(0);
    expect((await saveTogether({ entryId: bookId, revision: 0, confirmed: true, completedOn: "2024-05-01" })).ok).toBe(true);
    expect(count("book")).toBe(1); expect(entry(bookId).personalRecords.map(r => r.completedOn)).toEqual(["2010-02-01", "2020-03-01"]);
    expect((await saveTogether({ entryId: bookId, revision: 0, confirmed: true, completedOn: "2024-05-01" })).ok).toBe(true); expect(count("book")).toBe(1);
    me = first;
  });
  it("移除仅本人，恢复重算，撤销确认和修正状态保留回忆", async () => {
    await saveMemory({ id: randomUUID(), entryId: bookId, revision: 0, create: true, date: null, place: "家里", body: "第一次一起聊这本书", photos: [] });
    const otherBefore = entry(bookId).personalRecords.find(r => r.userId === second.id);
    await personalRecordCommand({ entryId: bookId, revision: own(bookId)!.revision, command: "remove" });
    expect(count("book")).toBe(0); expect(entry(bookId).personalRecords.find(r => r.userId === second.id)).toEqual(otherBefore);
    await personalRecordCommand({ entryId: bookId, revision: own(bookId)!.revision, command: "restore" }); expect(count("book")).toBe(1);
    await saveTogether({ entryId: bookId, revision: entry(bookId).together!.revision, confirmed: false, completedOn: "2024-05-01" }); expect(count("book")).toBe(0);
    await saveTogether({ entryId: bookId, revision: entry(bookId).together!.revision, confirmed: true, completedOn: null }); expect(count("book")).toBe(1);
    await update(bookId, "in_progress"); expect(count("book")).toBe(0); expect(readData(first).memories).toHaveLength(1);
    await update(bookId, "completed"); expect(count("book")).toBe(1);
    await setChallenge({ entryId: bookId, revision: entry(bookId).revision, joined: false }); expect(count("book")).toBe(0);
    await setChallenge({ entryId: bookId, revision: entry(bookId).revision, joined: true }); expect(count("book")).toBe(1);
  });
  it("非法状态、日期顺序、冒充个人身份与匿名请求均被拒绝", async () => {
    expect((await update(movieId, "in_progress")).ok).toBe(false);
    expect((await update(bookId, "completed", { startedOn: "2020-03-01", completedOn: "2020-02-01" })).ok).toBe(false);
    expect((await update(movieId, "completed", { userId: second.id })).ok).toBe(false);
    expect((await saveReview({ entryId: bookId, revision: 0, body: "篡改", rating: 1, userId: second.id })).ok).toBe(false);
    expect((await personalRecordCommand({ entryId: bookId, revision: own(bookId)!.revision, command: "remove", userId: second.id })).ok).toBe(false);
    me = null; expect((await savePersonalRecord({ entryId: movieId, revision: 0, status: "completed", startedOn: null, completedOn: null, pinned: false })).ok).toBe(false);
    expect((await saveEntry(input(randomUUID(), "movie"))).ok).toBe(false); me = first;
    expect((await saveEntry(input(randomUUID(), "movie", { links: [{ label: "恶意", url: "javascript:alert(1)" }] }))).ok).toBe(false);
  });
  it("自己的感受独立、过期版本冲突，不静默覆盖", async () => {
    await saveReview({ entryId: bookId, revision: 0, body: "我的感受", rating: 4.5 });
    me = second; await saveReview({ entryId: bookId, revision: 0, body: "对方的感受", rating: 5 }); me = first;
    expect(db.select().from(s.reviews).all().map(r => r.body)).toEqual(["我的感受", "对方的感受"]);
    const rev = own(bookId)!.revision; await update(bookId, "completed", { completedOn: "2026-10-18" });
    const r = await savePersonalRecord({ entryId: bookId, revision: rev, status: "planned", startedOn: null, completedOn: null, pinned: false });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.conflict).toBe(true);
    const old = entry(movieId); await saveEntry(input(movieId, "movie", { create: false, revision: old.revision, title: "修改后的电影" }));
    const conflict = await saveEntry(input(movieId, "movie", { create: false, revision: old.revision, title: "旧设备覆盖" }));
    expect(conflict.ok).toBe(false); if (!conflict.ok) expect(conflict.conflict).toBe(true);
  });
  it("推荐处理权限、暂放、重发、撤回、幂等接受与自行加入", async () => {
    await update(movieId, "completed");
    const send = (revision: number) => saveRecommendation({ entryId: movieId, revision, note: "你会喜欢", command: "send" });
    await send(0); await send(0); expect(readData(first).recommendations).toHaveLength(1);
    const rec = () => readData(first).recommendations[0];
    expect((await actOnRecommendation({ id: rec().id, revision: rec().revision, command: "accept" })).ok).toBe(false);
    me = second; await actOnRecommendation({ id: rec().id, revision: rec().revision, command: "dismiss" }); expect(rec().status).toBe("dismissed");
    me = first; await send(rec().revision); await actOnRecommendation({ id: rec().id, revision: rec().revision, command: "withdraw" }); expect(rec().status).toBe("withdrawn");
    await send(rec().revision); me = second; const rev = rec().revision;
    await actOnRecommendation({ id: rec().id, revision: rev, command: "accept" }); await actOnRecommendation({ id: rec().id, revision: rev, command: "accept" });
    expect(own(movieId)!.status).toBe("planned"); expect(entry(movieId).personalRecords).toHaveLength(2); expect(entry(movieId).sharedStatus).toBeNull();
    expect(entry(movieId).together).toBeNull(); expect(count("movie")).toBe(0);
    await personalRecordCommand({ entryId: movieId, revision: own(movieId)!.revision, command: "remove" }); me = first; await send(rec().revision); me = second;
    await update(movieId, "completed"); expect(rec().status).toBe("resolved"); expect(entry(movieId).sharedStatus).toBe("completed"); me = first;
  });
  it("在线快照恢复包括个人状态、共同确认、推荐和所有媒体，拒绝覆盖目录", async () => {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#6d7359" } }).png().toBuffer();
    const assetId = await storeAsset(image, "测试.png", first.id);
    await saveMemory({ id: randomUUID(), entryId: bookId, revision: 0, create: true, date: "2026-10-18", place: "家", body: "有图的回忆", photos: [assetId] });
    const temporary = await mkdtemp(path.join(os.tmpdir(), "tongye-restore-test-"));
    try {
      const file = await createBackup(path.join(temporary, "backups")), restored = path.join(temporary, "restored"); await restoreBackup(file, restored);
      const check = new Database(path.join(restored, "journal.sqlite"), { readonly: true });
      try {
        expect(check.prepare("SELECT COUNT(*) AS n FROM personal_records").get()).toEqual({ n: 4 }); expect(check.prepare("SELECT COUNT(*) AS n FROM together_confirmations").get()).toEqual({ n: 1 });
        expect(check.prepare("SELECT COUNT(*) AS n FROM recommendations").get()).toEqual({ n: 1 }); expect(check.prepare("SELECT COUNT(*) AS n FROM memories").get()).toEqual({ n: 2 });
        expect(check.prepare("SELECT status FROM personal_records WHERE entry_id=? AND user_id=?").get(bookId, first.id)).toEqual({ status: "completed" });
      } finally { check.close(); }
      expect(createHash("sha256").update(await readFile(path.join(restored, "uploads", assetId, "original"))).digest("hex")).toBe(createHash("sha256").update(image).digest("hex"));
      await expect(restoreBackup(file, restored)).rejects.toThrow("目标目录已经存在");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("两人同时导入同一目录作品时复用 ID，只新增本人记录；保留版本资料与另一人的感受", async () => {
    const item = normalizeCatalogItem({ uuid: "5psNI0Ay35T3KqEP3hcC4j", category: "book", type: "Edition", title: "目录中的一本书", author: ["作者"], pub_year: 2012, pub_house: "出版社", isbn: "9787506365437" }, "upstairs", "book")!;
    const firstId = randomUUID(); me = first;
    const firstInput = input(firstId, "book", { title: item.title, creator: item.creator, metadata: item.metadata, links: item.links, personal: { status: "completed", startedOn: null, completedOn: "2020-01-01", pinned: false, review: { revision: 0, rating: 4.5, body: "我的评价" } } });
    expect((await saveEntry(firstInput)).ok).toBe(true);
    me = second;
    const raced = await saveEntry(input(randomUUID(), "book", { title: item.title, creator: "不应覆盖共有资料", metadata: item.metadata, links: item.links }));
    expect(raced).toEqual({ ok: true, data: { id: firstId } });
    const stored = entry(firstId); expect(stored.creator).toBe("作者"); expect(stored.metadata?.isbn).toBe("9787506365437");
    expect(stored.personalRecords).toHaveLength(2); expect(stored.personalRecords.find(r => r.userId === first.id)?.completedOn).toBe("2020-01-01");
    expect(readData(first).reviews.find(r => r.entryId === firstId && r.userId === first.id)?.rating).toBe(4.5);
    expect(stored.sharedStatus).toBeNull(); expect(stored.together).toBeNull();
    const repeated = await saveEntry(input(randomUUID(), "book", { title: item.title, metadata: item.metadata, links: item.links, allowDuplicate: true }));
    expect(repeated.ok).toBe(false); expect(readData(first).entries.filter(e => e.metadata?.isbn === item.metadata.isbn)).toHaveLength(1);
    me = first;
  });
});
