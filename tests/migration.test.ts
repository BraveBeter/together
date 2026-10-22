import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateDatabase } from "../src/db/migrate";

it("多个构建进程首次打开同一数据库时，迁移只执行一次", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tongye-migration-race-"));
  try {
    const code = `const Database = require('better-sqlite3'); const { migrateDatabase } = require('./src/db/migrate.ts'); const db = new Database(process.argv[1]); db.pragma('busy_timeout=10000'); migrateDatabase(db); db.close();`;
    await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ["--import", "tsx", "-e", code, path.join(directory, "journal.sqlite")])));
    const result = new Database(path.join(directory, "journal.sqlite"), { readonly: true });
    try { expect(result.prepare("SELECT COUNT(*) AS n FROM _migrations").get()).toEqual({ n: 6 }); expect(result.pragma("integrity_check", { simple: true })).toBe("ok"); } finally { result.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("旧数据库在线快照恢复后追加迁移，内容、完成时间、参与和回收状态不变，重启不重复迁移", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tongye-legacy-"));
  const legacy = new Database(path.join(directory, "legacy.sqlite"));
  const initial = readFileSync("migrations/0001_initial.sql", "utf8");
  try {
    legacy.pragma("journal_mode=WAL"); legacy.pragma("foreign_keys=ON"); legacy.exec(initial);
    legacy.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    legacy.prepare("INSERT INTO _migrations VALUES (?,?,?)").run("0001_initial.sql", createHash("sha256").update(initial).digest("hex"), 1);
    legacy.exec(`INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('a','一','a@test',1,1),('b','二','b@test',1,1);
      INSERT INTO members (user_id,seat,color) VALUES ('a',0,'green'),('b',1,'clay');
      INSERT INTO entries (id,kind,title,created_at,updated_at,deleted_at) VALUES ('m','movie','旧电影',10,20,NULL),('b','book','旧书',11,21,NULL),('trash','movie','暂存',12,22,30);
      INSERT INTO movies (entry_id,status,completed_at) VALUES ('m','completed',123),('trash','completed',124);
      INSERT INTO books (entry_id,author) VALUES ('b','作者');
      INSERT INTO reading_progress (entry_id,user_id,status,completed_at,revision) VALUES ('b','a','completed',200,2),('b','b','completed',201,3);
      INSERT INTO reviews (id,entry_id,user_id,rating,body,revision) VALUES ('r','m','a',4.5,'旧的短评',7);
      INSERT INTO memories (id,entry_id,date,body,created_at) VALUES ('memory','m','2010-10-01','旧的回忆',220);
      INSERT INTO challenges (id,kind,title,target,achieved_at) VALUES ('c','movie','挑战',100,400);
      INSERT INTO challenge_entries (challenge_id,entry_id) VALUES ('c','m'),('c','trash');`);
    const tables = ["movies", "books", "reading_progress", "reviews", "memories", "challenges", "challenge_entries"];
    const columns = tables.map(t => (legacy.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name).join(","));
    const contents = tables.map(t => legacy.prepare(`SELECT * FROM ${t}`).all());
    const backupFile = path.join(directory, "restored.sqlite"); await legacy.backup(backupFile);
    const restored = new Database(backupFile);
    try {
      restored.pragma("foreign_keys=ON"); migrateDatabase(restored);
      expect(tables.map((t, i) => restored.prepare(`SELECT ${columns[i]} FROM ${t}`).all())).toEqual(contents);
      expect(restored.prepare("SELECT started_at FROM reading_progress").all()).toEqual([{ started_at: null }, { started_at: null }]);
      expect(restored.prepare("SELECT id,shared_added_at,deleted_at FROM entries ORDER BY created_at").all()).toEqual([{ id: "m", shared_added_at: 10, deleted_at: null }, { id: "b", shared_added_at: 11, deleted_at: null }, { id: "trash", shared_added_at: 12, deleted_at: 30 }]);
      expect(restored.prepare("SELECT COUNT(*) AS n FROM entries e JOIN movies m ON m.entry_id=e.id JOIN challenge_entries c ON c.entry_id=e.id WHERE e.shared_added_at IS NOT NULL AND e.deleted_at IS NULL AND m.status='completed'").get()).toEqual({ n: 1 });
      expect(restored.prepare("SELECT * FROM personal_records").all()).toEqual([]);
      migrateDatabase(restored); expect(restored.prepare("SELECT COUNT(*) AS n FROM _migrations").get()).toEqual({ n: 6 });
      expect(restored.pragma("foreign_key_check")).toEqual([]); expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { restored.close(); }
    expect((legacy.prepare("PRAGMA table_info(entries)").all() as { name: string }[]).some(c => c.name === "shared_added_at")).toBe(false);
  } finally { legacy.close(); rmSync(directory, { recursive: true, force: true }); }
});
