import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { db } from "../db";
import { assets } from "../db/schema";
import { dataDir } from "./config";
export const uploadsDir = path.join(dataDir, "uploads");
export async function storeAsset(buffer: Buffer, filename: string, ownerId: string) {
  if (buffer.length > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB。");
  const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" });
  let meta: Metadata;
  try { meta = await image.metadata(); }
  catch { throw new Error("无法读取这张图片，请选择有效的 JPG、PNG 或 WebP 图片（最多 4000 万像素）。"); }
  if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw new Error("请上传 JPG、PNG 或 WebP 图片。");
  const thumbnail = await image.rotate().resize({ width: 720, height: 960, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  const id = randomUUID();
  const tmp = path.join(uploadsDir, `${id}.tmp`), dest = path.join(uploadsDir, id);
  await mkdir(tmp, { recursive: true, mode: 0o700 });
  try {
    await Promise.all([writeFile(path.join(tmp, "original"), buffer), writeFile(path.join(tmp, "thumb.webp"), thumbnail)]);
    await rename(tmp, dest);
    db.insert(assets).values({ id, ownerId, filename: filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120), mime: `image/${meta.format}`, size: buffer.length, createdAt: Date.now() }).run();
  } catch (e) { await rm(tmp, { recursive: true, force: true }); await rm(dest, { recursive: true, force: true }); throw e; }
  return id;
}
