import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "../db";
import { members, user } from "../db/schema";
import type { Member } from "./types";
export async function currentMember(): Promise<Member | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return db.select({ id: user.id, name: user.name, email: user.email, seat: members.seat, color: members.color, avatarId: members.avatarId })
    .from(members).innerJoin(user, eq(members.userId, user.id)).where(eq(user.id, session.user.id)).get() ?? null;
}
export async function requireMember() {
  const member = await currentMember();
  if (!member) redirect("/login");
  return member;
}
