"use server";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import * as s from "../db/schema";
import { currentMember } from "./session";
import { readData, updateMilestones } from "./data";
import { canRecommend, normalizeTitle, pendingRecommendation, validStatus } from "./domain";
import { auth } from "./auth";
import { demoEnabled } from "./config";
import { catalogMetadataSchema } from "./catalog-server";
import { matchesCatalogEntry } from "./catalog-metadata";
import type { Kind, Member, Result } from "./types";
import { InputError, ConflictError, personalFields, reviewFields, assertAssets, getEntry, personalWhere, validatePersonal, writeReview, writePersonal, createSharedEntry } from "./records";
const id = z.string().uuid(), revision = z.number().int().min(0);
const linkSchema = z.object({ label: z.string().trim().max(80), url: z.url().max(2000).refine(v => ["http:", "https:"].includes(new URL(v).protocol), "链接须以 http:// 或 https:// 开头") });
const entrySchema = z.object({
  id, revision, kind: z.enum(["movie", "book"]), title: z.string().trim().min(1, "请填写标题").max(200), creator: z.string().trim().max(200),
  year: z.number().int().min(1).max(2200).nullable(), summary: z.string().max(10000), coverId: id.nullable(), links: z.array(linkSchema).max(12),
  tags: z.array(z.string().trim().min(1).max(30)).max(20), create: z.boolean(), allowDuplicate: z.boolean().default(false), personal: personalFields.optional(),
  metadata: catalogMetadataSchema.nullable().optional(),
}).strict();
async function mutate<T>(fn: (member: Member) => T | Promise<T>): Promise<Result<T>> {
  const member = await currentMember();
  if (!member) return { ok: false, error: "登录已过期，请重新登录。" };
  try {
    const data = await fn(member), latest = readData(member);
    for (const r of latest.recommendations) if (r.status === "pending" && !pendingRecommendation(r, latest.entries.find(e => e.id === r.entryId))) {
      db.update(s.recommendations).set({ status: "resolved", revision: r.revision + 1, updatedAt: Date.now() }).where(and(eq(s.recommendations.id, r.id), eq(s.recommendations.revision, r.revision))).run();
    }
    updateMilestones(member); revalidatePath("/", "layout"); return { ok: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message || "请检查填写内容。" };
    if (e instanceof InputError) return { ok: false, error: e.message, conflict: e instanceof ConflictError };
    console.error("journal mutation failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "暂时没能保存，请稍后重试。你的输入还在。" };
  }
}
export async function saveEntry(input: unknown) {
  return mutate(member => {
    const v = entrySchema.parse(input);
    if (v.metadata && v.metadata.kind !== v.kind) throw new InputError("作品资料的类型不匹配，请重新选择。");
    return db.transaction(() => {
      assertAssets([v.coverId]); const now = Date.now();
      const values = { title: v.title, summary: v.summary, coverId: v.coverId, links: v.links, tags: [...new Set(v.tags)], updatedAt: now, ...(v.metadata !== undefined ? { metadata: v.metadata } : {}) };
      if (v.create) {
        const existing = db.select().from(s.entries).where(eq(s.entries.id, v.id)).get();
        if (existing) {
          if (existing.kind !== v.kind || normalizeTitle(existing.title) !== normalizeTitle(v.title) || !db.select().from(s.personalRecords).where(personalWhere(v.id, member.id)).get()) throw new ConflictError("作品已存在，请重新打开后记录。");
          return { id: existing.id };
        }
        if (!v.personal) throw new InputError("请从自己的清单添加作品。");
        validatePersonal(v.kind, v.personal);
        // A second member may select the same catalog item before the first saves.
        // Reuse it inside the write transaction; never overwrite its shared fields.
        if (v.metadata) {
          const match = db.select().from(s.entries).all().find(e => !e.deletedAt && matchesCatalogEntry(e, { ref: v.metadata!, metadata: v.metadata!, links: v.links }));
          if (match) {
            if (db.select().from(s.personalRecords).where(personalWhere(match.id, member.id)).get()) throw new ConflictError("这部作品已经在你的清单或回收站中。请加载最新记录并使用已有作品。");
            writePersonal(match.id, member.id, 0, v.personal); return { id: match.id };
          }
        }
        if (!v.allowDuplicate && db.select().from(s.entries).all().some(e => !e.deletedAt && e.kind === v.kind && normalizeTitle(e.title) === normalizeTitle(v.title))) throw new ConflictError("空间里已有同名作品。请加载最新记录后选择已有作品；不同作品可勾选“同名不同作品，仍然新建”。");
        createSharedEntry({ id: v.id, kind: v.kind, title: v.title, summary: v.summary, coverId: v.coverId, links: v.links, tags: values.tags, metadata: v.metadata, creator: v.creator, year: v.year });
        writePersonal(v.id, member.id, 0, v.personal);
      } else {
        const old = getEntry(v.id, v.revision);
        if (old.kind !== v.kind) throw new InputError("作品类型不能更改。");
        db.update(s.entries).set({ ...values, revision: old.revision + 1 }).where(eq(s.entries.id, v.id)).run();
        if (v.kind === "movie") db.update(s.movies).set({ director: v.creator, year: v.year }).where(eq(s.movies.entryId, v.id)).run();
        else db.update(s.books).set({ author: v.creator, year: v.year }).where(eq(s.books.entryId, v.id)).run();
      }
      return { id: v.id };
    }, { behavior: "immediate" });
  });
}
export async function savePersonalRecord(input: unknown) {
  return mutate(member => {
    const v = personalFields.extend({ entryId: id, revision }).strict().parse(input);
    return db.transaction(() => { writePersonal(v.entryId, member.id, v.revision, v); return { id: v.entryId }; }, { behavior: "immediate" });
  });
}
export async function personalRecordCommand(input: unknown) {
  return mutate(member => {
    const v = z.object({ entryId: id, revision, command: z.enum(["remove", "restore"]) }).strict().parse(input);
    db.transaction(() => {
      getEntry(v.entryId); const where = personalWhere(v.entryId, member.id), old = db.select().from(s.personalRecords).where(where).get();
      if (!old) throw new InputError("你的清单中没有这部作品。");
      if (old.revision === v.revision + 1 && (old.removedAt === null) === (v.command === "restore")) return;
      if (old.revision !== v.revision) throw new ConflictError("你的清单已更新，请刷新后重试。");
      db.update(s.personalRecords).set({ removedAt: v.command === "remove" ? Date.now() : null, updatedAt: Date.now(), revision: old.revision + 1 }).where(where).run();
    }, { behavior: "immediate" });
  });
}
export async function saveTogether(input: unknown) {
  return mutate(member => {
    const v = z.object({ entryId: id, revision, confirmed: z.boolean(), completedOn: z.iso.date().nullable() }).strict().parse(input);
    db.transaction(() => {
      getEntry(v.entryId); const old = db.select().from(s.togetherConfirmations).where(eq(s.togetherConfirmations.entryId, v.entryId)).get();
      if ((old?.revision ?? 0) !== v.revision) {
        if (old?.revision === v.revision + 1 && (old.revokedAt === null) === v.confirmed && old.completedOn === v.completedOn) return;
        throw new ConflictError("共同完成记录已被更新。请加载最新记录后合并。");
      }
      const changes = { completedOn: v.completedOn, recordedBy: member.id, revokedAt: v.confirmed ? null : Date.now(), revision: v.revision + 1 };
      db.insert(s.togetherConfirmations).values({ entryId: v.entryId, createdAt: Date.now(), ...changes })
        .onConflictDoUpdate({ target: s.togetherConfirmations.entryId, set: changes }).run();
    }, { behavior: "immediate" });
  });
}
export async function setChallenge(input: unknown) {
  return mutate(() => {
    const v = z.object({ entryId: id, revision, joined: z.boolean() }).strict().parse(input);
    db.transaction(() => {
      const entry = getEntry(v.entryId), challengeId = entry.kind === "movie" ? "movies-100" : "books-100";
      const old = db.select().from(s.challengeEntries).where(and(eq(s.challengeEntries.entryId, entry.id), eq(s.challengeEntries.challengeId, challengeId))).get();
      if (!!old === v.joined) return;
      getEntry(v.entryId, v.revision);
      if (v.joined) db.insert(s.challengeEntries).values({ entryId: entry.id, challengeId }).run();
      else db.delete(s.challengeEntries).where(and(eq(s.challengeEntries.entryId, entry.id), eq(s.challengeEntries.challengeId, challengeId))).run();
      db.update(s.entries).set({ revision: entry.revision + 1, updatedAt: Date.now() }).where(eq(s.entries.id, entry.id)).run();
    }, { behavior: "immediate" });
  });
}
export async function saveReview(input: unknown) {
  return mutate(member => { const v = reviewFields.extend({ entryId: id }).strict().parse(input); db.transaction(() => { getEntry(v.entryId); writeReview(v.entryId, member.id, v); }); });
}
export async function saveRecommendation(input: unknown) {
  return mutate(member => {
    const v = z.object({ entryId: id, revision, note: z.string().trim().max(300), command: z.enum(["send", "edit"]) }).strict().parse(input);
    db.transaction(() => {
      getEntry(v.entryId); const data = readData(member), other = data.members.find(m => m.id !== member.id), entry = data.entries.find(e => e.id === v.entryId)!;
      if (!other || !canRecommend(entry, member.id, other.id)) throw new InputError("仅能推荐自己已完成、对方尚未加入清单的作品。");
      const old = data.recommendations.find(r => r.entryId === v.entryId && r.senderId === member.id && r.recipientId === other.id);
      if ((old?.revision ?? 0) !== v.revision) {
        if (old?.status === "pending" && old.revision === v.revision + 1 && old.note === v.note) return;
        throw new ConflictError("推荐已更新，请加载最新留言后再试。");
      }
      if (v.command === "edit" && old?.status !== "pending") throw new InputError("这条推荐已收起，可以重新推荐。");
      const now = Date.now();
      db.insert(s.recommendations).values({ id: randomUUID(), entryId: v.entryId, senderId: member.id, recipientId: other.id, note: v.note, status: "pending", revision: v.revision + 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [s.recommendations.entryId, s.recommendations.senderId, s.recommendations.recipientId], set: { note: v.note, status: "pending", revision: v.revision + 1, updatedAt: now } }).run();
    }, { behavior: "immediate" });
  });
}
export async function actOnRecommendation(input: unknown) {
  return mutate(member => {
    const v = z.object({ id, revision, command: z.enum(["accept", "dismiss", "withdraw"]) }).strict().parse(input);
    db.transaction(() => {
      const row = db.select().from(s.recommendations).where(eq(s.recommendations.id, v.id)).get();
      if (!row || (v.command === "withdraw" ? row.senderId : row.recipientId) !== member.id) throw new InputError("你不能处理这条推荐。");
      const state = ({ accept: "accepted", dismiss: "dismissed", withdraw: "withdrawn" } as const)[v.command];
      if (row.status === state && row.revision === v.revision + 1) return;
      if (row.revision !== v.revision || row.status !== "pending") throw new ConflictError("推荐已被处理或收起，请刷新。");
      getEntry(row.entryId);
      if (v.command !== "withdraw" && !pendingRecommendation(row, readData(member).entries.find(e => e.id === row.entryId))) throw new ConflictError("这部作品已加入清单，或推荐条件已改变。请刷新。");
      if (v.command === "accept") {
        const old = db.select().from(s.personalRecords).where(personalWhere(row.entryId, member.id)).get();
        writePersonal(row.entryId, member.id, old?.revision ?? 0, { status: "planned", startedOn: null, completedOn: null, pinned: false });
      }
      db.update(s.recommendations).set({ status: state, revision: row.revision + 1, updatedAt: Date.now() }).where(eq(s.recommendations.id, row.id)).run();
    }, { behavior: "immediate" });
  });
}
export async function saveMemory(input: unknown) {
  return mutate(() => {
    const v = z.object({ id, entryId: id, revision, create: z.boolean(), date: z.iso.date().nullable(), place: z.string().trim().max(200), body: z.string().trim().min(1, "写下一点当时的感受吧").max(20000), photos: z.array(id).max(8) }).strict().parse(input);
    db.transaction(() => {
      getEntry(v.entryId); assertAssets(v.photos);
      const old = db.select().from(s.memories).where(eq(s.memories.id, v.id)).get();
      if (v.create && old && old.entryId === v.entryId) return;
      if (!v.create && (!old || old.deletedAt || old.entryId !== v.entryId)) throw new InputError("回忆不存在。");
      if (!v.create && old!.revision !== v.revision) throw new ConflictError("这段回忆刚刚被更新了。文字已保留，请加载最新记录后合并。");
      if (v.create) db.insert(s.memories).values({ id: v.id, entryId: v.entryId, date: v.date, place: v.place, body: v.body, photos: v.photos, createdAt: Date.now() }).run();
      else db.update(s.memories).set({ date: v.date, place: v.place, body: v.body, photos: v.photos, revision: v.revision + 1 }).where(eq(s.memories.id, v.id)).run();
    });
  });
}
export async function deleteMemory(input: unknown) {
  return mutate(() => {
    const v = z.object({ id, revision }).strict().parse(input);
    const result = db.update(s.memories).set({ deletedAt: Date.now(), revision: v.revision + 1 }).where(and(eq(s.memories.id, v.id), eq(s.memories.revision, v.revision))).run();
    if (!result.changes) throw new ConflictError("回忆已被修改，请刷新后重试。");
  });
}
export async function saveSettings(input: unknown) {
  return mutate(member => {
    const v = z.object({ name: z.string().trim().min(1).max(30), subtitle: z.string().trim().max(160), nickname: z.string().trim().min(1).max(30), avatarId: id.nullable(), revision }).parse(input);
    db.transaction(() => {
      assertAssets([v.avatarId]);
      const changed = db.update(s.settings).set({ name: v.name, subtitle: v.subtitle, revision: v.revision + 1 }).where(and(eq(s.settings.id, "home"), eq(s.settings.revision, v.revision))).run();
      if (!changed.changes) throw new ConflictError("网站设置已更新，请刷新后重试。");
      db.update(s.user).set({ name: v.nickname, updatedAt: new Date() }).where(eq(s.user.id, member.id)).run();
      db.update(s.members).set({ avatarId: v.avatarId }).where(eq(s.members.userId, member.id)).run();
    });
  });
}
export async function signIn(input: unknown): Promise<Result> {
  try {
    const v = z.object({ email: z.email(), password: z.string().min(1) }).parse(input);
    await auth.api.signInEmail({ body: v, headers: await headers() });
    return { ok: true, data: undefined };
  } catch { return { ok: false, error: "邮箱或密码不正确，或尝试次数过多。请检查后重试。" }; }
}
export async function demoSignIn(): Promise<Result> {
  if (!demoEnabled || !process.env.DEMO_PASSWORD) return { ok: false, error: "演示入口未启用。" };
  return signIn({ email: "lin@tongye.demo", password: process.env.DEMO_PASSWORD });
}
export async function signOut() { await auth.api.signOut({ headers: await headers() }); }
export async function changePassword(input: unknown): Promise<Result<void>> {
  return mutate(async () => {
    const v = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10, "新密码至少需要 10 个字符").max(128) }).parse(input);
    try { await auth.api.changePassword({ body: { ...v, revokeOtherSessions: true }, headers: await headers() }); }
    catch { throw new InputError("当前密码不正确，或密码修改失败。请重试。"); }
  });
}
