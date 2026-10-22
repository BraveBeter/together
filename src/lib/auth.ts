import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import * as schema from "../db/schema";
import { baseURL } from "./config";

export function makeAuth(provision = false) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("请设置至少 32 字符的 BETTER_AUTH_SECRET，参见 README。");
  return betterAuth({
    appName: "同页", baseURL, secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, disableSignUp: !provision, requireEmailVerification: false, minPasswordLength: 10, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 10 } } },
    trustedOrigins: [baseURL],
    advanced: { cookiePrefix: "tongye", defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: baseURL.startsWith("https:") } },
    disabledPaths: provision ? [] : ["/sign-up/email", "/delete-user", "/change-email"],
    plugins: provision ? [] : [nextCookies()],
  });
}
export const auth = makeAuth();
