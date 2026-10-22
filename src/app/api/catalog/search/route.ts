import { z } from "zod";
import { currentMember } from "@/lib/session";
import { allowCatalogRequest, searchCatalog } from "@/lib/catalog-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: "请先登录。" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ kind: z.enum(["movie", "book"]), q: z.string().trim().min(1).max(120) }).safeParse({ kind: params.get("kind"), q: params.get("q") });
  if (!parsed.success) return Response.json({ error: "请输入作品名称，最多 120 字。" }, { status: 400 });
  if (!allowCatalogRequest(member.id, "search")) return Response.json({ error: "搜索有点频繁，请稍等一分钟再试。" }, { status: 429 });
  try { return Response.json(await searchCatalog(parsed.data.kind, parsed.data.q), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "暂时连不上作品目录，请稍后重试。" }, { status: 502 }); }
}
