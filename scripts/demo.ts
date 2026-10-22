import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import path from "node:path";
import sharp from "sharp";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("演示数据只能在开发环境初始化。");
  const existing = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
  if (existing.DATA_DIR && path.resolve(existing.DATA_DIR) !== path.resolve(".local/demo-v3")) throw new Error(".env.local 已指向其他数据目录。请保留现有配置，在单独的项目副本中运行演示。");
  const env = { BETTER_AUTH_SECRET: existing.BETTER_AUTH_SECRET || randomBytes(48).toString("base64"), BETTER_AUTH_URL: "http://localhost:3000", DATA_DIR: "./.local/demo-v3", ENABLE_DEMO_LOGIN: "true", DEMO_PASSWORD: existing.DEMO_PASSWORD || randomBytes(24).toString("base64url") };
  Object.assign(process.env, env);
  writeFileSync(".env.local", Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  const { db } = await import("../src/db"); const s = await import("../src/db/schema"); const { createMember } = await import("../src/lib/provision"); const { storeAsset } = await import("../src/lib/assets");
  if (db.select().from(s.members).all().length) { console.log("独立演示空间已存在，保留现有演示记录。运行 npm run dev 后点击“先逛逛演示空间”。"); return; }
  const a = await createMember({ name: "阿屿", email: "lin@tongye.demo", password: env.DEMO_PASSWORD });
  const b = await createMember({ name: "小满", email: "man@tongye.demo", password: env.DEMO_PASSWORD });
  const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const palettes = [["#d8e1d2", "#254c41", "#9baa77"], ["#b6c9cb", "#305761", "#779798"], ["#2f403d", "#e6ddbb", "#7f9277"], ["#e6d6b8", "#805c3c", "#ba9c68"], ["#994f3f", "#f1dab4", "#703b32"], ["#e3dfd0", "#677157", "#a2a988"]];
  async function cover(title: string, subtitle: string, i: number, book: boolean) {
    const [bg, fg, accent] = palettes[i % palettes.length]; const lines = title.length > 6 ? [title.slice(0, Math.ceil(title.length / 2)), title.slice(Math.ceil(title.length / 2))] : [title];
    const landscape = `<circle cx="230" cy="330" r="155" fill="${accent}" opacity=".22"/><path d="M0 580 Q100 330 240 470 T460 410 V690 H0" fill="${accent}" opacity=".45"/><path d="M0 670 Q110 500 250 570 T460 500 V690 H0" fill="${fg}" opacity=".3"/><path d="M230 690 Q60 540 210 480 T320 350" stroke="${bg}" stroke-width="8" fill="none" opacity=".65"/>`;
    const botanical = `<ellipse cx="235" cy="440" rx="125" ry="165" fill="${accent}" opacity=".14"/><path d="M200 590 Q295 420 225 315 M225 525 Q135 505 155 440 Q205 450 240 485 M252 452 Q330 425 310 365 Q260 380 258 420 M245 380 Q165 355 185 300" fill="none" stroke="${fg}" stroke-width="2" opacity=".55"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="690"><rect width="460" height="690" fill="${bg}"/><rect x="20" y="20" width="420" height="650" fill="none" stroke="${fg}" opacity=".2"/>${book ? botanical : landscape}<text x="230" y="65" text-anchor="middle" font-family="serif" font-size="11" fill="${fg}" letter-spacing="5" opacity=".7">${book ? "A BOOK TO KEEP" : "A FILM TO REMEMBER"}</text>${lines.map((line, n) => `<text x="230" y="${140 + n * 66}" text-anchor="middle" font-family="Songti SC,serif" font-size="${title.length > 7 ? 42 : 52}" fill="${fg}" letter-spacing="7">${escape(line)}</text>`).join("")}<text x="230" y="${lines.length > 1 ? 254 : 200}" text-anchor="middle" font-family="serif" font-size="16" fill="${fg}" opacity=".7" letter-spacing="3">${escape(subtitle)}</text><text x="230" y="637" text-anchor="middle" font-family="serif" font-size="10" fill="${fg}" opacity=".65" letter-spacing="4">OUR SHARED PAGES · DEMO</text>${book ? `<path d="M12 0V690" stroke="#000" opacity=".12" stroke-width="6"/>` : ""}</svg>`;
    return storeAsset(await sharp(Buffer.from(svg)).png().toBuffer(), `${title}-演示封面.png`, a.id);
  }
  const photoPath = path.resolve("demo-assets/mountain-lake.jpg");
  const lakeId = existsSync(photoPath) ? await storeAsset(readFileSync(photoPath), "山间湖泊-Unsplash演示配图.jpg", a.id) : null;
  const movies = [
    ["花样年华", "王家卫", 2000, "completed", "在人来人往的街巷里，关于错过与相遇的故事。"],
    ["爱在黎明破晓前", "理查德·林克莱特", 1995, "completed", "在陌生城市走一整夜，聊一些重要和不重要的事。"],
    ["海街日记", "是枝裕和", 2015, "completed", "海边的小城，四季流转，平凡生活里温柔的连接。"],
    ["海上钢琴师", "朱塞佩·托纳多雷", 1998, "planned", "一架钢琴，一艘轮船，和一生关于选择的故事。"],
    ["情书", "岩井俊二", 1995, "planned", "从一封寄往往昔的信开始，重新认识记忆中的人。"],
    ["布达佩斯大饭店", "韦斯·安德森", 2014, "planned", "色彩、秩序，以及藏在冒险故事里的浪漫。"],
    ["心灵奇旅", "彼特·道格特", 2020, "completed", "或许生活的意义，就藏在那些普通得不能再普通的瞬间。"],
    ["帕特森", "吉姆·贾木许", 2016, "in_progress", "公交车、诗歌和日常生活，一种缓慢而安静的美。"],
    ["白日梦想家", "本·斯蒂勒", 2013, "completed", "从想象出发，迈出第一步，在更大的世界里遇见自己。"],
  ] as const;
  const books = [
    ["小王子", "安托万·德·圣埃克苏佩里", 1943, "completed", "completed"],
    ["你今天真好看", "莉兹·克里莫", 2015, "completed", "completed"],
    ["人间草木", "汪曾祺", 2005, "planned", "planned"],
    ["山茶文具店", "小川糸", 2016, "planned", "planned"],
    ["长日将尽", "石黑一雄", 1989, "planned", "planned"],
    ["瓦尔登湖", "亨利·戴维·梭罗", 1854, "in_progress", "completed"],
    ["悉达多", "赫尔曼·黑塞", 1922, "in_progress", "in_progress"],
  ] as const;
  const base = Date.parse("2026-09-01T20:00:00+08:00"); const byTitle = new Map<string, string>();
  for (let i = 0; i < movies.length; i++) {
    const [title, director, year, status, summary] = movies[i]; const id = randomUUID(); byTitle.set(title, id);
    const coverId = await cover(title, director, i, false); const date = base + (i + 4) * 86_400_000;
    db.insert(s.entries).values({ id, kind: "movie", title, summary, coverId, tags: i % 2 ? ["周末放映"] : ["想再看一次"], links: [{ label: "在豆瓣查找", url: `https://www.douban.com/search?q=${encodeURIComponent(title)}` }], createdAt: date, updatedAt: date,  }).run();
    db.insert(s.movies).values({ entryId: id, director, year }).run();
    for (const person of [a.id, b.id]) db.insert(s.personalRecords).values({ entryId: id, userId: person, status: status === "in_progress" ? "planned" : status, startedOn: null, completedOn: status === "completed" ? new Date(date).toISOString().slice(0, 10) : null, createdAt: date, updatedAt: date }).run();
    if (status === "completed") db.insert(s.togetherConfirmations).values({ entryId: id, completedOn: new Date(date).toISOString().slice(0, 10), recordedBy: a.id, createdAt: date }).run();
    db.insert(s.challengeEntries).values({ challengeId: "movies-100", entryId: id }).run();
    if (status === "completed") for (const [person, score, body] of [[a.id, 4.5, i === 8 ? "好想和你去看一次真正的山和海。不着急，我们可以慢慢计划。" : "有些画面，看完以后还会反复想起。"], [b.id, 5, i === 8 ? "最喜欢的是他终于出发的那一刻。下个周末，一起去走走吧。" : "和你一起看，让这个故事多了一点特别的意义。"]] as const) db.insert(s.reviews).values({ id: randomUUID(), entryId: id, userId: person, rating: score, body }).run();
  }
  for (let i = 0; i < books.length; i++) {
    const [title, author, year, first, second] = books[i]; const id = randomUUID(); byTitle.set(title, id); const createdAt = base + i * 86_400_000;
    db.insert(s.entries).values({ id, kind: "book", title, summary: "想和你一起翻开，也想听听你读完后的感受。", coverId: await cover(title, author, i + 2, true), tags: i > 4 ? ["慢慢读"] : ["枕边书"], links: [{ label: "在豆瓣查找", url: `https://www.douban.com/search?q=${encodeURIComponent(title)}` }], createdAt, updatedAt: createdAt }).run();
    db.insert(s.books).values({ entryId: id, author, year }).run();
    for (const [person, status] of [[a.id, first], [b.id, second]] as const) db.insert(s.personalRecords).values({ entryId: id, userId: person, status, startedOn: status === "planned" ? null : new Date(createdAt).toISOString().slice(0, 10), completedOn: status === "completed" ? new Date(createdAt + 604800000).toISOString().slice(0, 10) : null, createdAt, updatedAt: createdAt }).run();
    if (first === "completed" && second === "completed") db.insert(s.togetherConfirmations).values({ entryId: id, completedOn: new Date(createdAt + 604800000).toISOString().slice(0, 10), recordedBy: a.id, createdAt }).run();
    db.insert(s.challengeEntries).values({ entryId: id, challengeId: "books-100" }).run();
    if (i < 2) for (const person of [a.id, b.id]) db.insert(s.reviews).values({ id: randomUUID(), entryId: id, userId: person, rating: 4.5, body: "读到喜欢的地方会折一个小角，等你读到这里，我们再聊。" }).run();
  }
  for (const [title, date, place, body, photos] of [
    ["白日梦想家", "2026-10-17", "家里的沙发", "看完以后，我们认真讨论了一次说走就走。最后决定，先从周末的散步开始。", lakeId ? [lakeId] : []],
    ["海街日记", "2026-10-10", "一个有雨的周六", "你说想去镰仓，我说想试试做梅子酒。电影结束了，我们还坐着聊了好久。", []],
    ["小王子", "2026-10-04", "街角的咖啡店", "各自圈出了喜欢的段落，竟然有三处一模一样。连咖啡凉了都没有注意到。", []],
    ["爱在黎明破晓前", "2026-09-26", "投影仪前", "关掉投影以后，我们也决定出门散散步。不用目的地，只要一直聊下去。", []],
  ] as const) db.insert(s.memories).values({ id: randomUUID(), entryId: byTitle.get(title)!, date, place, body, photos: [...photos], createdAt: Date.parse(`${date}T22:00:00+08:00`) }).run();
  console.log("演示空间已创建：9 部电影、7 本书、2 位虚构成员。数据存放在 .local/demo-v3，与正式 data 目录分离。\n运行 npm run dev，然后点击“先逛逛演示空间”。");
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
