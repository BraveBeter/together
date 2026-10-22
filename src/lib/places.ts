import { z } from "zod";
import { gcjToWgs, validCoordinates } from "./photo-domain";
import { InputError } from "./records";
import type { PlaceResult } from "./photo-types";
const cache = new Map<string, { until: number; items: PlaceResult[] }>();
const lastRequest = new Map<string, number>();
export async function searchPlaces(memberId: string, raw: string, city: string): Promise<PlaceResult[]> {
  const q = z.string().trim().min(2, "至少输入两个字").max(100).parse(raw);
  z.string().max(100).parse(city);
  const key = process.env.AMAP_WEB_KEY;
  if (!key) throw new InputError("地点搜索尚未配置。可以先使用地球选点或经纬度，照片仍会保存。");
  const query = `${q}:${city}`, old = cache.get(query); if (old && old.until > Date.now()) return old.items;
  if (Date.now() - (lastRequest.get(memberId) ?? 0) < 1000) throw new InputError("搜索稍快了一点，请稍后再试。");
  lastRequest.set(memberId, Date.now());
  const url = new URL("https://restapi.amap.com/v5/place/text");
  url.search = new URLSearchParams({ key, keywords: q, page_size: "12", show_fields: "business", ...(city ? { region: city } : {}) }).toString();
  let data: { status?: string; pois?: { id?: string; name?: string; address?: string; pname?: string; cityname?: string; adname?: string; location?: string }[] };
  try { const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" }); if (!response.ok) throw new Error(); data = await response.json(); }
  catch { throw new InputError("暂时连不上地点搜索。输入已保留，也可以手动选点。"); }
  if (data.status !== "1" || !Array.isArray(data.pois)) throw new InputError("地点服务暂不可用，请检查服务配置或稍后重试。");
  const items: PlaceResult[] = data.pois.flatMap(poi => {
    const [lng, lat] = String(poi.location).split(",").map(Number);
    if (!validCoordinates(lat, lng) || !poi.id || !poi.name) return [];
    return [{ id: poi.id, place: poi.name, source: "amap" as const, ...gcjToWgs({ lat, lng }), address: [poi.pname, poi.cityname, poi.adname, poi.address].filter(v => typeof v === "string").join(" ") }];
  });
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(query, { until: Date.now() + 60_000, items }); return items;
}
