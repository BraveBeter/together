import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import Database from "better-sqlite3";
import { beforeAll, expect, it, vi } from "vitest";
import type { Member } from "../src/lib/types";
import type { PhotoPoint } from "../src/lib/photo-types";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let me: Member | null = null;
vi.mock("../src/lib/session", () => ({ currentMember: async () => me }));
import { db, sqlite } from "../src/db";
import * as s from "../src/db/schema";
import { photoById, listPhotos, photoPoints, photoMoments, listTrips, photoExport } from "../src/lib/photo-server";
import { savePhotos, saveTrip, savePhotoComment, changePhotoTrash } from "../src/lib/photo-actions";
import { uploadPhoto } from "../src/lib/photo-upload";
import { distanceKm, circlePath, clusterPhotoPoints, gcjToWgs, photoDate, validCoordinates } from "../src/lib/photo-domain";
import { streetClusterDegrees, streetCoordinates, streetViewFromGlobe } from "../src/lib/map-view";
import { createBackup, restoreBackup } from "../src/lib/backup";
import { GET as getPhotos, POST as queryPhotos } from "../src/app/api/photos/route";
import { GET as getPoints } from "../src/app/api/footprints/route";
import { POST as uploadRoute } from "../src/app/api/photos/upload/route";
import { GET as getAsset } from "../src/app/api/assets/[id]/route";
import { GET as getPlaces } from "../src/app/api/places/search/route";
const first: Member = { id: "photo-member-a", name: "第一位", email: "one@photo.test", seat: 0, color: "green", avatarId: null };
const second: Member = { ...first, id: "photo-member-b", name: "第二位", email: "two@photo.test", seat: 1 };
const people = [first.id, second.id], trip = randomUUID();
let jpeg: Buffer, photoId: string, soloId: string;
beforeAll(async () => {
  for (const m of [first, second]) { db.insert(s.user).values({ id: m.id, name: m.name, email: m.email, createdAt: new Date(), updatedAt: new Date() }).run(); db.insert(s.members).values({ userId: m.id, seat: m.seat, color: m.color }).run(); }
  jpeg = await sharp({ create: { width: 90, height: 60, channels: 3, background: "#445566" } }).jpeg().withExif({ IFD2: { DateTimeOriginal: "2020:05:20 23:45:00", OffsetTimeOriginal: "+08:00" } }).toBuffer();
  me = first;
});
it("未登录无法读取照片、点位、地点服务、上传与个人评论", async () => {
  me = null;
  for (const handler of [getPhotos, getPoints, getPlaces]) expect((await handler(new Request("http://localhost:3011/api/photos"))).status).toBe(401);
  expect((await queryPhotos(new Request("http://localhost:3011/api/photos", { method: "POST" }))).status).toBe(401);
  expect((await uploadRoute(new Request("http://localhost:3011/api/photos/upload", { method: "POST" }))).status).toBe(401);
  expect((await saveTrip({})).ok).toBe(false); expect((await savePhotos({})).ok).toBe(false); expect((await savePhotoComment({})).ok).toBe(false); me = first;
});
it("真实上传保留拍摄日期与偏移，生成私密大图，相同文件并发上传只存一份", async () => {
  const results = await Promise.all([uploadPhoto(jpeg, "fixture.jpg", first, people, null), uploadPhoto(jpeg, "duplicate.jpg", second, [second.id], null)]);
  photoId = results[0].photo.id; expect(results[1].photo.id).toBe(photoId); expect(results.map(r => r.duplicate)).toEqual([false, true]);
  const photo = photoById(photoId); expect(photo.takenOn).toBe("2020-05-20"); expect(photo.originalMetadata.offset).toBe("+08:00"); expect(photo.participants.sort()).toEqual([...people].sort()); expect(photo.latitude).toBeNull();
  const image = await getAsset(new Request("http://localhost:3011/api/assets/ignored?size=display"), { params: Promise.resolve({ id: photo.assetId }) }); expect(image.status).toBe(200); expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width).toBe(90);
  me = null; expect((await getAsset(new Request("http://localhost:3011/api/assets/ignored"), { params: Promise.resolve({ id: photo.assetId }) })).status).toBe(401); me = first;
});
it("无 EXIF 的图片保持日期未记；非法文件与超限不会写入资产", async () => {
  const png = await sharp({ create: { width: 30, height: 50, channels: 3, background: "#caab89" } }).png().toBuffer();
  const result = await uploadPhoto(png, "unknown.png", first, [first.id], null); soloId = result.photo.id; expect(result.photo.takenOn).toBeNull();
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get();
  await expect(uploadPhoto(Buffer.from("not an image"), "bad.jpg", first, people, null)).rejects.toThrow("无法处理");
  await expect(uploadPhoto(Buffer.alloc(25 * 1024 * 1024 + 1), "large.jpg", first, people, null)).rejects.toThrow("25 MB");
  await expect(uploadPhoto(png, "bad-member.png", first, ["outsider"], null)).rejects.toThrow("成员");
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM assets").get()).toEqual(before);
});
it("双方编辑共享资料：批量操作原子化、旧版本报错，手动位置不覆盖 EXIF", async () => {
  const old = photoById(photoId); me = second;
  expect((await savePhotos({ photos: [{ id: photoId, revision: old.revision }], changes: { caption: "这一天的海风", location: { lat: 31.23, lng: 121.47, place: "测试海边", source: "manual" } } })).ok).toBe(true);
  const changed = photoById(photoId); expect(changed.originalMetadata).toEqual(old.originalMetadata); expect(changed.locationSource).toBe("manual");
  const failed = await savePhotos({ photos: [{ id: soloId, revision: photoById(soloId).revision }, { id: photoId, revision: old.revision }], changes: { caption: "不应部分保存" } });
  expect(failed.ok).toBe(false); if (!failed.ok) expect(failed.conflict).toBe(true); expect(photoById(soloId).caption).toBe("");
  expect((await savePhotos({ photos: [{ id: photoId, revision: changed.revision }], changes: { participants: [] } })).ok).toBe(false); me = first;
});
it("评论按作者授权，重复提交不重复，照片回收与恢复保留评论和资料", async () => {
  const comment = { id: randomUUID(), photoId, body: "记得这阵风。", revision: 0 };
  expect((await savePhotoComment(comment)).ok).toBe(true); expect((await savePhotoComment(comment)).ok).toBe(true);
  expect(photoById(photoId).commentCount).toBe(1); me = second;
  expect((await savePhotoComment({ ...comment, revision: 1, body: "篡改" })).ok).toBe(false);
  const before = photoById(photoId); expect((await changePhotoTrash({ id: photoId, revision: before.revision, restore: false })).ok).toBe(true);
  expect(listPhotos(new URLSearchParams()).items.some(p => p.id === photoId)).toBe(false); expect(photoPoints(new URLSearchParams())).toHaveLength(0);
  expect(photoMoments(new URLSearchParams("view=shared")).items).toHaveLength(0);
  const duplicate = await uploadPhoto(jpeg, "again.jpg", first, people, null); expect(duplicate.duplicate).toBe(true); expect(duplicate.photo.deletedAt).not.toBeNull();
  expect((await changePhotoTrash({ id: photoId, revision: duplicate.photo.revision, restore: true })).ok).toBe(true); expect(photoById(photoId).commentCount).toBe(1);
  me = first; expect((await savePhotoComment({ ...comment, revision: 1, body: "记得这阵温柔的风。" })).ok).toBe(true);
});
it("照片参与者决定时光轴；同一日同一旅行只生成一个照片事件，足迹是筛选不是副本", async () => {
  me = first; expect((await saveTrip({ id: trip, title: "我们的测试旅行", description: "一段故事", revision: 0 })).ok).toBe(true);
  const photo = photoById(photoId); expect((await savePhotos({ photos: [{ id: photoId, revision: photo.revision }], changes: { tripId: trip } })).ok).toBe(true);
  const all = photoMoments(new URLSearchParams("view=shared")).items;
  expect(all).toHaveLength(1); expect(all[0].tripId).toBe(trip); expect(all[0].located).toBe(1);
  expect(photoMoments(new URLSearchParams("view=shared&kind=travel")).items.map(m => m.id)).toEqual(all.map(m => m.id));
  expect(photoMoments(new URLSearchParams({ view: first.id })).items).toHaveLength(2); expect(photoMoments(new URLSearchParams({ view: second.id })).items).toHaveLength(1);
  expect(photoMoments(new URLSearchParams({ view: first.id })).items.at(-1)?.date).toBeNull();
  const t = listTrips()[0]; expect(t.startedOn).toBe("2020-05-20"); expect((await saveTrip({ ...t, revision: t.revision, coverPhotoId: photoId, remove: false, photoCount: undefined })).ok).toBe(false);
  expect((await saveTrip({ id: t.id, title: t.title, description: t.description, revision: t.revision, coverPhotoId: photoId })).ok).toBe(true);
  expect(listTrips()[0].coverAssetId).toBe(photoById(photoId).assetId);
});
it("圈选、年份及参与者查询一致，分页稳定，不因同一天而丢失照片", () => {
  expect(listPhotos(new URLSearchParams("lat=31.23&lng=121.47&radius=0.1")).items.map(p => p.id)).toEqual([photoId]);
  expect(listPhotos(new URLSearchParams("lat=0&lng=0&radius=20")).total).toBe(0);
  expect(listPhotos(new URLSearchParams("year=undated")).items.map(p => p.id)).toEqual([soloId]);
  const asset = photoById(soloId).assetId;
  // Distinct immutable assets/rows, independent of files, for a large query fixture.
  sqlite.transaction(() => { for (let i = 0; i < 2000; i++) { const id = randomUUID(), a = randomUUID(); sqlite.prepare("INSERT INTO assets (id,owner_id,mime,filename,size,created_at) SELECT ?,owner_id,mime,filename,size,created_at FROM assets WHERE id=?").run(a, asset); sqlite.prepare("INSERT INTO photos (id,asset_id,content_hash,width,height,taken_on,latitude,longitude,location_source,uploaded_by,created_at,updated_at) VALUES (?,?,?,10,10,'2001-01-01',?,?,'manual',?,1,1)").run(id, a, `query-fixture-${i}`, i % 160 - 80, i % 358 - 179, first.id); sqlite.prepare("INSERT INTO photo_participants VALUES (?,?)").run(id, first.id); } }).immediate();
  const seen = new Set<string>(); let cursor: string | null = null;
  do { const p = new URLSearchParams("year=2001"); if (cursor) p.set("cursor", cursor); const result = listPhotos(p); expect(result.total).toBe(2000); for (const photo of result.items) { expect(seen.has(photo.id)).toBe(false); seen.add(photo.id); } cursor = result.cursor; } while (cursor);
  expect(seen.size).toBe(2000); expect(photoPoints(new URLSearchParams("year=2001"))).toHaveLength(2000);
  sqlite.exec("DELETE FROM photo_participants WHERE photo_id IN (SELECT id FROM photos WHERE content_hash LIKE 'query-fixture-%'); CREATE TEMP TABLE test_asset_ids AS SELECT asset_id FROM photos WHERE content_hash LIKE 'query-fixture-%'; DELETE FROM photos WHERE content_hash LIKE 'query-fixture-%'; DELETE FROM assets WHERE id IN (SELECT asset_id FROM test_asset_ids); DROP TABLE test_asset_ids;");
});
it("地球球面距离、聚合跨经线和极区，圈边界包含一致", () => {
  expect(distanceKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeLessThan(23);
  expect(distanceKm({ lat: 89.9, lng: 0 }, { lat: 89.9, lng: 180 })).toBeLessThan(23);
  const origin = { lat: 80, lng: 179 }, ring = circlePath(origin, 200);
  for (const p of ring) expect(distanceKm(origin, p)).toBeCloseTo(200, 5);
  const point = (id: string, lat: number, lng: number): PhotoPoint => ({ id, lat, lng, assetId: id, takenOn: null, place: "", tripId: null, participants: [] });
  const points = [point("a", 0, 179.9), point("b", 0, -179.9), point("c", 89.9, 0), point("d", 89.9, 180)];
  expect(clusterPhotoPoints(points, 1).map(c => c.count)).toEqual([2, 2]); expect(clusterPhotoPoints(points, .01)).toHaveLength(4);
  expect(validCoordinates(0, 0)).toBe(true); expect(validCoordinates(NaN, 0)).toBe(false); expect(validCoordinates(90.1, 0)).toBe(false);
  const beijing = gcjToWgs({ lat: 39.908823, lng: 116.39747 }); expect(beijing.lat).toBeCloseTo(39.90742, 3); expect(beijing.lng).toBeCloseTo(116.39123, 3);
  expect(gcjToWgs({ lat: 51.5, lng: -.1 })).toEqual({ lat: 51.5, lng: -.1 });
  expect(photoDate("2024:02:29 23:59:59")).toBe("2024-02-29"); expect(photoDate("2023:02:29 00:00:00")).toBeNull(); expect(photoDate(undefined)).toBeNull();
});
it("街道级缩放展开相距十几米的照片，切换视图保留坐标并约束墨卡托极区", () => {
  const point = (id: string, lat: number): PhotoPoint => ({ id, lat, lng: 121.47, assetId: id, takenOn: null, place: "", tripId: null, participants: [] });
  const points = [point("near-a", 31.23), point("near-b", 31.23015)];
  expect(clusterPhotoPoints(points, streetClusterDegrees(10, 31.23))).toHaveLength(1);
  expect(clusterPhotoPoints(points, streetClusterDegrees(19, 31.23))).toHaveLength(2);
  expect(clusterPhotoPoints([...points, point("same-place", 31.23)], streetClusterDegrees(19, 31.23)).map(c => c.count).sort()).toEqual([1, 2]);
  const view = streetViewFromGlobe({ lat: 31.23, lng: 121.47, altitude: .18 }, 650);
  expect(view.lat).toBe(31.23); expect(view.lng).toBeCloseTo(121.47); expect(view.zoom).toBeGreaterThanOrEqual(5);
  expect(streetCoordinates({ lat: 90, lng: 540 })).toEqual({ lat: 85.0511, lng: -180 });
  expect(streetCoordinates({ lat: -90, lng: -540 })).toEqual({ lat: -85.0511, lng: -180 });
});
it("完整备份恢复包含大图、评论、旅行与原始元数据；解散旅行不删照片", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "photo-restore-"));
  try {
    const backup = await createBackup(path.join(folder, "backups")), target = await restoreBackup(backup, path.join(folder, "restored"));
    const restored = new Database(path.join(target, "journal.sqlite"), { readonly: true });
    for (const table of ["photos", "photo_comments", "photo_participants", "trips"]) expect(restored.prepare(`SELECT * FROM ${table}`).all()).toEqual(sqlite.prepare(`SELECT * FROM ${table}`).all());
    restored.close(); expect((await readFile(path.join(target, "uploads", photoById(photoId).assetId, "display.webp"))).length).toBeGreaterThan(20);
    expect(photoExport().photos).toHaveLength(2);
    const t = listTrips()[0]; expect((await saveTrip({ id: t.id, title: t.title, description: t.description, coverPhotoId: t.coverPhotoId, revision: t.revision, remove: true })).ok).toBe(true);
    expect(photoById(photoId).tripId).toBeNull(); expect(photoById(photoId).commentCount).toBe(1); expect(listTrips()).toHaveLength(0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
it("HEIC 经独立解码进程生成可浏览预览；4800 万像素 JPEG 正确缩放", async () => {
  const heic = await uploadPhoto(await readFile("tests/fixtures/synthetic.heic"), "synthetic.heic", first, people, null);
  expect(heic.photo.width).toBe(64); expect(heic.photo.height).toBe(48);
  const big = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#796a82" } }).jpeg().toBuffer();
  const result = await uploadPhoto(big, "synthetic-48mp.jpg", first, people, null);
  expect(result.photo.width * result.photo.height).toBe(48_000_000);
  const r = await getAsset(new Request("http://localhost:3011/api/assets/ignored?size=display"), { params: Promise.resolve({ id: result.photo.assetId }) });
  expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width).toBe(2560);
}, 30_000);
it("EXIF GPS 使用原始经纬度，旋转方向生效，缺少拍摄日期不补今天", async () => {
  const image = await sharp({ create: { width: 80, height: 50, channels: 3, background: "#888888" } }).jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 13/1 48/1", GPSLongitudeRef: "E", GPSLongitude: "121/1 28/1 12/1" } }).toBuffer();
  const { photo } = await uploadPhoto(image, "synthetic-gps.jpg", first, people, null);
  expect(photo.latitude).toBeCloseTo(31.23, 6); expect(photo.longitude).toBeCloseTo(121.47, 6);
  expect(photo.locationSource).toBe("exif"); expect(photo.originalMetadata.latitude).toBe(photo.latitude);
  expect(photo.takenOn).toBeNull(); expect(photo.width).toBe(50); expect(photo.height).toBe(80);
  const response = await getAsset(new Request("http://localhost:3011/api/assets/ignored?size=display"), { params: Promise.resolve({ id: photo.assetId }) });
  const output = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  expect(output.width).toBe(50); expect(output.height).toBe(80); expect(output.exif).toBeUndefined();
});
