import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export function migrateDatabase(sqlite: Database.Database) {
  sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const name of readdirSync(path.resolve("migrations")).filter(n => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.resolve("migrations", name), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    // Build workers and simultaneous cold starts may open the same database.
    // Acquire the write lock before checking the migration, then recheck inside it.
    sqlite.transaction(() => {
      const applied = sqlite.prepare("SELECT hash FROM _migrations WHERE name=?").get(name) as { hash: string } | undefined;
      if (applied && applied.hash !== hash) throw new Error(`已执行的迁移被修改：${name}`);
      if (!applied) { sqlite.exec(sql); sqlite.prepare("INSERT INTO _migrations VALUES (?,?,?)").run(name, hash, Date.now()); }
    }).immediate();
  }
}
