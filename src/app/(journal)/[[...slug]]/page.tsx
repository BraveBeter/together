import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { readData } from "@/lib/data";
import { Journal } from "@/components/journal";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const member = await requireMember();
  const { slug = [] } = await params;
  const path = "/" + slug.join("/");
  if (!/^\/(movies|books|challenges(\/(movies-100|books-100))?|timeline|settings|trash|imports)?$/.test(path) && !/^\/entry\/[0-9a-f-]{36}$/.test(path)) notFound();
  const data = readData(member);
  if (path.startsWith("/entry/") && !data.entries.some(e => e.id === slug[1] && !e.deletedAt)) notFound();
  return <Journal data={data} path={path} />;
}
