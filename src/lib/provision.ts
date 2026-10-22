import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "../db";
import { user, members, account, session } from "../db/schema";
import { makeAuth } from "./auth";
const accountInput = z.object({ email: z.email().transform(e => e.toLowerCase()), name: z.string().trim().min(1).max(30), password: z.string().min(10).max(128) });
export async function createMember(input: unknown) {
  const v = accountInput.parse(input);
  const taken = db.select().from(members).all();
  if (taken.length >= 2) throw new Error("这个私人空间已经有两位成员。");
  const seat = taken.some(m => m.seat === 0) ? 1 : 0;
  const created = await makeAuth(true).api.signUpEmail({ body: v });
  try { db.insert(members).values({ userId: created.user.id, seat, color: seat === 0 ? "#6d7359" : "#a66b53" }).run(); }
  catch (error) { db.delete(user).where(eq(user.id, created.user.id)).run(); throw error; }
  return created.user;
}
export async function resetMemberPassword(email: string, password: string) {
  z.string().min(10).max(128).parse(password);
  const found = db.select({ id: user.id }).from(user).innerJoin(members, eq(members.userId, user.id)).where(eq(user.email, email.toLowerCase())).get();
  if (!found) throw new Error("没有找到这位成员。");
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.update(account).set({ password: hash, updatedAt: new Date() }).where(eq(account.userId, found.id)).run();
    db.delete(session).where(eq(session.userId, found.id)).run();
  });
}
