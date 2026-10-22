import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
// Browser interaction tests do not depend on, or repeatedly download, public tiles.
const mapTile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cZ9sAAAAASUVORK5CYII=", "base64");
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: mapTile }));
});
async function login(page: Page, second = false) {
  await page.goto("/login"); await page.getByLabel("邮箱", { exact: true }).fill(second ? "second@e2e.test" : "first@e2e.test");
  await page.getByLabel("密码", { exact: true }).fill("Test-only-password-2026");
  await page.getByRole("button", { name: "进入我们的空间" }).click(); await expect(page).toHaveURL("http://localhost:3011/");
}
test("照片双账户上传、旅行、评论、范围筛选、时间轴、回收恢复与响应式", async ({ page, browser }) => {
  await login(page); await page.goto("/photos");
  await page.getByRole("button", { name: "记一次旅行", exact: true }).first().click();
  await page.getByLabel("旅行名称", { exact: true }).fill("测试海岸旅行");
  await page.getByRole("button", { name: "保存旅行", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "上传照片", exact: true }).click();
  const image = await sharp({ create: { width: 720, height: 480, channels: 3, background: "#517e84" } }).jpeg().toBuffer();
  await page.getByLabel("选择上传照片").setInputFiles({ name: "synthetic-coast.jpg", mimeType: "image/jpeg", buffer: image });
  await page.getByRole("button", { name: "开始上传" }).click();
  await expect(page.locator(".upload-row.done")).toHaveCount(1);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".photo-tile")).toHaveCount(1);
  const photos = await (await page.request.get("/api/photos")).json(), id = photos.items[0].id, asset = photos.items[0].assetId;
  expect(photos.items[0].takenOn).toBeNull();
  const guest = await browser.newContext({ baseURL: "http://localhost:3011" });
  for (const route of ["/api/photos", "/api/footprints", "/api/places/search?q=海边", `/api/assets/${asset}?size=display`]) expect((await guest.request.get(route)).status()).toBe(401);
  await page.goto(`/photos?photo=${id}`);
  await page.getByRole("button", { name: "编辑资料", exact: true }).click();
  await page.getByLabel("照片说明", { exact: true }).fill("两个人在海边");
  await page.getByLabel("拍摄日期", { exact: true }).fill("2021-05-20");
  await page.getByLabel("所属旅行", { exact: true }).selectOption({ label: "测试海岸旅行" });
  await page.getByRole("button", { name: "在地球上选点／填写经纬度", exact: true }).click();
  await page.getByLabel("纬度", { exact: true }).fill("31.23"); await page.getByLabel("经度", { exact: true }).fill("121.47");
  await page.getByLabel("地点备注", { exact: true }).fill("测试海边");
  await page.getByRole("button", { name: "使用这个位置", exact: true }).click();
  await page.getByRole("button", { name: "保存照片资料", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByLabel("写一条评论").fill("海风和你都在。"); await page.getByRole("button", { name: "发表", exact: true }).click();
  await expect(page.locator(".photo-comment")).toHaveCount(1);
  const context = await browser.newContext({ baseURL: "http://localhost:3011" }), second = await context.newPage(); await login(second, true);
  await second.goto(`/photos?photo=${id}`); await expect(second.locator(".photo-comment")).toHaveCount(1);
  await expect(second.getByRole("button", { name: "编辑评论", exact: true })).toHaveCount(0);
  await second.getByLabel("写一条评论").fill("下一次还来。"); await second.getByRole("button", { name: "发表", exact: true }).click(); await expect(second.locator(".photo-comment")).toHaveCount(2);
  await page.goto("/timeline?kind=photo"); await expect(page.locator(".timeline-photo-moment")).toHaveCount(1); await expect(page.locator(".timeline")).toContainText("2021年5月20日");
  await page.getByLabel("时光轴内容").selectOption("travel"); await expect(page.locator(".timeline-photo-moment")).toHaveCount(1);
  await page.goto("/travels?lat=31.23&lng=121.47&radius=1"); await expect(page.locator(".travel-panel-heading")).toContainText("1 张照片");
  await page.goto("/travels?lat=0&lng=0&radius=1"); await expect(page.locator(".travel-panel-heading")).toContainText("0 张照片");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 980 }); await page.goto("/travels");
    await expect(page.getByRole("heading", { name: "我们的地球足迹" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/travel-${width}.png`, fullPage: true });
    await page.goto("/photos"); await expect(page.locator(".photo-tile")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/playwright/photos-${width}.png`, fullPage: true });
  }
  await page.goto(`/photos?photo=${id}`);
  await expect(page.locator(".photo-comment")).toHaveCount(2);
  await page.getByRole("button", { name: "移入回收站", exact: true }).click(); await page.getByRole("button", { name: "确认移入回收站" }).click();
  await expect(page.locator(".photo-tile")).toHaveCount(0);
  expect((await (await page.request.get("/api/footprints")).json()).points).toHaveLength(0);
  await page.goto("/photos?trash=1"); await page.getByRole("button", { name: "恢复照片" }).click(); await expect(page.locator(".photo-tile")).toHaveCount(0);
  await page.goto(`/photos?photo=${id}`); await expect(page.locator(".photo-comment")).toHaveCount(2);
  await context.close(); await guest.close();
});
test("上传重试与并发编辑保留草稿，地球无 WebGL 时仍可浏览地点", async ({ page, browser }) => {
  await login(page); await page.goto("/photos");
  await page.getByRole("button", { name: "上传照片", exact: true }).click();
  await page.getByLabel("选择上传照片").setInputFiles("tests/fixtures/synthetic.heic");
  await page.route("**/api/photos/upload", route => route.abort());
  await page.getByRole("button", { name: "开始上传" }).click(); await expect(page.locator(".upload-row.error")).toHaveCount(1);
  await page.unroute("**/api/photos/upload"); await page.getByRole("button", { name: "重试未完成项" }).click();
  await expect(page.locator(".upload-row.done")).toHaveCount(1);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  const { items } = await (await page.request.get("/api/photos")).json(), id = items.find((p: { caption: string }) => p.caption === "两个人在海边").id;
  const context = await browser.newContext({ baseURL: "http://localhost:3011" }), second = await context.newPage(); await login(second, true);
  for (const p of [page, second]) { await p.goto(`/photos?photo=${id}`); await p.getByRole("button", { name: "编辑资料", exact: true }).click(); }
  await page.getByLabel("照片说明", { exact: true }).fill("我的草稿仍然在");
  await second.getByLabel("拍摄日期", { exact: true }).fill("2022-06-01"); await second.getByRole("button", { name: "保存照片资料" }).click();
  await page.getByRole("button", { name: "保存照片资料" }).click();
  await expect(page.getByLabel("照片说明", { exact: true })).toHaveValue("我的草稿仍然在"); await expect(page.locator(".drawer .error-notice")).toBeVisible();
  await page.getByRole("button", { name: /加载最新/ }).click(); await expect(page.locator(".latest-record")).toBeVisible();
  await page.getByRole("button", { name: "保存照片资料" }).click(); await expect(page.getByRole("dialog")).toHaveCount(1);
  const latest = await (await page.request.get(`/api/photos?id=${id}`)).json();
  expect(latest.photo.caption).toBe("我的草稿仍然在"); expect(latest.photo.takenOn).toBe("2022-06-01");
  await context.close();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, name: string, ...args: unknown[]) { if (name.includes("webgl")) return null; return original.apply(this, [name, ...args] as never); } as typeof original;
  });
  await page.goto("/travels"); await expect(page.locator(".earth-fallback")).toBeVisible();
  await page.locator(".footprint-locations summary").click(); await expect(page.getByRole("button", { name: /测试海边/ })).toBeVisible();
  await page.getByRole("button", { name: /测试海边/ }).click(); await expect(page.locator(".travel-panel-heading")).toContainText("1 张照片");
  await page.getByRole("button", { name: "详细地图", exact: true }).click();
  await expect(page.getByRole("region", { name: /详细地图/ })).toBeVisible();
});
test("真实地球点选、圈选和 2000 点聚合；键盘与减少动态效果", async ({ page }) => {
  await login(page); await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/travels");
  const marker = page.locator(".earth-marker").first(); await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.click(); await expect(page.locator(".travel-panel-heading")).toContainText("在这里留下的故事");
  await page.getByRole("button", { name: "清除选择", exact: true }).click();
  await page.getByRole("button", { name: "圈选一片足迹", exact: true }).click(); await marker.click();
  await expect(page).toHaveURL(/lat=/); await page.getByLabel("范围半径（公里）").fill("1");
  await expect(page.locator(".travel-panel-heading")).toContainText("1 张照片");
  await expect(page.getByRole("region", { name: /详细地图/ })).toBeVisible();
  await expect(page.locator(".street-range-circle")).toBeAttached();
  await page.getByRole("button", { name: "返回地球", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始旋转", exact: true })).toBeDisabled();
  await page.getByRole("region", { name: /互动地球/ }).focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("+");
  const { points } = await (await page.request.get("/api/footprints")).json(), sample = points[0];
  const many = Array.from({ length: 2000 }, (_, i) => ({ ...sample, id: crypto.randomUUID(), lat: (i % 160) - 80, lng: ((i * 7) % 360) - 180 }));
  await page.route("**/api/footprints?**", route => route.fulfill({ json: { points: many } }));
  await page.goto("/travels");
  await expect(page.locator(".earth-marker").first()).toBeAttached({ timeout: 15_000 });
  expect(await page.locator(".earth-marker").count()).toBeLessThan(1000);
  await expect(page.locator(".earth-canvas canvas")).toBeVisible();
});
test("详细地图缩放至街道、照片点与圈选、键盘及移动布局，瓦片失败可重试", async ({ page }) => {
  await login(page); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/travels?lat=31.23&lng=121.47&radius=1");
  const map = page.getByRole("region", { name: /详细地图/ });
  await expect(map).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  await expect(page.locator(".street-map .earth-marker")).toHaveCount(1);
  // Resizing must preserve the geographic center, not shift it by half the size delta.
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    await expect.poll(async () => {
      const viewport = await map.boundingBox(), point = await page.locator(".street-range-circle + path").boundingBox();
      if (!viewport || !point) return Infinity;
      return Math.hypot(point.x + point.width / 2 - viewport.x - viewport.width / 2, point.y + point.height / 2 - viewport.y - viewport.height / 2);
    }).toBeLessThan(3);
  }
  await page.locator(".street-map .earth-marker").click();
  await expect(page.locator(".travel-panel-heading")).toContainText("在这里留下的故事");
  await page.getByRole("button", { name: "圈选一片足迹", exact: true }).click();
  await page.locator(".street-map .earth-marker").click();
  await expect(page.locator(".travel-panel-heading")).toContainText("1 张照片");
  await expect(page.locator(".street-range-circle")).toBeAttached();
  const initialZoom = Number(await map.getAttribute("data-zoom"));
  await map.focus(); await page.keyboard.press("+"); await expect(map).toHaveAttribute("data-zoom", String(initialZoom + 1));
  for (let z = initialZoom + 1; z < 19; z++) await page.getByRole("button", { name: "放大地图", exact: true }).click();
  await expect(map).toHaveAttribute("data-zoom", "19");
  await expect(page.getByRole("button", { name: "放大地图", exact: true })).toBeDisabled();
  await expect(page.locator(".street-map-status")).toContainText("街道");
  await page.getByLabel("范围半径（公里）").fill("0.1"); await expect(map).toHaveAttribute("data-zoom", "19");
  await map.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("-"); await expect(map).toHaveAttribute("data-zoom", "18");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 980 });
    await expect(map).toBeVisible(); await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  // A fresh viewport avoids testing an already decoded/cached tile.
  await page.goto("/travels?lat=31.23&lng=121.47&radius=0.1");
  await expect(page.locator(".street-map-error")).toBeVisible();
  await expect(page.locator(".travel-panel-heading")).toContainText("1 张照片");
  await page.unroute("https://tile.openstreetmap.org/**");
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: mapTile }));
  await page.getByRole("button", { name: "重试", exact: true }).click(); await expect(page.locator(".street-map-error")).toHaveCount(0);
  await page.getByRole("button", { name: "返回地球", exact: true }).click();
  await expect(page.getByRole("region", { name: /互动地球/ })).toBeVisible();
  await expect(page.getByLabel("范围半径（公里）")).toHaveValue("0.1");
  await page.getByRole("button", { name: "详细地图", exact: true }).click(); await expect(map).toBeVisible();
});
