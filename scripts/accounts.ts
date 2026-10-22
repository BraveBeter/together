import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { createMember, resetMemberPassword } from "../src/lib/provision";

async function passwordPrompt() {
  if (!process.stdin.isTTY) throw new Error("非交互环境请使用 --stdin 传入 JSON，密码不要放在命令行参数中。");
  process.stdout.write("密码（至少 10 字符，输入隐藏）：");
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let result = "";
    const finish = () => { process.stdin.setRawMode(false); process.stdin.removeListener("keypress", onKey); process.stdin.pause(); process.stdout.write("\n"); };
    const onKey = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") { finish(); reject(new Error("已取消。")); }
      else if (key.name === "return") { finish(); resolve(result); }
      else if (key.name === "backspace") result = result.slice(0, -1);
      else if (text && !key.ctrl && !text.startsWith("\u001b")) result += text;
    };
    process.stdin.on("keypress", onKey);
  });
}
async function main() {
  const command = process.argv[2];
  if (!["create", "reset"].includes(command)) throw new Error("使用 account:create 或 account:reset。");
  let input: { email: string; password: string; name?: string };
  if (process.argv.includes("--stdin")) {
    let raw = ""; for await (const chunk of process.stdin) raw += chunk; input = JSON.parse(raw);
  } else {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const email = (await readline.question("登录邮箱：")).trim();
    const name = command === "create" ? (await readline.question("昵称：")).trim() : undefined;
    readline.close(); input = { email, name, password: await passwordPrompt() };
  }
  if (command === "create") { await createMember(input); console.log("成员已创建。私人空间最多两位成员。"); }
  else { await resetMemberPassword(input.email, input.password); console.log("密码已重置，该账户的所有旧会话已退出。"); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "操作失败。"); process.exitCode = 1; });
