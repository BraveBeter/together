import type { Entry } from "./types";
export const movieThemes = [
  { key: "animation", title: "动画", subtitle: "画出来的世界，也有真实的温度。", genres: ["animation", "动画", "動畫"] },
  { key: "science-fiction", title: "科幻", subtitle: "越过已知，去往更远的地方。", genres: ["sciencefiction", "scifi", "科幻"] },
  { key: "mystery-crime", title: "悬疑与犯罪", subtitle: "跟着线索，走进故事的另一面。", genres: ["mystery", "crime", "悬疑", "懸疑", "犯罪"] },
  { key: "thriller", title: "惊悚与恐怖", subtitle: "光影之间，屏住呼吸的一刻。", genres: ["thriller", "horror", "惊悚", "驚悚", "恐怖"] },
  { key: "comedy", title: "喜剧", subtitle: "为生活，留一点轻盈。", genres: ["comedy", "喜剧", "喜劇"] },
  { key: "adventure", title: "动作与冒险", subtitle: "故事总在出发之后展开。", genres: ["action", "adventure", "war", "western", "动作", "動作", "冒险", "冒險", "战争", "戰爭", "武侠", "武俠", "西部"] },
  { key: "romance", title: "爱情", subtitle: "那些关于相遇、相伴与想念的故事。", genres: ["romance", "爱情", "愛情"] },
  { key: "documentary", title: "纪录", subtitle: "镜头所及，生活本来的样子。", genres: ["documentary", "纪录", "纪录片", "紀錄片", "記錄片"] },
  { key: "drama", title: "剧情", subtitle: "在别人的故事里，遇见生活的回声。", genres: ["drama", "biography", "history", "family", "music", "musical", "sport", "fantasy", "剧情", "劇情", "传记", "傳記", "历史", "歷史", "家庭", "音乐", "音樂", "歌舞", "运动", "運動", "奇幻"] },
  { key: "other", title: "其他故事", subtitle: "尚未归类，也值得好好收藏。", genres: [] },
] as const;
export type MovieThemeKey = typeof movieThemes[number]["key"];
const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, "");
export function matchesMovieGenre(entry: Pick<Entry, "metadata">, key: string): boolean {
  const theme = movieThemes.find(t => t.key === key); if (!theme) return false;
  if (key === "other") return primaryMovieTheme(entry) === "other";
  return (entry.metadata?.genres ?? []).some(g => (theme.genres as readonly string[]).includes(normalize(g)));
}
export function primaryMovieTheme(entry: Pick<Entry, "metadata">): MovieThemeKey {
  return movieThemes.find(t => t.key !== "other" && matchesMovieGenre(entry, t.key))?.key ?? "other";
}
export function groupMovies(entries: Entry[]) {
  return movieThemes.map(theme => ({ ...theme, entries: entries.filter(e => primaryMovieTheme(e) === theme.key) })).filter(group => group.entries.length);
}
