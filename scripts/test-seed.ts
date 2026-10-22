import { rm } from "node:fs/promises";
import path from "node:path";
async function main() {
  const folder = path.resolve(process.env.DATA_DIR || "");
  if (!folder.endsWith(path.join(".local", "e2e"))) throw new Error("测试初始化只允许 .local/e2e 目录。");
  await rm(folder, { recursive: true, force: true });
  const { createMember } = await import("../src/lib/provision");
  for (const [name, email] of [["测试阿屿", "first@e2e.test"], ["测试小满", "second@e2e.test"]]) await createMember({ name, email, password: "Test-only-password-2026" });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
