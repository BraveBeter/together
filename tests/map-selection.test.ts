import { describe, expect, it, vi } from "vitest";
import { photosInScreenCircle, screenCircleOutline, type ScreenProjection } from "../src/lib/map-selection";
import type { PhotoPoint } from "../src/lib/photo-types";

const projection: ScreenProjection = { project: p => ({ x: p.lng, y: p.lat }), unproject: p => ({ lng: p.x, lat: p.y }) };
const photo = (id: string, lng: number, lat: number): PhotoPoint => ({ id, lng, lat, assetId: "", place: "", takenOn: null, tripId: null, participants: [] });

describe("photo cursor circle", () => {
  it("selects every photo in the circle, including its edge, and excludes bounding-box corners", () => {
    const points = [photo("center", 0, 0), photo("nearby", -20, 20), photo("edge", 30, 40), photo("corner", 40, 40), photo("outside", 51, 0)];
    expect(photosInScreenCircle(points, { x: 0, y: 0 }, 50, projection).map(p => p.id)).toEqual(["center", "nearby", "edge"]);
  });
  it("deduplicates tiled IDs without collapsing distinct photos at identical coordinates", () => {
    const points = [photo("first", 10, 10), photo("first", 10, 10), photo("second", 10, 10)];
    expect(photosInScreenCircle(points, { x: 10, y: 10 }, 44, projection).map(p => p.id)).toEqual(["first", "second"]);
  });
  it("does not select a point hidden behind the globe at the same screen pixel", () => {
    const globe: ScreenProjection = { project: () => ({ x: 10, y: 10 }), unproject: () => ({ lat: 31, lng: 121 }) };
    expect(photosInScreenCircle([photo("visible", 121, 31), photo("far-side", -59, -31)], { x: 10, y: 10 }, 44, globe).map(p => p.id)).toEqual(["visible"]);
  });
  it("selects across the dateline using the visible world copy", () => {
    const wrapped: ScreenProjection = { project: p => ({ x: p.lng < 0 ? p.lng + 360 : p.lng, y: p.lat }), unproject: p => ({ lng: p.x > 180 ? p.x - 360 : p.x, lat: p.y }) };
    expect(photosInScreenCircle([photo("west", 179, 0), photo("east", -179, 0), photo("far", 150, 0)], { x: 180, y: 0 }, 3, wrapped)).toHaveLength(2);
  });
  it("returns an empty selection rather than selecting the whole collection", () => {
    expect(photosInScreenCircle([photo("away", 50, 50)], { x: 0, y: 0 }, 10, projection)).toEqual([]);
  });
  it("handles 10,000 coincident photos with a single coordinate projection", () => {
    const project = vi.fn(projection.project), unproject = vi.fn(projection.unproject);
    expect(photosInScreenCircle(Array.from({ length: 10000 }, (_, i) => photo(String(i), 10, 10)), { x: 10, y: 10 }, 44, { project, unproject })).toHaveLength(10000);
    expect(project).toHaveBeenCalledTimes(1); expect(unproject).toHaveBeenCalledTimes(1);
  });
  it("stores the selected boundary geographically and closes valid circles", () => {
    const outline = screenCircleOutline({ x: 0, y: 0 }, 10, projection);
    const line = outline.features.find(f => f.geometry.type === "LineString")!;
    if (line.geometry.type !== "LineString") throw Error("Missing outline");
    expect(line.geometry.coordinates[0]).toEqual(line.geometry.coordinates.at(-1));
    for (const [x, y] of line.geometry.coordinates) expect(Math.hypot(x, y)).toBeCloseTo(10, 8);
    expect(outline.features.some(f => f.geometry.type === "Polygon")).toBe(true);
  });
  it("splits arcs at the globe limb instead of connecting across empty space", () => {
    const limb: ScreenProjection = { project: projection.project, unproject: p => ({ lng: Math.min(0, p.x), lat: p.y }) };
    const outline = screenCircleOutline({ x: 0, y: 0 }, 10, limb);
    expect(outline.features.some(f => f.geometry.type === "Polygon")).toBe(false);
    for (const f of outline.features) if (f.geometry.type === "LineString") for (const [x] of f.geometry.coordinates) expect(x).toBeLessThanOrEqual(0);
  });
});
