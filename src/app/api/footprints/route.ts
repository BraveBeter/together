import { currentMember } from "@/lib/session";
import { photoPoints } from "@/lib/photo-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!await currentMember()) return Response.json({ error: "请先登录。" }, { status: 401 });
  try { return Response.json({ points: photoPoints(new URL(request.url).searchParams) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ error: "无法读取足迹，请刷新重试。" }, { status: 400 }); }
}
