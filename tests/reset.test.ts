import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateDatabase } from "../src/db/migrate";
import { prepareEmptySpace } from "../src/lib/reset-space";
it("上线新目录保留当前密码、身份、设置和头像；清空内容和会话，原目录不变", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tongye-reset-")), source = path.join(root, "old"), target = path.join(root, "new");
  await mkdir(source); const db = new Database(path.join(source, "journal.sqlite")); migrateDatabase(db);
  const avatar = "a0000000-0000-4000-8000-000000000001";
  try {
    db.exec(`INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('a','成员一','a@test',1,1),('b','成员二','b@test',1,1);
      INSERT INTO members(user_id,seat,color,avatar_id) VALUES ('a',0,'olive','${avatar}'),('b',1,'clay',NULL);
      INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ('acc-a','a','credential','a','a-current-password-hash',1,2),('acc-b','b','credential','b','b-current-password-hash',1,3);
      INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES ('s','test-token','a',9999999999999,1,1);
      INSERT INTO settings VALUES ('home','自定站名','保留设置',3);
      INSERT INTO assets(id,owner_id,mime,filename,size,created_at) VALUES ('${avatar}','a','image/png','avatar.png',5,1);
      INSERT INTO challenges(id,kind,title,target,achieved_at) VALUES ('movies-100','movie','100部电影',100,10),('books-100','book','100本书',100,NULL);
      INSERT INTO entries(id,kind,title,cover_id,created_at,updated_at) VALUES ('work','movie','将清空','${avatar}',1,1);
      INSERT INTO movies(entry_id) VALUES ('work');
      INSERT INTO personal_records(entry_id,user_id,created_at,status) VALUES ('work','a',1,'completed');
      INSERT INTO together_confirmations(entry_id,recorded_by,created_at) VALUES ('work','a',1);
      INSERT INTO challenge_entries VALUES ('movies-100','work');`);
    await mkdir(path.join(source, "uploads", avatar), { recursive: true });
    for (const file of ["original", "thumb.webp"]) await writeFile(path.join(source, "uploads", avatar, file), "image");
    const before = ["user", "account", "members", "settings"].map(t => db.prepare(`SELECT * FROM ${t}`).all());
    const result = await prepareEmptySpace(source, target); expect(result.entries).toBe(0);
    const check = new Database(path.join(target, "journal.sqlite"));
    try {
      expect(["user", "account", "members", "settings"].map(t => check.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
      for (const t of ["entries", "personal_records", "together_confirmations", "session", "challenge_entries"]) expect(check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
      expect(check.prepare("SELECT achieved_at FROM challenges").all()).toEqual([{ achieved_at: null }, { achieved_at: null }]);
      expect((await readFile(path.join(target, "uploads", avatar, "original"))).toString()).toBe("image");
      expect(db.prepare("SELECT COUNT(*) AS n FROM entries").get()).toEqual({ n: 1 });
      await expect(prepareEmptySpace(source, target)).rejects.toThrow("目标目录已存在");
    } finally { check.close(); }
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
