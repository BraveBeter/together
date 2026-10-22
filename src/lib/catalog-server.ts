import sharp from "sharp";
import { z } from "zod";
import { catalogKey, catalogSources, sameCatalogItem, type CatalogItem, type CatalogMetadata, type CatalogRef, type CatalogSearch, type CatalogSource } from "./catalog-metadata";
import type { Kind } from "./types";
import { canonicalISBN } from "./isbn";

export const catalogRefSchema = z.object({ source: z.enum(["upstairs", "eggplant"]), kind: z.enum(["movie", "book"]), id: z.string().regex(/^[A-Za-z0-9]{12,32}$/) }).strict();
export const catalogMetadataSchema = catalogRefSchema.extend({
  identities: z.array(z.string().max(250)).min(1).max(30), originalTitle: z.string().max(300), isbn: z.string().max(13),
  publisher: z.string().max(300), translator: z.string().max(200), pages: z.number().int().positive().max(100000).nullable(),
  minutes: z.number().int().positive().max(100000).nullable(), genres: z.array(z.string().max(60)).max(20),
}).strict();
type StoredItem = CatalogItem & { coverUrl: string | null };
type Raw = Record<string, unknown>;
const TTL = 30 * 60_000;
const items = new Map<string, { expires: number; value: StoredItem; detailed: boolean }>();
const searches = new Map<string, { expires: number; value: CatalogSearch }>();
const inFlight = new Map<string, Promise<unknown>>();
const previews = new Map<string, { expires: number; bytes: Buffer }>();
const limits = new Map<string, { count: number; until: number }>();

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key); map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value!);
}
async function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key); if (pending) return pending as Promise<T>;
  const promise = task(); inFlight.set(key, promise);
  try { return await promise; } finally { inFlight.delete(key); }
}
export function allowCatalogRequest(memberId: string, bucket: "search" | "import" | "cover") {
  const key = `${memberId}:${bucket}`, now = Date.now(), limit = bucket === "cover" ? 100 : 20;
  let value = limits.get(key);
  if (!value || value.until <= now) { value = { count: 0, until: now + 60_000 }; boundedSet(limits, key, value, 30); }
  return ++value.count <= limit;
}
const string = (v: unknown, max = 10000) => typeof v === "string" ? v.trim().slice(0, max) : "";
const list = (v: unknown, max = 200): string[] => Array.isArray(v) ? v.map(x => string(x, max)).filter(Boolean).slice(0, 20) : string(v, max) ? [string(v, max)] : [];
function positive(v: unknown, max = 100000): number | null { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= max ? n : null; }
function localized(v: unknown, fallback: unknown, max = 10000) {
  const values = Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object" && !Array.isArray(x)) : [];
  for (const lang of ["zh-cn", "zh-hans", "zh", "zh-hant", "zh-tw"]) {
    const match = values.find(x => string(x.lang).toLowerCase() === lang && string(x.text));
    if (match) return string(match.text, max);
  }
  return string(fallback, max);
}
export function normalizeISBN(value: unknown) {
  const isbn = string(value, 100).replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(isbn) && [...isbn].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0) return isbn;
  if (/^\d{9}[\dX]$/.test(isbn) && [...isbn].reduce((sum, d, i) => sum + (d === "X" ? 10 : Number(d)) * (10 - i), 0) % 11 === 0) return isbn;
  return "";
}
export function safeCoverURL(value: unknown): string | null {
  try {
    const url = new URL(string(value, 2000));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !Object.values(catalogSources).some(s => s.origin === url.origin) || !url.pathname.startsWith("/m/")) return null;
    return url.href;
  } catch { return null; }
}
function externalIdentity(value: unknown, kind: Kind): { key: string; url: string; label: string } | null {
  try {
    const url = new URL(string(value, 2000));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname, pathname = url.pathname.replace(/\/$/, ""); let key = "", label = "";
    if (host === `${kind}.douban.com` && /^\/subject\/\d+$/.test(pathname)) { key = `douban:${kind}:${pathname.split("/").pop()}`; label = "豆瓣"; }
    else if (kind === "movie" && ["www.imdb.com", "imdb.com"].includes(host) && /^\/title\/tt\d+$/.test(pathname)) { key = `imdb:${pathname.split("/").pop()}`; label = "IMDb"; }
    else if (kind === "movie" && ["www.themoviedb.org", "themoviedb.org"].includes(host) && /^\/movie\/\d+$/.test(pathname)) { key = `tmdb:${pathname.split("/").pop()}`; label = "TMDB"; }
    else if (["neodb.social", "film.upstairs.cn", "eggplant.place"].includes(host) && new RegExp(`^/${kind}/[A-Za-z0-9]{12,32}$`).test(pathname)) { key = `${host}${pathname}`; }
    if (!key) return null;
    return { key, url: `https://${host}${pathname}/`, label };
  } catch { return null; }
}
export function normalizeCatalogItem(raw: Raw, source: CatalogSource, kind: Kind): StoredItem | null {
  const id = string(raw.uuid, 32), parsed = catalogRefSchema.safeParse({ source, kind, id });
  if (!parsed.success || raw.category !== kind || (kind === "book" && raw.type && raw.type !== "Edition")) return null;
  const title = localized(raw.localized_title, raw.title, 200); if (!title) return null;
  const ref = parsed.data, url = `${catalogSources[source].origin}/${kind}/${id}`;
  const resources = (Array.isArray(raw.external_resources) ? raw.external_resources : []).map(r => externalIdentity(r && typeof r === "object" ? (r as Raw).url : null, kind)).filter((r): r is NonNullable<typeof r> => !!r);
  const isbn = kind === "book" ? normalizeISBN(raw.isbn) : "";
  const metadata: CatalogMetadata = {
    ...ref, identities: [...new Set([`${new URL(url).hostname}/${kind}/${id}`, ...resources.map(r => r.key), ...(isbn ? [`isbn:${isbn}`, `isbn:${canonicalISBN(isbn)}`] : [])])].slice(0, 30),
    originalTitle: kind === "movie" ? string(raw.orig_title, 300) : string(raw.orig_title, 300), isbn,
    publisher: kind === "book" ? (list(raw.publisher).join(" / ") || string(raw.pub_house, 300)).slice(0, 300) : "",
    translator: kind === "book" ? list(raw.translator).join("、").slice(0, 200) : "",
    pages: kind === "book" ? positive(raw.pages) : null,
    minutes: kind === "movie" ? (positive(raw.length) ? Math.round(Number(raw.length) / 60) || null : positive(raw.duration)) : null,
    genres: kind === "movie" ? list(raw.genre, 60) : [],
  };
  const coverUrl = safeCoverURL(raw.cover_image_url);
  const releaseYear = string(raw.release_date).match(/^\d{4}/)?.[0];
  return { ref, title, creator: list(kind === "movie" ? raw.director : raw.author).join("、").slice(0, 200),
    year: positive(kind === "movie" ? releaseYear || raw.year : raw.pub_year, 2200),
    summary: localized(raw.localized_description, raw.description).replace(/<[^>]*>/g, ""), coverUrl, hasCover: !!coverUrl, metadata,
    links: [{ label: catalogSources[source].name, url }, ...resources.filter(r => r.label).slice(0, 4).map(({ label, url }) => ({ label, url }))],
  };
}
function publicItem(item: StoredItem): CatalogItem { const { coverUrl: _cover, ...publicData } = item; return publicData; }
export async function readLimited(response: Response, max: number): Promise<Buffer> {
  if (!response.ok || Number(response.headers.get("content-length")) > max) throw new Error("信源暂时不可用。");
  const reader = response.body?.getReader(); if (!reader) throw new Error("信源没有返回内容。");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new Error("信源返回的内容过大。"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export class CatalogRateLimitError extends Error {
  constructor(public retryAt: number) { super("信源正在限流，稍后会继续。已取得的结果会保留。"); }
}
let activeFetches = 0;
const fetchQueue: (() => void)[] = [];
const cooldowns = new Map<string, number>();
async function fetchPublic(url: string, max: number) {
  if (activeFetches >= 2) await new Promise<void>(resolve => fetchQueue.push(resolve));
  else activeFetches++;
  try {
  const host = new URL(url).host, until = cooldowns.get(host) ?? 0;
  if (until > Date.now()) throw new CatalogRateLimitError(until);
  // Only fixed catalog hosts/paths reach here. Never follow a redirect to another host.
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Tongye/1.0 (private two-person catalog)", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5" } });
  if (response.status === 429 || response.status === 503 && response.headers.has("retry-after")) {
    const raw = response.headers.get("retry-after"), seconds = Number(raw);
    const retryAt = raw && Number.isFinite(seconds) ? Date.now() + Math.max(1, seconds) * 1000 : raw && Number.isFinite(Date.parse(raw)) ? Math.max(Date.now() + 1000, Date.parse(raw)) : Date.now() + 60_000;
    cooldowns.set(host, retryAt); await response.body?.cancel(); throw new CatalogRateLimitError(retryAt);
  }
  return { response, bytes: await readLimited(response, max) };
  } finally { const next = fetchQueue.shift(); if (next) next(); else activeFetches--; }
}
async function fetchJSON(url: string) {
  const { response, bytes } = await fetchPublic(url, 2 * 1024 * 1024);
  if (!response.headers.get("content-type")?.includes("json")) throw new Error("信源返回了验证页或非目录内容，请稍后重试。");
  return JSON.parse(bytes.toString("utf8"));
}
function remember(item: StoredItem, detailed: boolean) {
  const key = catalogKey(item.ref), old = items.get(key);
  if (!detailed && old?.detailed && old.expires > Date.now()) return;
  boundedSet(items, key, { value: item, detailed, expires: Date.now() + TTL }, 300);
}
export function mergeCatalogResults(results: CatalogItem[], query: string) {
  const norm = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
  const wanted = norm(query), isbn = normalizeISBN(query);
  const rank = (item: CatalogItem) => (isbn && item.metadata.isbn === isbn ? 200 : norm(item.title) === wanted ? 100 : norm(item.title).includes(wanted) ? 30 : 0) + (/\p{Script=Han}/u.test(item.title) ? 8 : 0);
  const merged: CatalogItem[] = [];
  for (const item of [...results].sort((a, b) => rank(b) - rank(a))) {
    const old = merged.find(x => sameCatalogItem(x.metadata, item.metadata));
    if (old) { old.metadata = { ...old.metadata, identities: [...new Set([...old.metadata.identities, ...item.metadata.identities])].slice(0, 30) }; continue; }
    merged.push({ ...item, metadata: { ...item.metadata } });
  }
  return merged.slice(0, 20);
}
export async function searchCatalog(kind: Kind, query: string): Promise<CatalogSearch> {
  const q = normalizeISBN(query) || query.trim(), key = `${kind}:${q.toLowerCase()}`;
  const cached = searches.get(key); if (cached && cached.expires > Date.now()) return cached.value;
  return singleFlight(`search:${key}`, async () => {
    const results = await Promise.allSettled((Object.keys(catalogSources) as CatalogSource[]).map(async source => {
      const data = await fetchJSON(`${catalogSources[source].origin}/api/catalog/search?${new URLSearchParams({ category: kind, query: q })}`);
      if (!Array.isArray(data.data)) throw new Error("目录格式暂不可用。");
      return (data.data as Raw[]).slice(0, 20).map(raw => normalizeCatalogItem(raw, source, kind)).filter((item): item is StoredItem => !!item).map(item => { remember(item, false); return publicItem(item); });
    }));
    const successful = results.filter((r): r is PromiseFulfilledResult<CatalogItem[]> => r.status === "fulfilled");
    if (!successful.length) {
      const limited = results.find(r => r.status === "rejected" && r.reason instanceof CatalogRateLimitError);
      if (limited?.status === "rejected") throw limited.reason;
      throw new Error("暂时连不上作品目录。请稍后重试，或手动填写；你的输入会保留。");
    }
    const value = { items: mergeCatalogResults(successful.flatMap(r => r.value), q), warning: successful.length < results.length ? "部分信源暂时不可用，已显示可读取的结果。" : "" };
    boundedSet(searches, key, { value, expires: Date.now() + (value.warning ? 30_000 : TTL) }, 100);
    return value;
  });
}
export async function getCatalogItem(input: CatalogRef): Promise<CatalogItem> {
  const ref = catalogRefSchema.parse(input), key = catalogKey(ref), old = items.get(key);
  if (old?.detailed && old.expires > Date.now()) return publicItem(old.value);
  return singleFlight(`detail:${key}`, async () => {
    const raw = await fetchJSON(`${catalogSources[ref.source].origin}/api/${ref.kind}/${ref.id}`);
    const item = normalizeCatalogItem(raw, ref.source, ref.kind);
    if (!item || item.ref.id !== ref.id) throw new Error("这条资料已变化，请重新搜索后选择。");
    remember(item, true); return publicItem(item);
  });
}
export async function getCatalogCover(input: CatalogRef, preview = false): Promise<Buffer | null> {
  const ref = catalogRefSchema.parse(input), key = catalogKey(ref), cached = previews.get(key);
  if (preview && cached && cached.expires > Date.now()) return cached.bytes;
  let item = items.get(key);
  if (!item || item.expires <= Date.now()) { await getCatalogItem(ref); item = items.get(key); }
  const url = safeCoverURL(item?.value.coverUrl); if (!url) return null;
  const fetchImage = async () => {
    const { response, bytes } = await fetchPublic(url, 10 * 1024 * 1024);
    if (!/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("信源封面暂不可用。");
    if (!preview) return bytes;
    const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 160, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    boundedSet(previews, key, { bytes: thumbnail, expires: Date.now() + TTL }, 80); return thumbnail;
  };
  return singleFlight(`cover:${preview}:${key}`, fetchImage);
}
