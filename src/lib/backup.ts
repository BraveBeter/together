import Database from "better-sqlite3";
import JSZip from "jszip";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, rename, writeFile, access } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { dataDir } from "./config";
export async function hashFile(file: string) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
export async function createBackup(destination: string) {
  const { sqlite } = await import("../db");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(path.join(os.tmpdir(), "tongye-backup-"));
  const archive = new JSZip(); const manifest: { version: number; createdAt: string; files: Record<string, string> } = { version: 2, createdAt: new Date().toISOString(), files: {} };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(destination, `tongye-${stamp}.zip`); const pending = `${target}.partial`;
  try {
    const snapshot = path.join(temp, "journal.sqlite"); await sqlite.backup(snapshot);
    const source = new Database(snapshot, { readonly: true, fileMustExist: true });
    let assets: { id: string }[]; let photoAssets = new Set<string>();
    try { assets = source.prepare("SELECT id FROM assets").all() as { id: string }[];
      if (source.prepare("SELECT 1 FROM sqlite_master WHERE name='photos'").get()) photoAssets = new Set((source.prepare("SELECT asset_id FROM photos").all() as { asset_id: string }[]).map(p => p.asset_id)); } finally { source.close(); }
    const files: [string, string][] = [["journal.sqlite", snapshot]];
    for (const asset of assets) for (const file of ["original", "thumb.webp", ...(photoAssets.has(asset.id) ? ["display.webp"] : [])]) files.push([`uploads/${asset.id}/${file}`, path.join(dataDir, "uploads", asset.id, file)]);
    // Media files are immutable and are never automatically removed, so the DB
    // snapshot's references remain readable even while new uploads are added.
    for (const [name, file] of files) { manifest.files[name] = await hashFile(file); archive.file(name, createReadStream(file)); }
    archive.file("manifest.json", JSON.stringify(manifest, null, 2));
    await pipeline(archive.generateNodeStream({ streamFiles: true, compression: "STORE" }), createWriteStream(pending, { mode: 0o600, flags: "wx" }));
    await rename(pending, target);
    const backups = (await readdir(destination)).filter(n => /^tongye-.*\.zip$/.test(n)).sort().reverse();
    for (const old of backups.slice(7)) await rm(path.join(destination, old));
    return target;
  } finally { await rm(temp, { recursive: true, force: true }); await rm(pending, { force: true }); }
}
export async function restoreBackup(archivePath: string, destination: string) {
  const target = path.resolve(destination);
  try { await access(target); throw new Error("目标目录已经存在。请恢复到一个新的空目录，再切换 DATA_DIR。"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const zip = await JSZip.loadAsync(await readFile(archivePath), { checkCRC32: true });
  const manifestFile = zip.file("manifest.json"); if (!manifestFile) throw new Error("不是同页备份：缺少清单。");
  const manifest = JSON.parse(await manifestFile.async("string")) as { version: number; files: Record<string, string> };
  if (![1, 2].includes(manifest.version) || !manifest.files?.["journal.sqlite"]) throw new Error("不支持的备份格式。");
  const stage = `${target}.restore-${randomUUID()}`; await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    for (const [name, hash] of Object.entries(manifest.files)) {
      if (name !== "journal.sqlite" && !/^uploads\/[0-9a-f-]{36}\/(original|thumb\.webp|display\.webp)$/.test(name)) throw new Error("备份包含不安全的路径。");
      const file = zip.file(name); if (!file) throw new Error(`备份缺少文件：${name}`);
      const bytes = await file.async("nodebuffer");
      if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`文件校验失败：${name}`);
      await mkdir(path.dirname(path.join(stage, name)), { recursive: true }); await writeFile(path.join(stage, name), bytes, { mode: 0o600 });
    }
    const check = new Database(path.join(stage, "journal.sqlite"), { readonly: true, fileMustExist: true });
    try {
      if (check.pragma("integrity_check", { simple: true }) !== "ok" || (check.pragma("foreign_key_check") as unknown[]).length) throw new Error("数据库完整性检查失败。");
      for (const row of check.prepare("SELECT id FROM assets").all() as { id: string }[]) for (const filename of ["original", "thumb.webp"]) if (!manifest.files[`uploads/${row.id}/${filename}`]) throw new Error("备份缺少数据库引用的图片。");
      if (check.prepare("SELECT 1 FROM sqlite_master WHERE name='photos'").get()) for (const row of check.prepare("SELECT asset_id FROM photos").all() as { asset_id: string }[]) if (!manifest.files[`uploads/${row.asset_id}/display.webp`]) throw new Error("备份缺少照片的大图。");
    } finally { check.close(); }
    await rename(stage, target); return target;
  } catch (e) { await rm(stage, { recursive: true, force: true }); throw e; }
}
