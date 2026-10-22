import { strict as assert } from "node:assert";
import Database from "better-sqlite3";
import path from "node:path";
import { restoreBackup } from "../src/lib/backup";
import { migrateDatabase } from "../src/db/migrate";

async function main() {
  const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const file = value("--file"), to = value("--to");
  if (!file || !to) throw new Error("用法：npm run test:upgrade -- --file 备份.zip --to 新的验证目录");
  // restoreBackup checks the entire media manifest before the database is opened.
  const directory = await restoreBackup(file, to), database = new Database(path.join(directory, "journal.sqlite"));
  try {
    database.pragma("foreign_keys=ON");
    const hasShared = (database.prepare("PRAGMA table_info(entries)").all() as { name: string }[]).some(c => c.name === "shared_added_at");
    const tables = ["entries", "movies", "books", "reading_progress", "reviews", "memories", "challenges", "challenge_entries", "assets"];
    if (hasShared) tables.push("personal_records", "recommendations");
    if (database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get("together_confirmations")) tables.push("together_confirmations");
    if (database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get("import_batches")) tables.push("import_batches", "import_items");
    if (database.prepare("SELECT name FROM sqlite_master WHERE name = ?").get("photos")) tables.push("photos", "photo_participants", "photo_comments", "trips");
    const columns = tables.map(table => (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name).join(","));
    const before = tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(database);
    const after = tables.map((table, i) => database.prepare(`SELECT ${columns[i]} FROM ${table}`).all());
    assert.deepEqual(after, before, "迁移修改了原有内容");
    if (!hasShared) assert.equal((database.prepare("SELECT COUNT(*) AS n FROM entries WHERE shared_added_at IS NULL OR shared_added_at <> created_at").get() as { n: number }).n, 0);
    assert.deepEqual(database.pragma("foreign_key_check"), []); assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    migrateDatabase(database);
    console.log(`备份图片校验、恢复、追加迁移及重复启动通过。已核对 ${tables.length} 张表的原有内容。验证目录：${directory}`);
  } finally { database.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
