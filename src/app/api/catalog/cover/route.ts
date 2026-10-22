import { currentMember } from "@/lib/session";
import { allowCatalogRequest, catalogRefSchema, getCatalogCover } from "@/lib/catalog-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const member = await currentMember(); if (!member) return new Response(null, { status: 401 });
  const parsed = catalogRefSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response(null, { status: 400 });
  if (!allowCatalogRequest(member.id, "cover")) return new Response(null, { status: 429 });
  try {
    const bytes = await getCatalogCover(parsed.data, true); if (!bytes) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 502 }); }
}
