// Exercise the real multipart request through Caddy, using disposable containers.
// An optional local photo is never copied into the repository or production data.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";

const name = `tongye-photo-proxy-${randomBytes(5).toString("hex")}`;
const app = `${name}-app`, proxy = `${name}-caddy`, base = "http://localhost:3016";
const folder = path.resolve(".local", name), config = path.join(folder, "Caddyfile");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const appImage = process.env.TONGYE_TEST_IMAGE || "tongye:local";
const proxyImage = process.env.CADDY_TEST_IMAGE || "caddy:2-alpine";
let stage = "startup";
try {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const fixedConfig = readFileSync("Caddyfile", "utf8").replace("{$DOMAIN}", "http://:80");
  writeFileSync(config, fixedConfig.replace(/max_size\s+\S+/, "max_size 12MB"));
  const env = path.join(folder, "runtime.env");
  writeFileSync(env, `BETTER_AUTH_URL=${base}\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\nDATA_DIR=/app/data\n`, { mode: 0o600 });
  docker("network", "create", name);
  docker("run", "-d", "--name", app, "--network", name, "--network-alias", "app", "--env-file", env, appImage);
  docker("run", "-d", "--name", proxy, "--network", name, "-p", "127.0.0.1:3016:80", "-v", `${config}:/etc/caddy/Caddyfile:ro`, proxyImage);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Proxy and app become healthy");
  const credentials = { email: "upload@container.test", name: "上传测试", password: "Proxy-test-password-2026" };
  execFileSync("docker", ["exec", "-i", app, "npm", "run", "account:create", "--", "--stdin"], { input: JSON.stringify(credentials), stdio: ["pipe", "pipe", "pipe"] });
  const auth = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const userId = (await auth.json()).user.id;
  // A small valid JPEG with padding gives a stable, non-private large fixture.
  const image = process.env.PHOTO_PROXY_TEST_FILE ? readFileSync(process.env.PHOTO_PROXY_TEST_FILE) : Buffer.concat([
    await sharp({ create: { width: 32, height: 24, channels: 3, background: "#517e84" } }).jpeg().toBuffer(), Buffer.alloc(13 * 1024 * 1024),
  ]);
  assert.ok(image.length > 12_000_000 && image.length <= 25 * 1024 * 1024, "Fixture crosses the old proxy cap but fits the photo limit");
  async function upload(bytes) {
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "image/jpeg" }), "upload-check.jpg");
    body.append("participants", JSON.stringify([userId]));
    const encoded = new Request(`${base}/api/photos/upload`, { method: "POST", body });
    const payload = Buffer.from(await encoded.arrayBuffer());
    // A fresh socket avoids a pooled connection retired by Caddy's reload. An
    // early HTTP rejection remains readable even while its body is being sent.
    return new Promise((resolve, reject) => {
      let responded = false;
      const req = http.request(encoded.url, { method: "POST", agent: false, headers: { Origin: base, Cookie: cookie, "Content-Type": encoded.headers.get("content-type"), "Content-Length": payload.length } }, res => {
        responded = true; const chunks = [];
        res.on("data", chunk => chunks.push(chunk)); res.on("error", reject);
        res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      });
      req.on("error", error => { if (!responded) reject(error); });
      req.setTimeout(180_000, () => req.destroy(new Error("Upload verification timeout")));
      req.end(payload);
    });
  }
  let rejection;
  try {
    const blocked = await upload(image);
    assert.equal(blocked.status, 413, "The old proxy rejects an otherwise valid photo");
    await blocked.arrayBuffer(); rejection = "HTTP 413";
  } catch (error) {
    // Caddy may close the body stream while the client is still writing it.
    assert.equal(error.code ?? error.cause?.code, "ECONNRESET"); rejection = "connection reset while sending";
  }
  console.log(`PASS reproduced proxy rejection (${rejection}) for a ${(image.length / 1_000_000).toFixed(1)} MB photo`);
  writeFileSync(config, fixedConfig);
  docker("exec", proxy, "caddy", "validate", "--config", "/etc/caddy/Caddyfile");
  docker("exec", proxy, "caddy", "reload", "--config", "/etc/caddy/Caddyfile");
  stage = "original photo through updated proxy";
  const uploaded = await upload(image);
  assert.equal(uploaded.status, 200, "The same original uploads through the corrected proxy");
  const first = await uploaded.json();
  assert.equal(first.duplicate, false); assert.ok(first.photo.id);
  stage = "duplicate retry";
  const repeated = await upload(image); assert.equal(repeated.status, 200);
  const second = await repeated.json();
  assert.equal(second.duplicate, true); assert.equal(second.photo.id, first.photo.id);
  stage = "private thumbnails";
  const media = `/api/assets/${first.photo.assetId}`;
  assert.equal((await fetch(base + media)).status, 401);
  const thumbnail = await fetch(base + media, { headers: { Cookie: cookie } });
  assert.equal(thumbnail.status, 200); assert.ok((await thumbnail.arrayBuffer()).byteLength > 0);
  console.log("PASS original upload, private thumbnail and duplicate-safe retry through Caddy");
  stage = "application size cap";
  const oversized = await upload(Buffer.alloc(26 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /25 MB/);
  const list = await (await fetch(`${base}/api/photos`, { headers: { Cookie: cookie } })).json();
  assert.equal(list.total, 1);
  console.log("PASS app still rejects oversized photos; only one test record exists");
} catch (error) {
  console.error(`Proxy verification failed during ${stage}`);
  for (const container of [proxy, app]) {
    const logs = spawnSync("docker", ["logs", "--tail", "20", container], { encoding: "utf8" });
    process.stderr.write((logs.stdout || "") + (logs.stderr || ""));
  }
  throw error;
} finally {
  for (const container of [proxy, app]) { try { docker("rm", "-f", "-v", container); } catch {} }
  try { docker("network", "rm", name); } catch {}
  rmSync(folder, { recursive: true, force: true });
}
