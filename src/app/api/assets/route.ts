import { currentMember } from "@/lib/session";
import { storeAsset } from "@/lib/assets";
import { baseURL } from "@/lib/config";
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (request.headers.get("origin") !== new URL(baseURL).origin) return Response.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("没有收到图片。");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 11 * 1024 * 1024) { await reader.cancel(); throw new Error("图片不能超过 10 MB。"); } chunks.push(value); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择图片。");
    const id = await storeAsset(Buffer.from(await file.arrayBuffer()), file.name, member.id);
    return Response.json({ id });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "图片上传失败，请重试。" }, { status: 400 }); }
}
