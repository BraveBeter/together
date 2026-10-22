import { sqlite } from "../src/db";
console.log("数据库迁移已完成。", sqlite.prepare("SELECT name FROM _migrations ORDER BY name").all());
