import { expect, it, vi } from "vitest";
import type { Member } from "../src/lib/types";
let member: Member | null = null;
vi.mock("../src/lib/session", () => ({ currentMember: async () => member }));
import { GET as search } from "../src/app/api/catalog/search/route";
import { GET as cover } from "../src/app/api/catalog/cover/route";
import { POST as importItem } from "../src/app/api/catalog/import/route";
it("搜索、封面和导入都需登录，导入校验来源且不接受任意 URL", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  try {
    expect((await search(new Request("http://localhost:3011/api/catalog/search?kind=movie&q=test"))).status).toBe(401);
    expect((await cover(new Request("http://localhost:3011/api/catalog/cover?source=upstairs&kind=movie&id=6N3pGTHg0C07291q9YNMuj"))).status).toBe(401);
    expect((await importItem(new Request("http://localhost:3011/api/catalog/import", { method: "POST", body: "{}" }))).status).toBe(401);
    member = { id: "member-test", name: "测试", email: "test@example.invalid", seat: 0, color: "green", avatarId: null };
    expect((await search(new Request("http://localhost:3011/api/catalog/search?kind=movie&q="))).status).toBe(400);
    expect((await cover(new Request("http://localhost:3011/api/catalog/cover?source=http://127.0.0.1&kind=movie&id=6N3pGTHg0C07291q9YNMuj"))).status).toBe(400);
    expect((await importItem(new Request("http://localhost:3011/api/catalog/import", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }))).status).toBe(403);
    expect((await importItem(new Request("http://localhost:3011/api/catalog/import", { method: "POST", headers: { Origin: "http://localhost:3011" }, body: JSON.stringify({ source: "upstairs", kind: "movie", id: "6N3pGTHg0C07291q9YNMuj", url: "http://127.0.0.1" }) }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
