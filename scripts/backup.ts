import path from "node:path";
import { createBackup } from "../src/lib/backup";
const index = process.argv.indexOf("--to");
createBackup(path.resolve(index >= 0 ? process.argv[index + 1] : process.env.BACKUP_DIR || "./backups"))
  .then(file => console.log(`备份已完成：${file}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
