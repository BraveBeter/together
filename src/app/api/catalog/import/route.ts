import { currentMember } from "@/lib/session";
import { baseURL } from "@/lib/config";
import { allowCatalogRequest, catalogRefSchema, getCatalogCover, getCatalogItem, readLimited } from "@/lib/catalog-server";
import { matchesCatalogEntry, type CatalogImport } from "@/lib/catalog-metadata";
import { storeAsset } from "@/lib/assets";
import { db } from "@/db";
import { entries } from "@/db/schema";
export async function POST(request: Request) {
  const member = await currentMember(); if (!member) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(baseURL).origin) return Response.json({ error: "请求来源无效。" }, { status: 403 });
  if (!allowCatalogRequest(member.id, "import")) return Response.json({ error: "操作有点频繁，请稍等一分钟再试。" }, { status: 429 });
  let ref;
  try { ref = catalogRefSchema.parse(JSON.parse((await readLimited(new Response(request.body), 1024)).toString("utf8"))); }
  catch { return Response.json({ error: "作品标识无效，请重新选择。" }, { status: 400 }); }
  try {
    const item = await getCatalogItem(ref);
    const existing = db.select().from(entries).all().find(e => !e.deletedAt && matchesCatalogEntry(e, item));
    if (existing) return Response.json({ item, existingId: existing.id, coverId: existing.coverId, warning: "" } satisfies CatalogImport);
    let coverId: string | null = null, warning = "";
    if (item.hasCover) {
      try { const bytes = await getCatalogCover(ref); if (bytes) coverId = await storeAsset(bytes, `${item.title}-cover`, member.id); }
      catch { warning = "作品资料已填入，封面暂时未能下载。可以重新选择以重试，或稍后自行上传。"; }
    }
    return Response.json({ item, coverId, warning } satisfies CatalogImport, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "这份作品资料暂时未能读取。请重试或手动填写，已有输入会保留。" }, { status: 502 }); }
}
