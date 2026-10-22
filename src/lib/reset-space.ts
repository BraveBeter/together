import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import { migrateDatabase } from "../db/migrate";

// Builds a new directory. The live directory is read-only and is never replaced here.
export async function prepareEmptySpace(sourceDir: string, targetDir: string) {
  const source = path.resolve(sourceDir), target = path.resolve(targetDir);
  if (source === target || target.startsWith(source + path.sep)) throw new Error("新目录必须独立于原数据目录。");
  if (existsSync(target)) throw new Error("目标目录已存在，拒绝覆盖。");
  if (!existsSync(path.join(source, "journal.sqlite"))) throw new Error("找不到源数据库。");
  const stage = `${target}.preparing-${randomUUID()}`;
  await mkdir(stage, { mode: 0o750 });
  const original = new Database(path.join(source, "journal.sqlite"), { readonly: true });
  let database: Database.Database | undefined;
  try {
    await original.backup(path.join(stage, "journal.sqlite")); original.close();
    database = new Database(path.join(stage, "journal.sqlite")); database.pragma("foreign_keys=ON");
    const preservedTables = ["user", "account", "members", "settings"];
    const before = preservedTables.map(t => database!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
    const avatars = database.prepare("SELECT DISTINCT avatar_id AS id FROM members WHERE avatar_id IS NOT NULL").all() as { id: string }[];
    migrateDatabase(database);
    database.transaction(() => {
      for (const table of ["session", "verification", "recommendations", "memories", "reviews", "reading_progress", "personal_records", "together_confirmations", "challenge_entries", "movies", "books", "entries"]) database!.exec(`DELETE FROM ${table}`);
      database!.exec("UPDATE challenges SET achieved_at=NULL");
      database!.exec("DELETE FROM assets WHERE id NOT IN (SELECT avatar_id FROM members WHERE avatar_id IS NOT NULL)");
    })();
    assert.deepEqual(preservedTables.map(t => database!.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()), before, "账户或设置发生变化");
    for (const { id } of avatars) {
      if (!/^[0-9a-f-]{36}$/i.test(id) || !database.prepare("SELECT id FROM assets WHERE id=?").get(id)) throw new Error("头像引用无效，停止准备。");
      await mkdir(path.join(stage, "uploads", id), { recursive: true, mode: 0o750 });
      for (const file of ["original", "thumb.webp"]) await copyFile(path.join(source, "uploads", id, file), path.join(stage, "uploads", id, file));
    }
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok"); assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.equal((database.prepare("SELECT COUNT(*) AS n FROM members").get() as { n: number }).n, 2, "须保留两位成员");
    assert.equal((database.prepare("SELECT COUNT(*) AS n FROM challenges").get() as { n: number }).n, 2, "须保留两个挑战");
    database.exec("VACUUM"); database.close(); database = undefined;
    await rename(stage, target);
    return { directory: target, members: 2, entries: 0, avatars: avatars.length };
  } catch (error) {
    if (original.open) original.close(); database?.close(); await rm(stage, { recursive: true, force: true }); throw error;
  }
}
