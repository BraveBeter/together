import { config } from "dotenv";
import path from "node:path";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
// Runtime volumes must never be copied into the application build.
export const dataDir = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
export const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3000";
export const demoEnabled = process.env.ENABLE_DEMO_LOGIN === "true" && process.env.NODE_ENV !== "production"
  && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname);
