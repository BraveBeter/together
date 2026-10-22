import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { normalizeCatalogItem } from "../../src/lib/catalog-server";
const password = "Test-only-password-2026";
async function login(page: Page, second = false) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(second ? "second@e2e.test" : "first@e2e.test"); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入我们的空间" }).click(); await expect(page).toHaveURL("http://localhost:3011/");
}
async function personal(page: Page, kind: "books" | "movies", second = false) {
  await page.goto(`/${kind}`); await page.locator(".perspective-tabs button").nth(second ? 2 : 1).click();
  await expect(page).toHaveURL(/view=/);
}
async function status(page: Page, value: string) { const tab = page.locator(".status-tabs").getByRole("button", { name: new RegExp(`^${value}`) }); await tab.click(); await expect(tab).toHaveAttribute("aria-pressed", "true"); }
async function update(page: Page, state: string, dates?: { start?: string; end?: string }) {
  await page.getByRole("button", { name: "更新我的记录", exact: true }).click();
  await page.getByLabel(/我的(阅读|观看)状态/).selectOption(state);
  if (dates?.start) await page.getByLabel("我的开始日期", { exact: true }).fill(dates.start);
  if (dates?.end) await page.getByLabel(/我的(读完|看完)日期/).fill(dates.end);
  await page.getByRole("button", { name: "保存我的记录", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("双账户严格交集、共同确认、个人日期、回忆、移除恢复及私密导出", async ({ browser, page }) => {
  await page.goto("/books"); await expect(page).toHaveURL(/\/login/);
  const signup = await page.request.post("/api/auth/sign-up/email", { data: { email: "outsider@e2e.test", password, name: "外人" } }); expect([400, 401, 403, 404]).toContain(signup.status());
  await login(page); await page.goto("/books"); await expect(page.getByRole("button", { name: "添加书籍", exact: true })).toHaveCount(0);
  await personal(page, "books"); await page.getByRole("button", { name: "添加书籍", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click();
  await expect(page.getByLabel("我的阅读状态")).toHaveValue("in_progress");
  await page.getByLabel("书名", { exact: false }).fill("两个人的不同步阅读"); await page.getByLabel("作者", { exact: true }).fill("一位作者");
  await page.getByLabel("我的开始日期").fill("2019-01-01"); await page.getByRole("button", { name: "加入我的清单", exact: true }).click();
  await expect(page.getByRole("heading", { name: "两个人的不同步阅读", exact: true })).toBeVisible(); const entryURL = page.url();
  await page.goto("/books?status=in_progress"); await expect(page.locator(".entry-card")).toHaveCount(0);
  const secondContext = await browser.newContext({ baseURL: "http://localhost:3011", viewport: { width: 390, height: 844 } }), second = await secondContext.newPage(); await login(second, true);
  await second.goto(entryURL); await second.getByRole("link", { name: "到我的清单记录", exact: true }).click();
  await expect(second.getByRole("dialog")).toBeVisible(); await second.getByLabel("我的阅读状态").selectOption("in_progress"); await second.getByLabel("我的开始日期").fill("2020-03-01"); await second.getByRole("button", { name: "保存我的记录" }).click();
  await page.goto("/books?status=in_progress"); await expect(page.locator(".entry-card")).toHaveCount(1);
  await page.goto(entryURL); await update(page, "completed", { end: "2019-01-20" }); await page.getByLabel("参与挑战").check();
  await page.goto("/books?status=in_progress"); await expect(page.locator(".entry-card")).toHaveCount(0);
  await second.goto(entryURL); await update(second, "completed", { end: "2020-03-10" });
  await page.goto("/books?status=completed"); await expect(page.locator(".entry-card")).toHaveCount(1);
  await page.goto("/challenges/books-100"); await expect(page.locator(".challenge-detail .challenge-numbers strong")).toHaveText("00");
  await page.goto("/timeline"); await expect(page.locator(".timeline-item")).toHaveCount(0);
  await page.locator(".perspective-tabs button").nth(1).click(); await expect(page.locator(".timeline")).toContainText("2019年1月20日"); await expect(page.locator(".timeline")).not.toContainText("2020年3月10日");
  await page.goto(entryURL); await page.getByRole("button", { name: "记录一起完成" }).click(); await page.getByLabel("确实一起完成", { exact: true }).check(); await page.getByLabel("共同完成日期").fill("2025-10-01"); await page.getByRole("button", { name: "保存共同记录" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "添加回忆" }).click(); await page.getByLabel("发生日期", { exact: true }).fill("2025-10-01"); await page.getByLabel("那一刻的我们", { exact: false }).fill("这次终于一起重读了。"); await page.locator('input[type="file"]').setInputFiles("demo-assets/mountain-lake.jpg"); await expect(page.locator(".upload-preview")).toHaveCount(1); await page.getByRole("button", { name: "保存这一刻" }).click(); await expect(page.locator(".memory-body")).toContainText("这次终于一起重读了。");
  const imageURL = await page.locator(".memory-photos img").getAttribute("src");
  const guest = await browser.newContext({ baseURL: "http://localhost:3011" }); expect((await guest.request.get(imageURL!)).status()).toBe(401); expect((await guest.request.get("/api/export")).status()).toBe(401); expect((await second.request.get(imageURL!)).status()).toBe(200);
  await page.goto("/timeline"); await expect(page.locator(".timeline-item")).toHaveCount(1); await expect(page.locator(".timeline")).toContainText("这次终于一起重读了。");
  await page.goto("/challenges/books-100"); await expect(page.locator(".challenge-detail .challenge-numbers strong")).toHaveText("01");
  await page.goto(entryURL); await page.getByRole("button", { name: "更新我的记录", exact: true }).click(); await page.getByRole("button", { name: "移除我的记录", exact: true }).click(); await page.getByRole("button", { name: "确认移除我的记录" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".memory-body")).toContainText("这次终于一起重读了。");
  await page.goto("/challenges/books-100"); await expect(page.locator(".challenge-detail .challenge-numbers strong")).toHaveText("00");
  await page.goto("/trash"); await page.getByRole("button", { name: "恢复", exact: true }).click(); await expect(page.locator(".trash-item")).toHaveCount(0);
  await page.goto("/challenges/books-100"); await expect(page.locator(".challenge-detail .challenge-numbers strong")).toHaveText("01");
  const exported = await page.request.get("/api/export"); const zip = await JSZip.loadAsync(await exported.body()); const json = JSON.parse(await zip.file("journal.json")!.async("string")); expect(json.version).toBe(4); expect(json.togetherConfirmations).toHaveLength(1); expect(json.personalRecords).toHaveLength(2); expect(JSON.stringify(json)).not.toContain("password");
  await secondContext.close(); await guest.close();
});

test("个人电影推荐、同名复用、不同状态不相交与私有编辑入口", async ({ browser, page }) => {
  await login(page); await personal(page, "movies"); await status(page, "已看");
  await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click(); await expect(page.getByLabel("我的观看状态")).toHaveValue("completed"); await expect(page.getByLabel("我的观看状态").getByRole("option")).toHaveCount(2);
  await page.getByLabel("电影名称").fill("留给你的电影"); await page.getByLabel("我的评分").selectOption("4.5"); await page.getByLabel("我的感受", { exact: true }).fill("这是我的短评。"); await page.getByRole("button", { name: "加入我的清单", exact: true }).click(); await expect(page.getByRole("heading", { name: "留给你的电影", exact: true })).toBeVisible(); const url = page.url();
  await page.getByRole("button", { name: "想推荐给你", exact: true }).click(); await page.getByLabel("推荐留言").fill("我猜你会喜欢它的结尾。"); await page.getByRole("button", { name: "留给你", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  const context = await browser.newContext({ baseURL: "http://localhost:3011" }), other = await context.newPage(); await login(other, true); await personal(other, "movies", true);
  await other.getByRole("button", { name: /留给你的推荐/ }).click(); await expect(other.locator(".inbox-row")).toContainText("我猜你会喜欢它的结尾。");
  await other.getByRole("button", { name: "加入我的想看", exact: true }).click(); await expect(other.locator(".entry-card")).toContainText("留给你的电影"); await expect(other.locator(".inbox-row")).toHaveCount(0);
  await other.goto("/movies?status=planned"); await expect(other.locator(".entry-card")).toHaveCount(0);
  await other.goto(url); await expect(other.locator(".person-record").first()).toContainText("这是我的短评。"); await expect(other.locator(".person-record").first().getByRole("button")).toHaveCount(0);
  await update(other, "completed"); await other.goto("/movies?status=completed"); await expect(other.locator(".entry-card")).toHaveCount(1);
  await page.goto("/challenges/movies-100"); await expect(page.locator(".challenge-detail .challenge-numbers strong")).toHaveText("00");
  await personal(page, "movies"); await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click(); await page.getByLabel("电影名称").fill("留给你的电影"); await expect(page.locator(".duplicate-choice")).toHaveCount(1); await expect(page.getByRole("button", { name: "加入我的清单", exact: true })).toBeDisabled(); await page.locator(".duplicate-choice").click(); await expect(page.getByLabel("我的观看状态")).toHaveValue("completed"); await expect(page.getByLabel("我的感受", { exact: true })).toHaveValue("这是我的短评。"); await page.getByRole("button", { name: "保存我的记录" }).click(); await expect(page).toHaveURL(url);
  await context.close();
});

test("上传失败、网络失败和并发编辑保留草稿；响应式与键盘", async ({ browser, page }) => {
  await login(page); await personal(page, "movies"); await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click();
  const title = "那些想和你一起看完的漫长故事".repeat(8);
  await page.getByLabel("电影名称").fill(title); await page.locator('input[type="file"]').setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") }); await expect(page.getByRole("alert")).toContainText("图片");
  await page.route("**/*", route => route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "加入我的清单", exact: true }).click(); await expect(page.getByRole("alert").last()).toContainText("输入已保留"); await expect(page.getByLabel("电影名称")).toHaveValue(title);
  await page.unroute("**/*"); await page.getByRole("button", { name: "加入我的清单", exact: true }).click(); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible(); const url = page.url();
  await page.getByRole("button", { name: "编辑作品资料", exact: true }).click(); await page.getByLabel("电影名称").fill("本机保留的标题草稿");
  const context = await browser.newContext({ baseURL: "http://localhost:3011" }), other = await context.newPage(); await login(other, true); await other.goto(url); await other.getByRole("button", { name: "编辑作品资料", exact: true }).click(); await other.getByLabel("作品简介", { exact: true }).fill("对方新写的简介"); await other.getByRole("button", { name: "保存作品资料" }).click(); await expect(other.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.locator(".detail-summary")).toHaveText("对方新写的简介"); await page.getByRole("button", { name: "保存作品资料" }).click(); await expect(page.getByRole("button", { name: "加载最新记录（保留草稿）" })).toBeVisible(); await expect(page.getByLabel("电影名称")).toHaveValue("本机保留的标题草稿");
  await page.getByRole("button", { name: "加载最新记录（保留草稿）" }).click(); await expect(page.locator(".latest-record")).toContainText("对方新写的简介"); await page.getByLabel("作品简介", { exact: true }).fill("对方新写的简介；合并后的内容"); await page.getByRole("button", { name: "保存作品资料" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/settings"); await page.getByLabel("我的昵称", { exact: true }).fill("一个非常长的名字也应该在各个界面里得到妥善展示"); await page.getByRole("button", { name: "保存设置" }).click(); await expect(page.getByRole("status")).toContainText("设置已保存");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const route of ["/", "/movies", "/books", "/challenges", "/challenges/books-100", "/timeline", "/settings", "/trash", new URL(url).pathname]) {
      await page.goto(route); await expect(page.locator(".site-header")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await personal(page, "movies"); await page.screenshot({ path: `output/playwright/v3/movies-${width}.png`, fullPage: true });
    await page.goto("/books?status=completed"); await page.screenshot({ path: `output/playwright/v3/books-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 }); await personal(page, "movies"); await page.getByRole("button", { name: "添加电影", exact: true }).click(); await page.getByRole("button", { name: "没有找到？手动填写", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/movies"); await expect(page.locator(".perspective-tabs button").first()).toBeVisible(); await page.locator(".perspective-tabs button").first().focus(); await page.keyboard.press("Tab"); await expect(page.locator(".perspective-tabs button").nth(1)).toBeFocused(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(/view=/);
  await page.goto("/settings"); await page.getByLabel("我的昵称", { exact: true }).fill("测试阿屿"); await page.getByRole("button", { name: "保存设置" }).click(); await expect(page.getByRole("status")).toContainText("设置已保存"); await context.close();
});

test("搜索填充、书籍版本、失败保留草稿与两人复用同一作品", async ({ browser, page }) => {
  await login(page); await personal(page, "books");
  const item = normalizeCatalogItem({ uuid: "catalogBook12345678", category: "book", type: "Edition", title: "从目录选中的书", author: ["目录作者"], pub_year: 2012, pub_house: "版本出版社", isbn: "9787506365437", pages: 191, description: "自动填入的作品简介。" }, "upstairs", "book")!;
  await page.route("**/api/catalog/search?**", route => route.fulfill({ json: { items: [item], warning: "" } }));
  await page.route("**/api/catalog/import", route => route.fulfill({ json: { item, coverId: null, warning: "" } }));
  await page.getByRole("button", { name: "添加书籍", exact: true }).click();
  await page.getByLabel("搜索书名或 ISBN").fill("9787506365437"); await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".catalog-pick-row")).toContainText("版本出版社"); await expect(page.locator(".catalog-pick-row")).toContainText("9787506365437");
  await page.getByRole("button", { name: /^选择 从目录选中的书/ }).click();
  await expect(page.locator(".catalog-selected-work")).toContainText("目录作者"); await expect(page.getByLabel("我的评分")).toHaveValue("");
  await expect(page.getByLabel("我的开始日期")).toHaveValue("");
  await page.getByLabel("我的阅读状态").selectOption("completed"); await page.getByLabel("我的评分").selectOption("4.5");
  await page.getByLabel("我的感受", { exact: true }).fill("我的主观记录不应被搜索覆盖。"); await page.getByLabel("我的读完日期").fill("2022-05-20");
  await page.getByRole("button", { name: "重新选择", exact: true }).click();
  await page.unroute("**/api/catalog/search?**"); await page.route("**/api/catalog/search?**", route => route.fulfill({ status: 502, json: { error: "暂时连不上作品目录，请稍后重试。" } }));
  await page.getByRole("button", { name: "搜索", exact: true }).click(); await expect(page.getByRole("alert").last()).toContainText("暂时连不上");
  await page.unroute("**/api/catalog/search?**"); await page.route("**/api/catalog/search?**", route => route.fulfill({ status: 502, contentType: "text/html", body: "<!doctype html><title>Unavailable</title>" }));
  await page.getByRole("button", { name: "搜索", exact: true }).click(); await expect(page.getByRole("alert").last()).toContainText("已有输入会保留");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("我的感受", { exact: true })).toHaveValue("我的主观记录不应被搜索覆盖。"); await expect(page.getByLabel("我的读完日期")).toHaveValue("2022-05-20");
  for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole("button", { name: "加入我的清单", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/entry\//); const entryURL = page.url(); await expect(page.locator(".detail-summary")).toHaveText("自动填入的作品简介。"); await expect(page.locator(".detail-info")).toContainText("版本出版社");
  const otherContext = await browser.newContext({ baseURL: "http://localhost:3011" }), other = await otherContext.newPage(); await login(other, true); await personal(other, "books", true);
  await other.getByRole("button", { name: "添加书籍", exact: true }).click(); await other.getByLabel("搜索书名或 ISBN").fill("从目录选中的书");
  await expect(other.locator(".local-result")).toHaveCount(1); await other.locator(".local-result").click();
  await expect(other.getByLabel("我的评分")).toHaveValue(""); await expect(other.getByLabel("我的感受", { exact: true })).toHaveValue("");
  await other.getByRole("button", { name: "保存我的记录", exact: true }).click(); await expect(other).toHaveURL(entryURL);
  const exported = await other.request.get("/api/export"), zip = await JSZip.loadAsync(await exported.body()), json = JSON.parse(await zip.file("journal.json")!.async("string"));
  const records = json.entries.filter((e: { title: string }) => e.title === item.title); expect(records).toHaveLength(1); expect(records[0].metadata.isbn).toBe("9787506365437"); expect(records[0].personalRecords).toHaveLength(2);
  await otherContext.close();
});

test("批量导入完整流程、双账户权限、断点续跑、主题展映和500条分页", async ({ browser, page }) => {
  test.setTimeout(150_000);
  const guest = await browser.newContext({ baseURL: "http://localhost:3011" });
  expect((await guest.request.get("/api/imports")).status()).toBe(401);
  expect((await guest.request.post("/api/imports", { data: {} })).status()).toBe(401);
  await login(page); await personal(page, "movies"); await status(page, "已看");
  const ownURL = page.url();
  await page.getByRole("link", { name: "批量导入", exact: true }).click();
  await page.getByLabel("清单名称", { exact: true }).fill("一次收好这些电影");
  const text = Array.from({ length: 15 }, (_, i) => `批量电影${i + 1} (2014)`).join("\n");
  await page.getByLabel("作品名称", { exact: true }).fill(text);
  await page.route("**/api/imports", route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.getByRole("button", { name: "检查清单" }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("作品名称", { exact: true })).toHaveValue(text);
  await page.unroute("**/api/imports");
  await page.getByRole("button", { name: "检查清单" }).click(); await expect(page).toHaveURL(/batch=/);
  const batchURL = page.url(), batchId = new URL(batchURL).searchParams.get("batch")!;
  await expect(page.locator(".import-row")).toHaveCount(15);
  await page.getByRole("button", { name: /匹配资料/ }).click();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click(); await expect(page.getByRole("button", { name: "暂停", exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.locator(".import-row")).toHaveCount(15);
  if (await page.getByRole("button", { name: /匹配资料/ }).isEnabled()) await page.getByRole("button", { name: /匹配资料/ }).click();
  await expect(page.getByRole("button", { name: "导入已选 15 条", exact: true })).toBeEnabled({ timeout: 40_000 });
  const context = await browser.newContext({ baseURL: "http://localhost:3011" }), second = await context.newPage(); await login(second, true);
  expect((await second.request.get(`/api/imports?id=${batchId}`)).status()).toBe(400);
  const preview = (await (await page.request.get(`/api/imports?id=${batchId}`)).json()).batch;
  expect((await second.request.post("/api/imports", { headers: { Origin: "http://localhost:3011" }, data: { op: "step", batchId, itemId: preview.items[0].id, operation: "commit" } })).status()).toBe(400);
  await page.getByRole("button", { name: "导入已选 15 条", exact: true }).click();
  await expect(page.locator(".import-state.done")).toHaveCount(15, { timeout: 40_000 });
  await expect(page.locator(".import-thumb img").first()).toHaveAttribute("src", /^\/api\/assets\//);
  const result = (await (await page.request.get(`/api/imports?id=${batchId}`)).json()).batch;
  expect(new Set(result.items.map((i: { entryId: string }) => i.entryId)).size).toBe(15);
  await page.request.post("/api/imports", { headers: { Origin: "http://localhost:3011" }, data: { op: "step", batchId, itemId: result.items[0].id, operation: "commit" } });
  const exported = await page.request.get("/api/export"), zip = await JSZip.loadAsync(await exported.body()), journal = JSON.parse(await zip.file("journal.json")!.async("string"));
  const films = journal.entries.filter((e: { title: string }) => /^批量电影/.test(e.title)); expect(films).toHaveLength(15);
  for (const film of films) { expect(film.personalRecords).toHaveLength(1); expect(film.personalRecords[0].status).toBe("completed"); expect(film.personalRecords[0].completedOn).toBeNull(); expect(film.together).toBeNull(); expect(film.coverId).toBeTruthy(); }
  expect(zip.file(`imports/${batchId}.csv`)).toBeTruthy();
  await page.goto(ownURL); await expect(page.locator(".movie-exhibition")).toBeVisible();
  const ids = await page.locator(".movie-exhibition .entry-card").evaluateAll(els => els.map(e => e.getAttribute("data-entry-id"))); expect(new Set(ids).size).toBe(ids.length);
  await expect(page.locator(".movie-exhibition")).not.toContainText("尚未评分");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.locator(".movie-exhibition")).toBeVisible();
    await page.locator(".movie-exhibition img").evaluateAll(async images => { await Promise.all(images.map(async img => { const image = img as HTMLImageElement; image.loading = "eager"; await image.decode().catch(() => {}); })); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/bulk/exhibition-${width}.png`, fullPage: true, animations: "disabled" });
    await page.goto(batchURL); await expect(page.locator(".import-row")).toHaveCount(15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/bulk/import-${width}.png`, fullPage: true, animations: "disabled" }); await page.goto(ownURL);
  }
  await page.locator(".catalog-layout-toggle button").last().click(); await expect(page.locator(".movie-exhibition")).toHaveCount(0);
  await page.getByLabel("搜索作品").fill("批量电影12"); await page.getByRole("button", { name: "提交搜索" }).click(); await expect(page.locator(".entry-card")).toHaveCount(1);
  await page.locator(".entry-card-link").click(); await expect(page.locator(".detail-info h1")).toHaveText("批量电影12"); await page.goBack(); await expect(page.getByLabel("搜索作品")).toHaveValue("批量电影12");
  const large = await page.request.post("/api/imports", { headers: { Origin: "http://localhost:3011" }, data: { op: "create", id: crypto.randomUUID(), kind: "book", label: "500本待确认书单", inputs: Array.from({ length: 500 }, (_, i) => ({ title: `待读书籍${i}`, year: null, creator: "", isbn: "", status: "planned", startedOn: null, completedOn: null })) } });
  expect(large.ok()).toBe(true); const largeBatch = (await large.json()).batch;
  await page.goto(`/imports?kind=book&batch=${largeBatch.id}`); await expect(page.locator(".import-row")).toHaveCount(50); await expect(page.locator(".collection-pagination")).toContainText("1 / 10");
  await page.getByRole("button", { name: "下一页", exact: true }).click(); await expect(page.locator(".collection-pagination")).toContainText("2 / 10");
  await page.getByRole("button", { name: "新的书单", exact: true }).click(); await page.getByLabel("默认状态").selectOption("completed"); await page.getByLabel("作品名称", { exact: true }).fill("批量书籍1 (2012)"); await page.getByRole("button", { name: "检查清单" }).click();
  await page.getByRole("button", { name: /匹配资料/ }).click(); await expect(page.getByRole("button", { name: "导入已选 1 条", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "导入已选 1 条", exact: true }).click(); await expect(page.locator(".import-state.done")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(ownURL); await expect(page.locator(".movie-exhibition")).toBeVisible();
  expect(await page.locator(".chapter-stage .entry-card").first().evaluate(e => getComputedStyle(e).animationName)).toBe("none");
  await page.locator(".catalog-layout-toggle button").first().focus(); await page.keyboard.press("Tab"); await expect(page.locator(".catalog-layout-toggle button").last()).toBeFocused();
  await context.close(); await guest.close();
});
