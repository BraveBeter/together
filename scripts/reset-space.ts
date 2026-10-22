import { prepareEmptySpace } from "../src/lib/reset-space";
const argument = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
async function main() {
  const source = argument("--from"), target = argument("--to");
  if (!source || !target || argument("--confirm") !== "reset-content-keep-accounts") throw new Error("用法：先完成备份，再运行 --from 原目录 --to 全新目录 --confirm reset-content-keep-accounts");
  console.log(JSON.stringify(await prepareEmptySpace(source, target)));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "准备失败"); process.exitCode = 1; });
