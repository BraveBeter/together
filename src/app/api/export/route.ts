import JSZip from "jszip";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import path from "node:path";
import { db, sqlite } from "@/db";
import { assets } from "@/db/schema";
import { currentMember } from "@/lib/session";
import { readData } from "@/lib/data";
import { uploadsDir } from "@/lib/assets";
import { photoExport } from "@/lib/photo-server";
import { getImport, listImports, importReport } from "@/lib/import-server";
export const dynamic = "force-dynamic";
export async function GET() {
  const me = await currentMember(); if (!me) return new Response(null, { status: 401 });
  const data = sqlite.transaction(() => readData(me))();
  const photoData = photoExport(), photoAssets = new Set(photoData.photos.map(p => p.assetId));
  const ids = new Set([...photoAssets, ...data.entries.map(e => e.coverId), ...data.memories.flatMap(m => m.photos), ...data.members.map(m => m.avatarId)].filter(Boolean));
  const media = db.select().from(assets).all().filter(a => ids.has(a.id));
  const zip = new JSZip();
  for (const batch of listImports(me, true)) zip.file(`imports/${batch.id}.csv`, importReport(getImport(me, batch.id)));
  zip.file("journal.json", JSON.stringify({ version: 4, ...photoData, exportedAt: new Date().toISOString(), settings: data.settings, members: data.members, entries: data.entries, personalRecords: data.entries.flatMap(e => e.personalRecords), togetherConfirmations: data.entries.flatMap(e => e.together ? [e.together] : []), recommendations: data.recommendations, memories: data.memories, reviews: data.reviews, challenges: data.challenges, assets: media }, null, 2));
  for (const asset of media) for (const file of ["original", "thumb.webp", ...(photoAssets.has(asset.id) ? ["display.webp"] : [])]) zip.file(`media/${asset.id}/${file}`, createReadStream(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ uploadsDir, asset.id, file)));
  zip.file("README.txt", "同页 · 你的生活收藏\n\njournal.json 包含作品、个人清单、个人日期、共同完成确认、短评、推荐、共同回忆、挑战、照片、参与者、旅行与评论。\nmedia/<图片 ID>/original 为原图，格式与原文件名见 assets 字段；thumb.webp 为缩略图；照片额外包含 display.webp 浏览大图。\n不包含账户密码或会话。\n此文件用于内容导出；完整恢复服务器请使用 npm run backup 生成的数据库备份。\n");
  const stream = zip.generateNodeStream({ streamFiles: true, compression: "STORE" });
  return new Response(Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="tongye-export-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "private, no-store" } });
}
