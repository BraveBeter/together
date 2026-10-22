import { currentMember } from "@/lib/session";
import { baseURL } from "@/lib/config";
import { uploadPhoto } from "@/lib/photo-upload";
import { InputError } from "@/lib/records";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(baseURL).origin) return new Response(null, { status: 403 });
  try {
    const reader = request.body?.getReader(); if (!reader) throw new InputError("请选择照片。");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 26 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "单张照片不能超过 25 MB。" }, { status: 413 }); } chunks.push(value); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file"); if (!(file instanceof File)) throw new InputError("请选择照片。");
    const participants = JSON.parse(String(form.get("participants") || "[]")), tripId = form.get("tripId") ? String(form.get("tripId")) : null;
    const result = await uploadPhoto(Buffer.from(await file.arrayBuffer()), file.name, member, participants, tripId);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return Response.json({ error: e instanceof InputError ? e.message : "上传失败，请检查照片和参与者后重试。" }, { status: 400 }); }
}
