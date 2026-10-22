import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { continuousMapStyle, footprintFeatures, footprintLayers, rangeFeatures, sampleFootprints } from "../src/lib/continuous-map";
import { distanceKm } from "../src/lib/photo-domain";

describe("continuous map prototype", () => {
  it("uses a valid vector globe style with locally generated labels", () => {
    const style = continuousMapStyle();
    style.sources.footprints = { type: "geojson", data: footprintFeatures(sampleFootprints(2)), cluster: true };
    style.layers.push(...footprintLayers());
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.glyphs).toBeUndefined();
    expect(style.layers.some(l => l.type === "raster")).toBe(false);
  });
  it("does not put private photo metadata into the renderer source", () => {
    const points = sampleFootprints(1);
    points[0] = { ...points[0], place: "private-place", participants: ["private-member"], assetId: "private-asset", takenOn: "2000-01-01" };
    const features = footprintFeatures(points);
    expect(Object.keys(features.features[0].properties!)).toEqual(["id", "colour"]);
    expect(features.features[0].properties?.id).toBe(points[0].id);
    expect(features.features[0].properties?.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(JSON.stringify(features)).not.toMatch(/private|2000-01-01/);
  });
  it.each([{ lat: 31, lng: 121 }, { lat: 1, lng: 179.99 }, { lat: 86, lng: -179 }])("keeps a 50km range on the globe and across the dateline at %j", center => {
    const range = rangeFeatures(center, 50).features[0];
    if (range.geometry.type !== "LineString") throw Error("Missing range line");
    const ring = range.geometry.coordinates;
    for (let i = 0; i < ring.length; i++) {
      expect(distanceKm(center, { lat: ring[i][1], lng: ring[i][0] })).toBeCloseTo(50, 5);
      if (i) expect(Math.abs(ring[i][0] - ring[i - 1][0])).toBeLessThan(180);
    }
  });
  it("produces reproducible isolated load-test data without photo references", () => {
    const points = sampleFootprints(10000);
    expect(new Set(points.map(p => p.id)).size).toBe(10000);
    expect(points.every(p => Math.abs(p.lat) < 85 && Math.abs(p.lng) < 180 && !p.assetId)).toBe(true);
    expect(points.slice(0, 3)).toEqual(sampleFootprints(3));
    expect(rangeFeatures(null, 20).features).toEqual([]);
  });
});
