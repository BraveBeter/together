import type { Coordinates } from "./photo-types";

export type StreetView = Coordinates & { zoom: number };
export type GlobeView = Coordinates & { altitude: number };
export const DEFAULT_GLOBE_VIEW: GlobeView = { lat: 30, lng: 105, altitude: 2.2 };

// Street tiles use Web Mercator; the globe still covers both poles.
export function streetCoordinates(point: Coordinates): Coordinates {
  return { lat: Math.max(-85.0511, Math.min(85.0511, point.lat)), lng: ((point.lng + 180) % 360 + 360) % 360 - 180 };
}

export function streetViewFromGlobe(view: GlobeView, height: number): StreetView {
  const point = streetCoordinates(view);
  const metresPerPixel = 6371008.8 * Math.max(.001, view.altitude) * 2 * Math.tan(Math.PI / 6) / height;
  const zoom = Math.log2(156543.03392 * Math.cos(point.lat * Math.PI / 180) / metresPerPixel);
  return { ...point, zoom: Math.max(5, Math.min(19, Math.round(zoom))) };
}

export function streetClusterDegrees(zoom: number, latitude: number) {
  // About 42 screen pixels, so nearby photos separate as the map is enlarged.
  return Math.min(30, 360 / 2 ** zoom * (42 / 256) * Math.cos(latitude * Math.PI / 180));
}

export function streetLevelLabel(zoom: number) {
  return zoom < 7 ? "省域" : zoom < 11 ? "城市" : zoom < 14 ? "区县" : "街道";
}
