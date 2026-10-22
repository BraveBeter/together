import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { sqlite } from "../db";
import { uploadsDir } from "./assets";
import { photoByHash, photoById, validatePhotoLinks } from "./photo-server";
import { photoDate } from "./photo-domain";
import { InputError } from "./records";
import type { Member } from "./types";
import type { OriginalPhotoMetadata } from "./photo-types";
const execute = promisify(execFile);
// One decoder per app process, shared across hot reloads and concurrent requests.
const state = globalThis as unknown as { photoDecoder?: { tail: Promise<unknown>; queued: number } };
function decoderQueue() { return state.photoDecoder ??= { tail: Promise.resolve(), queued: 0 }; }
export async function uploadPhoto(bytes: Buffer, name: string, member: Member, participantIds: string[], tripId: string | null) {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new InputError("请选择不超过 25 MB 的照片。");
  validatePhotoLinks({ participants: participantIds, tripId });
  const hash = createHash("sha256").update(bytes).digest("hex"), existing = photoByHash(hash);
  if (existing) return { photo: existing, duplicate: true };
  const queue = decoderQueue();
  if (queue.queued >= 6) throw new InputError("照片正在处理中，请稍后重试这一张。");
  queue.queued++;
  const task = queue.tail.catch(() => {}).then(async () => {
    const again = photoByHash(hash); if (again) return { photo: again, duplicate: true };
    const assetId = randomUUID(), photoId = randomUUID(), temp = path.join(uploadsDir, `${assetId}.tmp`), destination = path.join(uploadsDir, assetId);
    let committed = false;
    await mkdir(temp, { recursive: true, mode: 0o700 });
    try {
      await writeFile(path.join(temp, "original"), bytes, { mode: 0o600 });
      try {
        await execute(process.execPath, ["--max-old-space-size=384", path.resolve(/* turbopackIgnore: true */ "scripts/photo-worker.cjs"), temp], { timeout: 120_000, maxBuffer: 256_000, windowsHide: true });
      } catch { throw new InputError("无法处理这张照片。请使用有效的 JPG、PNG、WebP 或 HEIC 静态图片，最多 8000 万像素。可单独重试。"); }
      const result = JSON.parse(await readFile(path.join(temp, "metadata.json"), "utf8")) as { width: number; height: number; mime: string; metadata: OriginalPhotoMetadata };
      await rm(path.join(temp, "metadata.json")); await rename(temp, destination);
      const photo = sqlite.transaction(() => {
        validatePhotoLinks({ participants: participantIds, tripId });
        const duplicate = photoByHash(hash); if (duplicate) return duplicate;
        const now = Date.now(), metadata = result.metadata;
        sqlite.prepare("INSERT INTO assets (id,owner_id,mime,filename,size,created_at) VALUES (?,?,?,?,?,?)").run(assetId, member.id, result.mime, name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120), bytes.length, now);
        sqlite.prepare(`INSERT INTO photos (id,asset_id,content_hash,width,height,taken_on,original_metadata,latitude,longitude,location_source,trip_id,uploaded_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(photoId, assetId, hash, result.width, result.height, photoDate(metadata.capturedAt), JSON.stringify(metadata), metadata.latitude, metadata.longitude, metadata.latitude === null ? null : "exif", tripId, member.id, now, now);
        for (const userId of participantIds) sqlite.prepare("INSERT INTO photo_participants VALUES (?,?)").run(photoId, userId);
        return photoById(photoId);
      }).immediate();
      committed = photo.id === photoId;
      return { photo, duplicate: !committed };
    } finally {
      await rm(temp, { recursive: true, force: true });
      if (!committed) await rm(destination, { recursive: true, force: true });
    }
  });
  queue.tail = task; try { return await task; } finally { queue.queued--; }
}
