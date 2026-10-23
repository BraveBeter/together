import type { Feature, FeatureCollection } from "geojson";
import type { Coordinates, PhotoPoint } from "./photo-types";
import { distanceKm } from "./photo-domain";

export type ScreenPoint = { x: number; y: number };
export type ScreenProjection = {
  project(point: Coordinates): ScreenPoint;
  unproject(point: ScreenPoint): Coordinates;
};
export const PHOTO_CIRCLE_RADIUS = 44;

// Test actual photo locations, not cluster centres or the corners of the query
// box. Tiles can return the same ID twice; distinct photos at one location stay.
export function photosInScreenCircle(points: PhotoPoint[], center: ScreenPoint, radius: number, projection: ScreenProjection) {
  const seen = new Set<string>(), positions = new Map<string, boolean>();
  return points.filter(point => {
    if (seen.has(point.id)) return false;
    seen.add(point.id);
    const key = `${point.lng},${point.lat}`;
    if (!positions.has(key)) {
      const pixel = projection.project(point);
      const inCircle = Number.isFinite(pixel.x) && Number.isFinite(pixel.y) && (pixel.x - center.x) ** 2 + (pixel.y - center.y) ** 2 <= radius ** 2 + 1e-8;
      // Projection alone can place the far side of a globe over its near side.
      positions.set(key, inCircle && distanceKm(point, projection.unproject(pixel)) < .1);
    }
    return positions.get(key)!;
  });
}

// Preserve the clicked footprint geographically as the camera moves. Near the
// globe's limb only draw valid arcs; never connect an off-globe point across it.
export function screenCircleOutline(center: ScreenPoint, radius: number, projection: ScreenProjection): FeatureCollection {
  const segments: number[][][] = [[]];
  let complete = true;
  for (let i = 0; i <= 72; i++) {
    const angle = i / 72 * Math.PI * 2;
    const pixel = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    const point = projection.unproject(pixel), projected = projection.project(point);
    if (!Number.isFinite(point.lng + point.lat) || Math.hypot(projected.x - pixel.x, projected.y - pixel.y) > 1) {
      complete = false;
      if (segments.at(-1)!.length) segments.push([]);
      continue;
    }
    const segment = segments.at(-1)!, previous = segment.at(-1);
    let lng = point.lng;
    if (previous) lng += 360 * Math.round((previous[0] - lng) / 360);
    segment.push([lng, point.lat]);
  }
  const features: Feature[] = segments.filter(segment => segment.length > 1).map(coordinates => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }));
  if (complete && segments[0].length === 73) {
    segments[0][72] = [...segments[0][0]];
    features.unshift({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [segments[0]] } });
  }
  return { type: "FeatureCollection", features };
}
