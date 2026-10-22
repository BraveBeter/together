import type { Entry, EntryLink, Kind } from "./types";
import { canonicalISBN } from "./isbn";

export const catalogSources = {
  upstairs: { name: "NeoDB · 楼上", origin: "https://film.upstairs.cn" },
  eggplant: { name: "NeoDB · Eggplant", origin: "https://eggplant.place" },
} as const;
export type CatalogSource = keyof typeof catalogSources;
export type CatalogRef = { source: CatalogSource; kind: Kind; id: string };
export type CatalogMetadata = CatalogRef & {
  identities: string[];
  originalTitle: string;
  isbn: string;
  publisher: string;
  translator: string;
  pages: number | null;
  minutes: number | null;
  genres: string[];
};
export type CatalogItem = {
  ref: CatalogRef;
  title: string;
  creator: string;
  year: number | null;
  summary: string;
  hasCover: boolean;
  links: EntryLink[];
  metadata: CatalogMetadata;
};
export type CatalogSearch = { items: CatalogItem[]; warning: string };
export type CatalogImport = { item: CatalogItem; coverId: string | null; existingId?: string; warning: string };

export function catalogKey(ref: CatalogRef) { return `${ref.source}:${ref.kind}:${ref.id}`; }
export function sameCatalogItem(a: CatalogMetadata | null | undefined, b: CatalogMetadata | null | undefined) {
  return !!a && !!b && a.kind === b.kind && (a.identities.some(id => b.identities.includes(id)) || (a.kind === "book" && !!canonicalISBN(a.isbn) && canonicalISBN(a.isbn) === canonicalISBN(b.isbn)));
}
export function matchesCatalogEntry(entry: Pick<Entry, "kind" | "metadata" | "links">, item: Pick<CatalogItem, "ref" | "metadata" | "links">) {
  if (entry.kind !== item.ref.kind) return false;
  if (sameCatalogItem(entry.metadata, item.metadata)) return true;
  const canonical = (value: string) => { try {
    const url = new URL(value), pathname = url.pathname.replace(/\/$/, "");
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return "";
    const catalog = ["neodb.social", "film.upstairs.cn", "eggplant.place"].includes(url.hostname) && new RegExp(`^/${entry.kind}/[A-Za-z0-9]{12,32}$`).test(pathname);
    const douban = url.hostname === `${entry.kind}.douban.com` && /^\/subject\/\d+$/.test(pathname);
    const movie = entry.kind === "movie" && (["www.imdb.com", "imdb.com"].includes(url.hostname) && /^\/title\/tt\d+$/.test(pathname) || ["www.themoviedb.org", "themoviedb.org"].includes(url.hostname) && /^\/movie\/\d+$/.test(pathname));
    return catalog || douban || movie ? `${url.hostname}${pathname}` : "";
  } catch { return ""; } };
  return entry.links.some(link => { const key = canonical(link.url); return !!key && item.links.some(source => key === canonical(source.url)); });
}
export function catalogFacts(metadata?: CatalogMetadata | null): { label: string; value: string }[] {
  if (!metadata) return [];
  const rows = metadata.kind === "book"
    ? [["出版社", metadata.publisher], ["译者", metadata.translator], ["ISBN", metadata.isbn], ["页数", metadata.pages ? `${metadata.pages} 页` : ""]]
    : [["原名", metadata.originalTitle], ["片长", metadata.minutes ? `${metadata.minutes} 分钟` : ""], ["类型", metadata.genres.join(" / ")]];
  return rows.filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}
