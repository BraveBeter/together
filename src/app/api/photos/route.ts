import { currentMember } from "@/lib/session";
import { listPhotos, listTrips, photoById, photoMoments, readPhotoComments } from "@/lib/photo-server";
import { baseURL } from "@/lib/config";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function read(request: Request, ids?: string[]) {
  if (!await currentMember()) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("id")) return Response.json({ photo: photoById(params.get("id")!), comments: readPhotoComments(params.get("id")!), trips: listTrips() }, { headers });
    if (params.get("mode") === "timeline") return Response.json(photoMoments(params, Math.max(1, Math.min(40, Number(params.get("limit")) || 40))), { headers });
    return Response.json(listPhotos(params, ids), { headers });
  } catch { return Response.json({ error: "无法读取照片，请检查筛选条件或刷新后重试。" }, { status: 400, headers }); }
}
export async function GET(request: Request) { return read(request); }
export async function POST(request: Request) {
  if (!await currentMember()) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(baseURL).origin) return new Response(null, { status: 403 });
  try { const text = await request.text(); if (text.length > 400_000) return new Response(null, { status: 413 }); const { ids } = JSON.parse(text); if (!Array.isArray(ids)) throw new Error(); return read(request, ids); }
  catch { return Response.json({ error: "照片选择无效。" }, { status: 400, headers }); }
}
