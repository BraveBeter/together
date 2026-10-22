import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import * as s from "../db/schema";
import { validStatus } from "./domain";
import type { Kind } from "./types";
import { matchesCatalogEntry, type CatalogItem } from "./catalog-metadata";
import { matchText } from "./import-parser";
export class InputError extends Error {}
export class ConflictError extends InputError {}
const id = z.string().uuid(), revision = z.number().int().min(0);
const status = z.enum(["planned", "in_progress", "completed"]);
export const reviewFields = z.object({ revision, rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable(), body: z.string().max(10000) }).strict();
export const personalFields = z.object({ status, startedOn: z.iso.date().nullable(), completedOn: z.iso.date().nullable(), pinned: z.boolean(), review: reviewFields.optional() }).strict();
export function assertAssets(ids: (string | null)[]) {
  for (const assetId of ids.filter(Boolean)) if (!db.select().from(s.assets).where(eq(s.assets.id, assetId!)).get()) throw new InputError("图片不存在，请重新上传。");
}
export function getEntry(entryId: string, expected?: number) {
  const row = db.select().from(s.entries).where(eq(s.entries.id, entryId)).get();
  if (!row || row.deletedAt) throw new InputError("这部作品不存在，或已被旧版移除。");
  if (expected !== undefined && row.revision !== expected) throw new ConflictError("作品已在其他设备更新。输入已保留，请加载最新记录后合并。");
  return row;
}
export function personalWhere(entryId: string, userId: string) { return and(eq(s.personalRecords.entryId, entryId), eq(s.personalRecords.userId, userId)); }
export function validatePersonal(kind: Kind, v: z.infer<typeof personalFields>) {
  if (!validStatus(kind, v.status)) throw new InputError("电影只能选择想看或已看。");
  if ((kind === "movie" || v.status === "planned") && v.startedOn !== null) throw new InputError("当前状态不支持开始日期。");
  if (v.status !== "completed" && v.completedOn !== null) throw new InputError("完成后才能填写完成日期。");
  if (v.startedOn && v.completedOn && v.startedOn > v.completedOn) throw new InputError("读完日期不能早于开始日期。");
}
export function writeReview(entryId: string, userId: string, v: z.infer<typeof reviewFields>) {
  const old = db.select().from(s.reviews).where(and(eq(s.reviews.entryId, entryId), eq(s.reviews.userId, userId))).get();
  if ((old?.revision ?? 0) !== v.revision) {
    if (old?.revision === v.revision + 1 && old.rating === v.rating && old.body === v.body) return;
    throw new ConflictError("你的短评已在其他设备更新。请加载最新记录后合并。");
  }
  db.insert(s.reviews).values({ id: randomUUID(), entryId, userId, rating: v.rating, body: v.body, revision: v.revision + 1 })
    .onConflictDoUpdate({ target: [s.reviews.entryId, s.reviews.userId], set: { rating: v.rating, body: v.body, revision: v.revision + 1 } }).run();
}
export function writePersonal(entryId: string, userId: string, expected: number, v: z.infer<typeof personalFields>) {
  validatePersonal(getEntry(entryId).kind, v);
  const old = db.select().from(s.personalRecords).where(personalWhere(entryId, userId)).get();
  if ((old?.revision ?? 0) !== expected) {
    if (!(old && old.removedAt === null && old.revision === expected + 1 && old.status === v.status && old.startedOn === v.startedOn && old.completedOn === v.completedOn && old.pinned === v.pinned)) throw new ConflictError("你的清单已在其他设备更新。输入已保留，请加载最新记录后合并。");
  } else {
    const now = Date.now(), values = { status: v.status, startedOn: v.startedOn, completedOn: v.completedOn, pinned: v.pinned, removedAt: null, updatedAt: now, revision: expected + 1 };
    db.insert(s.personalRecords).values({ entryId, userId, createdAt: now, ...values })
      .onConflictDoUpdate({ target: [s.personalRecords.entryId, s.personalRecords.userId], set: values }).run();
  }
  if (v.review) writeReview(entryId, userId, v.review);
}
export function findCatalogEntry(item: CatalogItem) {
  const rows = db.select().from(s.entries).all();
  const strong = rows.find(e => matchesCatalogEntry(e, item));
  if (strong) return strong;
  const legacy = rows.filter(e => !e.metadata && e.kind === item.ref.kind && matchText(e.title) === matchText(item.title)).filter(e => {
    const detail = e.kind === "movie" ? db.select().from(s.movies).where(eq(s.movies.entryId, e.id)).get() : db.select().from(s.books).where(eq(s.books.entryId, e.id)).get();
    const creator = detail && ("director" in detail ? detail.director : detail.author);
    return !!item.year && detail?.year === item.year && !!creator && matchText(creator) === matchText(item.creator);
  });
  return legacy.length === 1 ? legacy[0] : undefined;
}
export function createSharedEntry(input: { id: string; kind: Kind; title: string; summary: string; coverId: string | null; links: import("./types").EntryLink[]; tags: string[]; creator: string; year: number | null; metadata?: import("./catalog-metadata").CatalogMetadata | null }) {
  const { creator, year, ...entry } = input, now = Date.now();
  db.insert(s.entries).values({ ...entry, createdAt: now, updatedAt: now }).run();
  if (input.kind === "movie") db.insert(s.movies).values({ entryId: input.id, director: creator, year }).run();
  else db.insert(s.books).values({ entryId: input.id, author: creator, year }).run();
}
