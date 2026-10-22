import { restoreBackup } from "../src/lib/backup";
const fileIndex = process.argv.indexOf("--file"), toIndex = process.argv.indexOf("--to");
if (fileIndex < 0 || toIndex < 0 || !process.argv[fileIndex + 1] || !process.argv[toIndex + 1]) {
  console.error("用法：npm run restore -- --file ./backups/tongye-日期.zip --to ./data-restored"); process.exitCode = 1;
} else restoreBackup(process.argv[fileIndex + 1], process.argv[toIndex + 1]).then(dir => console.log(`已校验并恢复到：${dir}。停止应用后再切换数据目录。`)).catch(error => { console.error(error.message); process.exitCode = 1; });
