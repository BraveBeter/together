import type { ExpressionSpecification, StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { Coordinates, PhotoPoint } from "./photo-types";
import { circlePath } from "./photo-domain";

export const MAP_FONT = ["Arial", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "sans-serif"];
const localName: ExpressionSpecification = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name"], ["get", "name:latin"], ""];
const vector = { source: "basemap", "source-layer": "transportation" };
const textPaint = { "text-color": "#d8ded9", "text-halo-color": "#1b2528", "text-halo-width": 1.5 };
function place(id: string, classes: string[], minzoom: number, maxzoom: number, size: number): SymbolLayerSpecification {
  return {
    id, type: "symbol", source: "basemap", "source-layer": "place", minzoom, maxzoom,
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: { "text-field": localName, "text-font": MAP_FONT, "text-size": size, "text-max-width": 7, "text-padding": 10, "symbol-sort-key": ["coalesce", ["get", "rank"], 10] },
    paint: textPaint,
  };
}

// One vector style throughout the flight. No raster inversion, sprites or 3D
// buildings: roads and labels keep their contrast at fractional zoom levels.
export function continuousMapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "同页 · 夜航",
    // Native globe keeps latitude during initialization and continuously blends
    // into Mercator at urban scale, without replacing the canvas or camera.
    projection: { type: "globe" },
    sources: { basemap: {
      type: "vector", url: "https://tiles.openfreemap.org/planet",
      attribution: '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
    } },
    layers: [
      { id: "land", type: "background", paint: { "background-color": "#283537" } },
      { id: "wood", type: "fill", source: "basemap", "source-layer": "landcover", minzoom: 4, filter: ["in", ["get", "class"], ["literal", ["wood", "grass"]]], paint: { "fill-color": "#293e36", "fill-opacity": .7 } },
      { id: "parks", type: "fill", source: "basemap", "source-layer": "park", minzoom: 10, paint: { "fill-color": "#2b463c", "fill-opacity": .8 } },
      { id: "water", type: "fill", source: "basemap", "source-layer": "water", paint: { "fill-color": "#132933" } },
      { id: "rivers", type: "line", source: "basemap", "source-layer": "waterway", minzoom: 8, paint: { "line-color": "#193a48", "line-width": ["interpolate", ["linear"], ["zoom"], 8, .6, 16, 3] } },
      { id: "buildings", type: "fill", source: "basemap", "source-layer": "building", minzoom: 14, paint: { "fill-color": "#3e4a49", "fill-outline-color": "#56615b", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, .8] } },
      { id: "local-roads", type: "line", ...vector, minzoom: 12, filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#63716d", "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, .4, 16, 2.5, 20, 12] } },
      { id: "main-road-casing", type: "line", ...vector, minzoom: 6, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]], layout: { "line-join": "round" }, paint: { "line-color": "#1c292c", "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, 1, 12, 3, 16, 7, 20, 29] } },
      { id: "main-roads", type: "line", ...vector, minzoom: 6, filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]], layout: { "line-join": "round" }, paint: { "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#bcaa7e", "#8b9690"], "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, .4, 12, 1.4, 16, 4.5, 20, 25] } },
      { id: "railways", type: "line", ...vector, minzoom: 11, filter: ["==", ["get", "class"], "rail"], paint: { "line-color": "#a29285", "line-width": 1, "line-dasharray": [2, 2] } },
      { id: "regional-borders", type: "line", source: "basemap", "source-layer": "boundary", minzoom: 5, filter: [">", ["get", "admin_level"], 2], paint: { "line-color": "#778781", "line-width": .8, "line-opacity": .6, "line-dasharray": [3, 3] } },
      { id: "national-borders", type: "line", source: "basemap", "source-layer": "boundary", filter: ["==", ["get", "admin_level"], 2], paint: { "line-color": "#7f918d", "line-width": 1, "line-opacity": .65 } },
      { id: "water-names", type: "symbol", source: "basemap", "source-layer": "water_name", minzoom: 4, layout: { "text-field": localName, "text-font": MAP_FONT, "text-size": 12, "text-max-width": 8 }, paint: { ...textPaint, "text-color": "#95b7c1" } },
      { id: "road-names", type: "symbol", source: "basemap", "source-layer": "transportation_name", minzoom: 12, layout: { "symbol-placement": "line", "text-field": localName, "text-font": MAP_FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 17, 14], "text-padding": 5, "symbol-spacing": 300 }, paint: textPaint },
      { id: "places-of-interest", type: "symbol", source: "basemap", "source-layer": "poi", minzoom: 16, filter: ["<=", ["coalesce", ["get", "rank"], 100], 7], layout: { "text-field": localName, "text-font": MAP_FONT, "text-size": 12, "text-max-width": 8, "text-padding": 14 }, paint: { ...textPaint, "text-color": "#b5c9b1" } },
      place("neighbourhoods", ["suburb", "quarter", "neighbourhood", "hamlet", "village"], 11, 21, 13),
      place("towns", ["town"], 8, 17, 14),
      place("cities", ["city"], 4, 14, 15),
      place("provinces", ["state", "province"], 4, 9, 15),
      place("countries", ["country"], 0, 6, 15),
    ],
  };
}

// Only IDs enter the worker. Private captions, photos and participant details
// remain in the authenticated page and are never sent to the tile provider.
export function footprintFeatures(points: PhotoPoint[]): FeatureCollection<Point> {
  return { type: "FeatureCollection", features: points.map(p => ({ type: "Feature", id: p.id, properties: { id: p.id }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) };
}

export function rangeFeatures(center: Coordinates | null, radius: number): FeatureCollection {
  if (!center) return { type: "FeatureCollection", features: [] };
  const ring = circlePath(center, radius).map(p => [p.lng, p.lat]);
  // Unwrap across the antimeridian instead of drawing a line through Greenwich.
  for (let i = 1; i < ring.length; i++) {
    while (ring[i][0] - ring[i - 1][0] > 180) ring[i][0] -= 360;
    while (ring[i][0] - ring[i - 1][0] < -180) ring[i][0] += 360;
  }
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } },
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.lng, center.lat] } },
  ] };
}

export function mapScaleName(zoom: number) {
  return zoom < 3 ? "地球" : zoom < 7 ? "国家 / 省域" : zoom < 11 ? "城市" : zoom < 14 ? "区县" : "街道";
}

// Deterministic, ephemeral points for the prototype's load test. Never persisted.
export function sampleFootprints(count: number): PhotoPoint[] {
  let seed = 2401;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cities = [[121.49, 31.24], [116.4, 39.9], [120.15, 30.27], [103.8, 36.05], [139.7, 35.7], [2.35, 48.85], [-74, 40.7], [151.2, -33.9]];
  return Array.from({ length: count }, (_, i) => {
    const [lng, lat] = cities[i % cities.length];
    const spread = i % 3 === 0 ? .03 : i % 3 === 1 ? .5 : 8;
    return { id: `sample-${i}`, lng: lng + (random() - .5) * spread, lat: lat + (random() - .5) * spread, assetId: "", takenOn: null, place: "模拟足迹", tripId: null, participants: [] };
  });
}
