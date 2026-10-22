import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlite } from "../db";
import { ConflictError, InputError } from "./records";
import { distanceKm } from "./photo-domain";
import type { Member } from "./types";
import type { Photo, PhotoComment, PhotoMoment, PhotoPage, PhotoPoint, Trip } from "./photo-types";

sqlite.function("photo_distance", { deterministic: true }, (lat, lng, centerLat, centerLng) => {
  if (lat === null || lng === null) return 99_999;
  return distanceKm({ lat: Number(lat), lng: Number(lng) }, { lat: Number(centerLat), lng: Number(centerLng) });
});
const id = z.string().uuid(), rev = z.number().int().min(1);
const participants = z.array(z.string().min(1).max(100)).min(1, "请选择参与者").max(2);
const location = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), place: z.string().trim().max(200), source: z.enum(["exif", "manual", "amap"]) }).nullable();
export const photoPatch = z.object({
  caption: z.string().trim().max(2000).optional(), takenOn: z.iso.date().nullable().optional(),
  participants: participants.optional(), tripId: id.nullable().optional(), location: location.optional(),
}).strict();
const columns = `p.id, p.asset_id AS assetId, p.caption, p.width, p.height, p.taken_on AS takenOn,
 p.original_metadata AS originalMetadata, p.latitude, p.longitude, p.place, p.location_source AS locationSource,
 p.trip_id AS tripId, t.title AS tripTitle, p.uploaded_by AS uploadedBy,
 p.revision, p.created_at AS createdAt, p.updated_at AS updatedAt, p.deleted_at AS deletedAt,
 (SELECT json_group_array(user_id) FROM photo_participants WHERE photo_id=p.id) AS participants,
 (SELECT COUNT(*) FROM photo_comments WHERE photo_id=p.id AND deleted_at IS NULL) AS commentCount`;
const from = "FROM photos p LEFT JOIN trips t ON t.id=p.trip_id AND t.deleted_at IS NULL";
type Row = Omit<Photo, "participants" | "originalMetadata"> & { participants: string; originalMetadata: string };
const decode = (row: Row): Photo => ({ ...row, participants: JSON.parse(row.participants), originalMetadata: JSON.parse(row.originalMetadata) });
export function photoById(photoId: string, includeTrash = false): Photo {
  id.parse(photoId);
  const row = sqlite.prepare(`SELECT ${columns} ${from} WHERE p.id=? ${includeTrash ? "" : "AND p.deleted_at IS NULL"}`).get(photoId) as Row | undefined;
  if (!row) throw new InputError("照片不存在或已移入回收站。");
  return decode(row);
}
export function photoByHash(hash: string) {
  const row = sqlite.prepare(`SELECT ${columns} ${from} WHERE p.content_hash=?`).get(hash) as Row | undefined;
  return row ? decode(row) : undefined;
}
export function validatePhotoLinks(values: { participants?: string[]; tripId?: string | null }) {
  if (values.participants) {
    const ids = participants.parse(values.participants);
    if (new Set(ids).size !== ids.length || ids.some(userId => !sqlite.prepare("SELECT 1 FROM members WHERE user_id=?").get(userId))) throw new InputError("参与者必须是空间内的成员。");
  }
  if (values.tripId && !sqlite.prepare("SELECT 1 FROM trips WHERE id=? AND deleted_at IS NULL").get(values.tripId)) throw new ConflictError("旅行已被解散，请重新选择。");
}
function wherePhotos(params: URLSearchParams, ids?: string[]) {
  const clauses = [params.get("trash") === "1" ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"], args: (string | number)[] = [];
  const view = params.get("view");
  if (view === "shared") clauses.push("(SELECT COUNT(*) FROM photo_participants WHERE photo_id=p.id)=(SELECT COUNT(*) FROM members)");
  else if (view && view !== "all") { clauses.push("EXISTS (SELECT 1 FROM photo_participants WHERE photo_id=p.id AND user_id=?)"); args.push(view); }
  const year = params.get("year");
  if (year === "undated") clauses.push("p.taken_on IS NULL");
  else if (year && /^\d{4}$/.test(year)) { clauses.push("p.taken_on>=? AND p.taken_on<?"); args.push(`${year}-01-01`, `${Number(year) + 1}-01-01`); }
  if (params.get("date")) { const date = params.get("date")!; if (date === "undated") clauses.push("p.taken_on IS NULL"); else { z.iso.date().parse(date); clauses.push("p.taken_on=?"); args.push(date); } }
  if (params.get("trip")) { id.parse(params.get("trip")); clauses.push("p.trip_id=?"); args.push(params.get("trip")!); }
  if (params.get("unlocated") === "1") clauses.push("p.latitude IS NULL");
  if (params.get("kind") === "travel") clauses.push("(p.latitude IS NOT NULL OR p.trip_id IS NOT NULL)");
  const lat = params.get("lat"), lng = params.get("lng"), radius = params.get("radius");
  if (lat !== null || lng !== null || radius !== null) {
    const circle = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radius: z.coerce.number().min(.1).max(10000) }).parse({ lat: lat ?? NaN, lng: lng ?? NaN, radius: radius ?? NaN });
    clauses.push("p.latitude IS NOT NULL AND photo_distance(p.latitude,p.longitude,?,?)<=?"); args.push(circle.lat, circle.lng, circle.radius);
  }
  if (ids) { z.array(id).max(10000).parse(ids); clauses.push("p.id IN (SELECT value FROM json_each(?))"); args.push(JSON.stringify(ids)); }
  return { sql: clauses.join(" AND "), args };
}
export function listTrips(): Trip[] {
  return sqlite.prepare(`SELECT t.id,t.title,t.description,t.cover_photo_id AS coverPhotoId,t.revision,
    (SELECT p.asset_id FROM photos p WHERE p.trip_id=t.id AND p.deleted_at IS NULL ORDER BY (p.id=t.cover_photo_id) DESC,p.taken_on DESC,p.created_at DESC LIMIT 1) AS coverAssetId,
    COUNT(p.id) AS photoCount, MIN(p.taken_on) AS startedOn, MAX(p.taken_on) AS endedOn
    FROM trips t LEFT JOIN photos p ON p.trip_id=t.id AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL GROUP BY t.id ORDER BY MAX(p.taken_on) DESC,t.created_at DESC`).all() as Trip[];
}
export function listPhotos(params: URLSearchParams, ids?: string[]): PhotoPage {
  const where = wherePhotos(params, ids);
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM photos p WHERE ${where.sql}`).get(...where.args) as { n: number }).n;
  const more = [...where.args]; let cursorSQL = "";
  if (params.get("cursor")) {
    try {
      const c = z.tuple([z.string().max(10), z.number(), id]).parse(JSON.parse(Buffer.from(params.get("cursor")!, "base64url").toString()));
      cursorSQL = " AND (COALESCE(p.taken_on,''),p.created_at,p.id)<(?,?,?)"; more.push(...c);
    } catch { throw new InputError("分页位置无效，请重新打开照片墙。"); }
  }
  const rows = sqlite.prepare(`SELECT ${columns} ${from} WHERE ${where.sql}${cursorSQL} ORDER BY COALESCE(p.taken_on,'') DESC,p.created_at DESC,p.id DESC LIMIT 49`).all(...more) as Row[];
  const items = rows.slice(0, 48).map(decode), last = items.at(-1);
  return { items, total, cursor: rows.length > 48 && last ? Buffer.from(JSON.stringify([last.takenOn ?? "", last.createdAt, last.id])).toString("base64url") : null,
    trips: listTrips(), years: (sqlite.prepare("SELECT DISTINCT substr(taken_on,1,4) AS year FROM photos WHERE deleted_at IS NULL AND taken_on IS NOT NULL ORDER BY year DESC").all() as { year: string }[]).map(r => r.year) };
}
export function photoPoints(params: URLSearchParams): PhotoPoint[] {
  const where = wherePhotos(params);
  return (sqlite.prepare(`SELECT p.id,p.asset_id AS assetId,p.latitude AS lat,p.longitude AS lng,p.place,p.taken_on AS takenOn,p.trip_id AS tripId,
   (SELECT json_group_array(user_id) FROM photo_participants WHERE photo_id=p.id) AS participants
   FROM photos p WHERE ${where.sql} AND p.latitude IS NOT NULL ORDER BY p.id`).all(...where.args) as (Omit<PhotoPoint, "participants"> & { participants: string })[]).map(p => ({ ...p, participants: JSON.parse(p.participants) }));
}
export function photoMoments(params: URLSearchParams, limit = 40) {
  const where = wherePhotos(params), cursor = params.get("momentCursor");
  const offset = cursor ? z.coerce.number().int().min(0).max(1_000_000).parse(cursor) : 0;
  const groups = sqlite.prepare(`SELECT COALESCE(p.taken_on,'') AS day, COALESCE(p.trip_id,'') AS trip,
    MAX(p.created_at) AS latest,COUNT(*) AS total,SUM(p.latitude IS NOT NULL) AS located,MAX(t.title) AS title
    ${from} WHERE ${where.sql} GROUP BY p.taken_on,p.trip_id ORDER BY day DESC,latest DESC,trip DESC LIMIT ? OFFSET ?`).all(...where.args, limit + 1, offset) as { day: string; trip: string; latest: number; total: number; located: number; title: string | null }[];
  const moments: PhotoMoment[] = groups.slice(0, limit).map(group => {
    const photos = sqlite.prepare(`SELECT p.id,p.asset_id AS assetId,p.caption,p.place FROM photos p WHERE ${where.sql} AND COALESCE(p.taken_on,'')=? AND COALESCE(p.trip_id,'')=? ORDER BY p.created_at DESC,p.id DESC LIMIT 6`).all(...where.args, group.day, group.trip) as PhotoMoment["photos"];
    return { type: "photos", id: `photos:${group.day}:${group.trip}`, date: group.day || null, order: group.latest, title: group.title || (group.located ? "在世界留下的片刻" : "收藏的片刻"), tripId: group.trip || null, total: group.total, located: group.located, photos };
  });
  return { items: moments, cursor: groups.length > limit ? String(offset + limit) : null };
}
export function readPhotoComments(photoId: string): PhotoComment[] {
  photoById(photoId);
  return sqlite.prepare(`SELECT id,photo_id AS photoId,author_id AS authorId,body,revision,created_at AS createdAt,updated_at AS updatedAt
   FROM photo_comments WHERE photo_id=? AND deleted_at IS NULL ORDER BY created_at,id`).all(photoId) as PhotoComment[];
}
export function updatePhotos(input: unknown) {
  const v = z.object({ photos: z.array(z.object({ id, revision: rev })).min(1).max(50), changes: photoPatch }).strict().parse(input);
  if (new Set(v.photos.map(p => p.id)).size !== v.photos.length) throw new InputError("同一张照片不能重复选择。");
  return sqlite.transaction(() => {
    validatePhotoLinks(v.changes);
    for (const target of v.photos) {
      const old = photoById(target.id);
      if (old.revision !== target.revision) throw new ConflictError("照片已被更新。请加载最新资料后合并，当前输入已保留。");
      const sets = ["revision=revision+1", "updated_at=?"], args: (string | number | null)[] = [Date.now()];
      if (v.changes.caption !== undefined) { sets.push("caption=?"); args.push(v.changes.caption); }
      if (v.changes.takenOn !== undefined) { sets.push("taken_on=?"); args.push(v.changes.takenOn); }
      if (v.changes.tripId !== undefined) { sets.push("trip_id=?"); args.push(v.changes.tripId); }
      if (v.changes.location !== undefined) { const l = v.changes.location; sets.push("latitude=?", "longitude=?", "place=?", "location_source=?"); args.push(l?.lat ?? null, l?.lng ?? null, l?.place ?? "", l?.source ?? null); }
      sqlite.prepare(`UPDATE photos SET ${sets.join(",")} WHERE id=?`).run(...args, target.id);
      if (v.changes.participants) {
        sqlite.prepare("DELETE FROM photo_participants WHERE photo_id=?").run(target.id);
        for (const memberId of v.changes.participants) sqlite.prepare("INSERT INTO photo_participants VALUES (?,?)").run(target.id, memberId);
      }
    }
    return v.photos.map(p => photoById(p.id));
  }).immediate();
}
export function photoTrash(input: unknown) {
  const v = z.object({ id, revision: rev, restore: z.boolean() }).strict().parse(input);
  return sqlite.transaction(() => {
    const photo = photoById(v.id, true);
    if ((photo.deletedAt === null) === v.restore && photo.revision === v.revision + 1) return photo;
    if (photo.revision !== v.revision) throw new ConflictError("照片已更新，请刷新后重试。");
    sqlite.prepare("UPDATE photos SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(v.restore ? null : Date.now(), Date.now(), v.id);
    return photoById(v.id, true);
  }).immediate();
}
export function writePhotoComment(member: Member, input: unknown) {
  const v = z.object({ id, photoId: id, revision: z.number().int().min(0), body: z.string().trim().min(1, "写下一点感受吧").max(2000), remove: z.boolean().default(false) }).strict().parse(input);
  return sqlite.transaction(() => {
    photoById(v.photoId);
    const old = sqlite.prepare("SELECT author_id,photo_id,revision,body,deleted_at FROM photo_comments WHERE id=?").get(v.id) as { author_id: string; photo_id: string; revision: number; body: string; deleted_at: number | null } | undefined;
    if (old && (old.author_id !== member.id || old.photo_id !== v.photoId)) throw new InputError("只能修改自己的评论。");
    if (old && old.revision === v.revision + 1 && (v.remove ? old.deleted_at !== null : old.body === v.body && old.deleted_at === null)) return;
    if ((old?.revision ?? 0) !== v.revision || old?.deleted_at) throw new ConflictError("评论已经更新，请重新打开后编辑。输入已保留。");
    const now = Date.now();
    if (!old) { if (v.remove) throw new InputError("评论不存在。"); sqlite.prepare("INSERT INTO photo_comments (id,photo_id,author_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(v.id, v.photoId, member.id, v.body, now, now); }
    else sqlite.prepare("UPDATE photo_comments SET body=?,revision=revision+1,updated_at=?,deleted_at=? WHERE id=?").run(v.body, now, v.remove ? now : null, v.id);
  }).immediate();
}
export function writeTrip(member: Member, input: unknown) {
  const v = z.object({ id, revision: z.number().int().min(0), title: z.string().trim().min(1, "给旅行起个名字").max(100), description: z.string().trim().max(5000), coverPhotoId: id.nullable().default(null), remove: z.boolean().default(false) }).strict().parse(input);
  return sqlite.transaction(() => {
    const old = sqlite.prepare("SELECT * FROM trips WHERE id=? AND deleted_at IS NULL").get(v.id) as { revision: number; title: string; description: string; cover_photo_id: string | null } | undefined;
    if ((old?.revision ?? 0) !== v.revision) {
      if (!v.remove && old?.revision === v.revision + 1 && old.title === v.title && old.description === v.description && old.cover_photo_id === v.coverPhotoId) return v.id;
      throw new ConflictError("旅行已更新，请刷新后合并。输入已保留。");
    }
    const now = Date.now();
    if (v.remove) {
      if (!old) throw new InputError("旅行不存在。");
      sqlite.prepare("UPDATE photos SET trip_id=NULL,revision=revision+1,updated_at=? WHERE trip_id=?").run(now, v.id);
      sqlite.prepare("UPDATE trips SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(now, now, v.id);
    } else {
      if (v.coverPhotoId && photoById(v.coverPhotoId).tripId !== v.id) throw new InputError("请选择这次旅行中的照片作为封面。");
      sqlite.prepare(`INSERT INTO trips (id,title,description,cover_photo_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,cover_photo_id=excluded.cover_photo_id,updated_at=excluded.updated_at,revision=trips.revision+1`).run(v.id, v.title, v.description, v.coverPhotoId, member.id, now, now);
    }
    return v.id;
  }).immediate();
}
export function photoExport() {
  return { photos: (sqlite.prepare(`SELECT ${columns} ${from} ORDER BY p.created_at,p.id`).all() as Row[]).map(decode),
    trips: sqlite.prepare("SELECT * FROM trips ORDER BY created_at,id").all(), photoComments: sqlite.prepare("SELECT * FROM photo_comments ORDER BY created_at,id").all() };
}
