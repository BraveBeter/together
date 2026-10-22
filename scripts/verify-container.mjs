// Tests only containers/volumes created by this invocation, and removes them.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const suffix = randomBytes(5).toString("hex");
const volume = `tongye-test-${suffix}`;
const original = `${volume}-app`, restored = `${volume}-restored`;
const temporary = path.resolve(`.local/${volume}`);
const image = process.env.TONGYE_TEST_IMAGE || "tongye:local";
const password = "Container-test-password-2026";
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
let browser;
async function ready(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Container on ${port} did not become healthy`);
}
async function signIn(page, port, email = "first@container.test") {
  await page.goto(`http://localhost:${port}/login`);
  assert.equal(await page.getByRole("button", { name: "先逛逛演示空间" }).count(), 0);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入我们的空间" }).click();
  await page.waitForURL(`http://localhost:${port}/`);
}
try {
  mkdirSync(temporary, { recursive: true });
  const envFile = path.join(temporary, "runtime.env");
  writeFileSync(envFile, `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64")}\nBETTER_AUTH_URL=http://localhost:3012\nENABLE_DEMO_LOGIN=true\nDATA_DIR=/app/data\nBACKUP_DIR=/app/data/backups\n`, { mode: 0o600 });
  docker("volume", "create", volume);
  docker("run", "-d", "--name", original, "--env-file", envFile, "-p", "127.0.0.1:3012:3000", "-v", `${volume}:/app/data`, image);
  await ready(3012);
  for (const route of ["search?kind=movie&q=test", "cover?source=upstairs&kind=movie&id=6N3pGTHg0C07291q9YNMuj"]) assert.equal((await fetch(`http://localhost:3012/api/catalog/${route}`)).status, 401);
  assert.equal((await fetch("http://localhost:3012/api/catalog/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch("http://localhost:3012/api/imports")).status, 401);
  for (const [email, name] of [["first@container.test", "阿一"], ["second@container.test", "阿二"]]) {
    execFileSync("docker", ["exec", "-i", original, "npm", "run", "account:create", "--", "--stdin"], { input: JSON.stringify({ email, name, password }), stdio: ["pipe", "pipe", "pipe"] });
  }
  let refusedThird = false;
  try { execFileSync("docker", ["exec", "-i", original, "npm", "run", "account:create", "--", "--stdin"], { input: JSON.stringify({ email: "third@container.test", name: "第三人", password }), stdio: ["pipe", "pipe", "pipe"] }); } catch { refusedThird = true; }
  assert.ok(refusedThird, "Only two accounts can be provisioned");
  console.log("PASS production startup, private login, CLI provisioning and two-member limit");
  browser = await chromium.launch();
  const context = await browser.newContext(); const page = await context.newPage();
  await signIn(page, 3012);
  await page.goto("http://localhost:3012/movies");
  await page.locator(".perspective-tabs button").nth(1).click();
  await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click();
  await page.getByLabel("电影名称").fill("容器中保存的电影");
  await page.getByLabel("我的观看状态").selectOption("completed");
  await page.getByLabel("我的感受", { exact: true }).fill("重启和恢复以后，这段感受还在。");
  await page.locator('input[type="file"]').setInputFiles("demo-assets/mountain-lake.jpg");
  await page.locator(".upload-preview").waitFor();
  await page.getByRole("button", { name: "加入我的清单", exact: true }).click();
  await page.getByRole("heading", { name: "容器中保存的电影", exact: true }).waitFor();
  const entryPath = new URL(page.url()).pathname;
  await page.getByLabel("参与挑战").check();
  await page.getByRole("button", { name: "记录一起完成" }).click();
  await page.getByLabel("确实一起完成", { exact: true }).check();
  await page.getByRole("button", { name: "保存共同记录" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "添加回忆" }).click();
  await page.getByLabel("那一刻的我们", { exact: false }).fill("一张照片，一起留下。");
  await page.locator('input[type="file"]').setInputFiles("demo-assets/mountain-lake.jpg");
  await page.locator(".upload-preview").waitFor();
  await page.getByRole("button", { name: "保存这一刻" }).click();
  await page.getByText("一张照片，一起留下。", { exact: true }).waitFor();
  const assetPath = await page.locator(".memory-photos img").getAttribute("src");
  assert.equal((await fetch(`http://localhost:3012${assetPath}`)).status, 401);
  assert.equal((await fetch("http://localhost:3012/api/export")).status, 401);
  assert.equal((await context.request.get(`http://localhost:3012${assetPath}`)).status(), 200);
  const secondContext = await browser.newContext(); const second = await secondContext.newPage();
  await signIn(second, 3012, "second@container.test");
  await second.goto(`http://localhost:3012${entryPath}`);
  await second.getByRole("link", { name: "到我的清单记录", exact: true }).click();
  await second.getByLabel("我的观看状态").selectOption("completed");
  await second.getByRole("button", { name: "保存我的记录" }).click();
  await second.getByRole("dialog").waitFor({ state: "hidden" });
  await page.goto("http://localhost:3012/challenges/movies-100");
  assert.equal(await page.locator(".challenge-detail .challenge-numbers strong").innerText(), "01");
  await page.goto("http://localhost:3012/movies");
  await page.locator(".perspective-tabs button").nth(1).click();
  await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click();
  await page.getByLabel("电影名称").fill("容器里的个人推荐");
  await page.getByLabel("我的观看状态").selectOption("completed");
  await page.getByRole("button", { name: "加入我的清单", exact: true }).click();
  await page.getByRole("heading", { name: "容器里的个人推荐", exact: true }).waitFor();
  const personalPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "想推荐给你", exact: true }).click();
  await page.getByLabel("推荐留言").fill("恢复以后，便笺也在。");
  await page.getByRole("button", { name: "留给你", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  console.log("PASS personal records, own review, together confirmation, recommendation and private media");
  docker("restart", original); await ready(3012); await page.goto(`http://localhost:3012${entryPath}`);
  await page.getByText("重启和恢复以后，这段感受还在。", { exact: true }).waitFor();
  assert.equal((await context.request.get(`http://localhost:3012${assetPath}`)).status(), 200);
  await page.goto(`http://localhost:3012${personalPath}`);
  await page.locator(".recommend-detail").getByText("恢复以后，便笺也在。", { exact: true }).waitFor();
  console.log("PASS container restart retains lists, sessions, common records and media");
  const backupOutput = docker("exec", original, "npm", "run", "backup");
  const backup = backupOutput.match(/\/app\/data\/backups\/tongye-[^\s]+\.zip/)?.[0];
  assert.ok(backup);
  docker("exec", original, "npm", "run", "restore", "--", "--file", backup, "--to", "/app/data/restored-check");
  docker("run", "-d", "--name", restored, "--env-file", envFile, "-e", "BETTER_AUTH_URL=http://localhost:3013", "-e", "DATA_DIR=/app/data/restored-check", "-p", "127.0.0.1:3013:3000", "-v", `${volume}:/app/data`, image);
  await ready(3013);
  const recovered = await browser.newContext(); const recoveredPage = await recovered.newPage();
  await signIn(recoveredPage, 3013); await recoveredPage.goto(`http://localhost:3013${entryPath}`);
  await recoveredPage.getByText("重启和恢复以后，这段感受还在。", { exact: true }).waitFor();
  await recoveredPage.getByText("一张照片，一起留下。", { exact: true }).waitFor();
  assert.equal((await recovered.request.get(`http://localhost:3013${assetPath}`)).status(), 200);
  await recoveredPage.goto(`http://localhost:3013${personalPath}`);
  await recoveredPage.locator(".recommend-detail").getByText("恢复以后，便笺也在。", { exact: true }).waitFor();
  await recoveredPage.goto("http://localhost:3013/challenges/movies-100");
  assert.equal(await recoveredPage.locator(".challenge-detail .challenge-numbers strong").innerText(), "01");
  console.log("PASS separate restored container retains all personal states, common confirmation, challenge, review, recommendation and media");
} finally {
  await browser?.close();
  for (const name of [original, restored]) { try { docker("rm", "-f", name); } catch {} }
  try { docker("volume", "rm", volume); } catch {}
  rmSync(temporary, { recursive: true, force: true });
}
