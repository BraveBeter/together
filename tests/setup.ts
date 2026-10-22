import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
const dir = mkdtempSync(path.join(tmpdir(), "tongye-unit-"));
process.env.DATA_DIR = dir;
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-for-production-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3011";
process.env.ENABLE_DEMO_LOGIN = "false";
afterAll(() => {
  const global = globalThis as unknown as { tongyeDB?: { close: () => void } };
  global.tongyeDB?.close(); delete global.tongyeDB;
  rmSync(dir, { recursive: true, force: true });
});
