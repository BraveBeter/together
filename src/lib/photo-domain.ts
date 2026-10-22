import type { Coordinates, PhotoPoint } from "./photo-types";

const radians = Math.PI / 180;
export function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function distanceKm(a: Coordinates, b: Coordinates) {
  const dLat = (b.lat - a.lat) * radians, dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function circlePath(center: Coordinates, radiusKm: number) {
  const angular = radiusKm / 6371.0088, lat = center.lat * radians, lng = center.lng * radians;
  return Array.from({ length: 129 }, (_, i) => {
    const bearing = i / 128 * Math.PI * 2;
    const phi = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const lambda = lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(phi));
    return { lat: phi / radians, lng: ((lambda / radians + 540) % 360) - 180 };
  });
}
export function photoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T]|$)/.exec(value);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`, parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === day && Number(m[1]) >= 1800 ? day : null;
}

// GCJ-02 -> WGS84 inverse by iteration. Original EXIF coordinates stay untouched.
function wgsToGcj({ lat, lng }: Coordinates): Coordinates {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng };
  const x = lng - 105, y = lat - 35, pi = Math.PI;
  let a = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x));
  a += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
  a += (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3;
  a += (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
  let b = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x));
  b += (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3;
  b += (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3;
  b += (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
  const rad = lat * radians, magic = 1 - .00669342162296594323 * Math.sin(rad) ** 2, root = Math.sqrt(magic);
  return { lat: lat + a * 180 / ((6378245 * (1 - .00669342162296594323)) / (magic * root) * pi), lng: lng + b * 180 / (6378245 / root * Math.cos(rad) * pi) };
}
export function gcjToWgs(point: Coordinates): Coordinates {
  let result = { ...point };
  for (let i = 0; i < 6; i++) { const mapped = wgsToGcj(result); result = { lat: result.lat - (mapped.lat - point.lat), lng: result.lng - (mapped.lng - point.lng) }; }
  return result;
}

export type PhotoCluster = Coordinates & { id: string; points: PhotoPoint[]; count: number };
export function clusterPhotoPoints(points: PhotoPoint[], degrees: number): PhotoCluster[] {
  // Bucket unit vectors rather than longitude so the poles and dateline join naturally.
  const cell = Math.max(.00001, 2 * Math.sin(Math.max(.001, Math.min(30, degrees)) * radians / 2));
  const buckets = new Map<string, { x: number; y: number; z: number; items: PhotoPoint[] }[]>();
  const clusters: { x: number; y: number; z: number; items: PhotoPoint[] }[] = [];
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    const x = Math.cos(point.lat * radians) * Math.cos(point.lng * radians), y = Math.sin(point.lat * radians), z = Math.cos(point.lat * radians) * Math.sin(point.lng * radians);
    const bx = Math.floor(x / cell), by = Math.floor(y / cell), bz = Math.floor(z / cell);
    let found: typeof clusters[number] | undefined;
    for (let a = -1; a <= 1 && !found; a++) for (let b = -1; b <= 1 && !found; b++) for (let c = -1; c <= 1 && !found; c++) {
      found = buckets.get(`${bx + a},${by + b},${bz + c}`)?.find(p => Math.hypot(p.x - x, p.y - y, p.z - z) <= cell);
    }
    if (found) found.items.push(point);
    else { const group = { x, y, z, items: [point] }, key = `${bx},${by},${bz}`; clusters.push(group); buckets.set(key, [...(buckets.get(key) ?? []), group]); }
  }
  return clusters.map(c => {
    const sum = c.items.reduce((a, p) => ({ x: a.x + Math.cos(p.lat * radians) * Math.cos(p.lng * radians), y: a.y + Math.sin(p.lat * radians), z: a.z + Math.cos(p.lat * radians) * Math.sin(p.lng * radians) }), { x: 0, y: 0, z: 0 });
    return { id: c.items[0].id, lat: Math.atan2(sum.y, Math.hypot(sum.x, sum.z)) / radians, lng: Math.atan2(sum.z, sum.x) / radians, points: c.items, count: c.items.length };
  });
}
