import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { currentMember } from "@/lib/session";
import { uploadsDir } from "@/lib/assets";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await currentMember()) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset) return new Response(null, { status: 404 });
  const full = new URL(request.url).searchParams.get("full") === "1";
  try {
    const data = await readFile(path.join(uploadsDir, id, full ? "original" : "thumb.webp"));
    return new Response(data, { headers: { "Content-Type": full ? asset.mime : "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404 }); }
}
