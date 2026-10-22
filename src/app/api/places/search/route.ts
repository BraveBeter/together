import { currentMember } from "@/lib/session";
import { searchPlaces } from "@/lib/places";
import { InputError } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const member = await currentMember(); if (!member) return Response.json({ error: "请先登录。" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try { return Response.json({ items: await searchPlaces(member.id, params.get("q") ?? "", params.get("city") ?? "") }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof InputError ? e.message : "请填写有效的地点名称。" }, { status: 400 }); }
}
