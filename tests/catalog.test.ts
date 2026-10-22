import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalogItem, mergeCatalogResults, normalizeCatalogItem, normalizeISBN, readLimited, safeCoverURL, searchCatalog } from "../src/lib/catalog-server";
import { matchesCatalogEntry, sameCatalogItem } from "../src/lib/catalog-metadata";
const movie = (rest = {}) => ({ uuid: "6N3pGTHg0C07291q9YNMuj", category: "movie", type: "Movie", title: "Interstellar", localized_title: [{ lang: "zh-cn", text: "星际穿越" }], director: ["克里斯托弗·诺兰"], year: 2014, length: 10140, description: "在宇宙中寻找新的家园。", cover_image_url: "https://film.upstairs.cn/m/item/cover.jpg", external_resources: [{ url: "https://movie.douban.com/subject/1889243/" }, { url: "https://www.imdb.com/title/tt0816692/" }], rating: 9.4, rating_count: 2000000, ...rest });
const book = (rest = {}) => ({ uuid: "5psNI0Ay35T3KqEP3hcC4j", category: "book", type: "Edition", title: "活着", author: ["余华"], pub_year: 2012, pub_house: "作家出版社", isbn: "9787506365437", pages: 191, external_resources: [{ url: "https://book.douban.com/subject/4913064/" }], ...rest });
afterEach(() => vi.unstubAllGlobals());
describe("公共目录映射与版本识别", () => {
  it("使用中文片名、导演、年份与片长，不把信源评分变成个人评分", () => {
    const item = normalizeCatalogItem(movie(), "upstairs", "movie")!;
    expect(item.title).toBe("星际穿越"); expect(item.creator).toBe("克里斯托弗·诺兰"); expect(item.year).toBe(2014); expect(item.metadata.minutes).toBe(169);
    expect(item).not.toHaveProperty("rating"); expect(item).not.toHaveProperty("completedOn"); expect(item.links.some(l => l.label === "豆瓣")).toBe(true);
    expect(normalizeCatalogItem(movie({ category: "tv" }), "upstairs", "movie")).toBeNull();
  });
  it("书籍保留版本年份、出版资料和 ISBN，未知字段不会用今天替代", () => {
    const item = normalizeCatalogItem(book(), "upstairs", "book")!;
    expect(item.year).toBe(2012); expect(item.metadata.publisher).toBe("作家出版社"); expect(item.metadata.isbn).toBe("9787506365437"); expect(item.metadata.pages).toBe(191);
    const missing = normalizeCatalogItem(book({ pub_year: null, isbn: null, pages: null }), "eggplant", "book")!;
    expect(missing.year).toBeNull(); expect(missing.metadata.isbn).toBe(""); expect(missing.metadata.pages).toBeNull();
    expect(normalizeCatalogItem(book({ type: "Work" }), "upstairs", "book")).toBeNull();
    expect(normalizeISBN("ISBN 978-7-5063-6543-7")).toBe("9787506365437"); expect(normalizeISBN("9787506365438")).toBe("");
  });
  it("相同外部作品 ID 合并，中文精确匹配优先；同名不同版本不合并", () => {
    const cn = normalizeCatalogItem(movie(), "upstairs", "movie")!, en = normalizeCatalogItem(movie({ uuid: "1rblnQX0x9HDHWsBt7LSy5", title: "Interstellar", localized_title: [] }), "eggplant", "movie")!;
    expect(sameCatalogItem(cn.metadata, en.metadata)).toBe(true);
    const items = mergeCatalogResults([en, cn], "星际穿越"); expect(items).toHaveLength(1); expect(items[0].title).toBe("星际穿越");
    const first = normalizeCatalogItem(book(), "upstairs", "book")!, second = normalizeCatalogItem(book({ uuid: "3eX55tZt87tkC919Kox4Xq", isbn: "9787536692930", external_resources: [{ url: "https://book.douban.com/subject/2567698/" }] }), "eggplant", "book")!;
    expect(mergeCatalogResults([first, second], "活着")).toHaveLength(2);
    expect(matchesCatalogEntry({ kind: "movie", links: [{ label: "以前的豆瓣链接", url: "https://movie.douban.com/subject/1889243/?from=old" }] }, cn)).toBe(true);
    expect(matchesCatalogEntry({ kind: "book", links: cn.links }, cn)).toBe(false);
  });
  it("封面只允许已知目录的媒体路径，拒绝任意网址和私网地址", () => {
    for (const url of ["http://film.upstairs.cn/m/a.jpg", "https://127.0.0.1/m/a.jpg", "https://eggplant.place.evil.test/m/a.jpg", "https://eggplant.place@127.0.0.1/m/a.jpg", "https://eggplant.place:8080/m/a.jpg", "https://eggplant.place/api/me"]) expect(safeCoverURL(url)).toBeNull();
    expect(safeCoverURL("https://eggplant.place/m/item/test.jpg")).toBe("https://eggplant.place/m/item/test.jpg");
  });
});
describe("目录失败与请求限制", () => {
  it("一个信源失败时仍显示另一个的真实结果，并提示缺失", async () => {
    const mocked = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error"); expect(init.signal).toBeDefined();
      if (url.includes("eggplant.place")) throw new Error("unreachable");
      return Response.json({ data: [movie()] });
    }); vi.stubGlobal("fetch", mocked);
    const result = await searchCatalog("movie", "source-failure-test"); expect(result.items).toHaveLength(1); expect(result.warning).toContain("部分信源");
    await searchCatalog("movie", "source-failure-test"); expect(mocked).toHaveBeenCalledTimes(2);
  });
  it("验证页和两边失败都不会伪造结果；详情必须与选中的 ID 匹配", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("captcha", { headers: { "content-type": "text/html" } })));
    await expect(searchCatalog("movie", "captcha-test")).rejects.toThrow("暂时连不上");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(movie())));
    await expect(getCatalogItem({ source: "upstairs", kind: "movie", id: "notTheSelectedItem" })).rejects.toThrow("重新搜索");
  });
  it("有长度头或分块的超大响应都会停止读取", async () => {
    await expect(readLimited(new Response("small", { headers: { "content-length": "900" } }), 8)).rejects.toThrow();
    await expect(readLimited(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); controller.close(); } })), 8)).rejects.toThrow("内容过大");
  });
});
