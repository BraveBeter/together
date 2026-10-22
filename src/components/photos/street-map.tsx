"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./street-map.css";
import { Crosshair, Globe2, Minus, Plus, RotateCcw } from "lucide-react";
import { clusterPhotoPoints, type PhotoCluster } from "@/lib/photo-domain";
import { streetClusterDegrees, streetCoordinates, streetLevelLabel, type StreetView } from "@/lib/map-view";
import type { Coordinates, PhotoPoint } from "@/lib/photo-types";

type Props = {
  points: PhotoPoint[]; center: Coordinates | null; radius: number; picking: boolean; compact: boolean;
  initialView: StreetView; onView: (view: StreetView) => void; onGlobe: () => void;
  onPick: (point: Coordinates) => void; onSelect?: (cluster: PhotoCluster) => void;
};

export default function StreetMap(props: Props) {
  const host = useRef<HTMLDivElement>(null), mapRef = useRef<L.Map | null>(null), tilesRef = useRef<L.TileLayer | null>(null);
  const latest = useRef(props); latest.current = props;
  const [ready, setReady] = useState(false), [viewport, setViewport] = useState(props.initialView);
  const [tileError, setTileError] = useState(false), [loading, setLoading] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(media.matches); syncMotion(); media.addEventListener("change", syncMotion);
    const initial = latest.current.initialView;
    const map = L.map(host.current, {
      center: [initial.lat, initial.lng], zoom: initial.zoom, minZoom: 3, maxZoom: 19,
      zoomControl: false, attributionControl: false, zoomAnimation: false, fadeAnimation: false,
      markerZoomAnimation: false, inertia: !media.matches, maxBounds: [[-85.0511, -180], [85.0511, 180]], maxBoundsViscosity: 1,
    });
    mapRef.current = map;
    L.control.attribution({ prefix: false, position: "bottomright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft", maxWidth: 100 }).addTo(map);
    // Request only visible tiles and retain ordinary browser caching / Referer.
    // Photo assets, place-search credentials and private metadata never enter tile URLs.
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, noWrap: true, updateWhenIdle: true, keepBuffer: 0,
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    });
    tilesRef.current = tiles;
    let failures = 0;
    tiles.on("loading", () => { failures = 0; setLoading(true); });
    tiles.on("tileerror", () => { failures++; setTileError(true); });
    tiles.on("load", () => { setLoading(false); setTileError(failures > 0); });
    tiles.addTo(map);
    const syncView = () => {
      const point = streetCoordinates(map.getCenter()), view = { ...point, zoom: map.getZoom() };
      setViewport(view); latest.current.onView(view);
    };
    map.on("moveend zoomend", syncView);
    map.on("click", (event: L.LeafletMouseEvent) => {
      if (latest.current.picking) latest.current.onPick(streetCoordinates(event.latlng));
    });
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: true }));
    observer.observe(host.current); setReady(true); syncView();
    return () => {
      observer.disconnect(); media.removeEventListener("change", syncMotion);
      tiles.off(); map.off(); map.remove(); mapRef.current = null; tilesRef.current = null;
    };
  }, []);

  useEffect(() => { if (mapRef.current) mapRef.current.options.inertia = !reduced; }, [reduced]);

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const layer = L.layerGroup().addTo(map), bounds = map.getBounds().pad(.15);
    const clusters = clusterPhotoPoints(props.points, streetClusterDegrees(viewport.zoom, viewport.lat));
    for (const cluster of clusters) {
      if (!bounds.contains([cluster.lat, cluster.lng])) continue;
      const button = document.createElement("button");
      button.type = "button"; button.className = `earth-marker ${cluster.count > 1 ? "cluster" : ""}`;
      button.textContent = cluster.count > 1 ? String(cluster.count) : "";
      button.setAttribute("aria-label", `查看${cluster.points[0].place || "此处"}的 ${cluster.count} 张照片`);
      button.title = `${cluster.points[0].place || "留下足迹的地方"} · ${cluster.count} 张照片`;
      L.DomEvent.disableClickPropagation(button);
      button.onclick = event => {
        event.stopPropagation();
        if (latest.current.picking) latest.current.onPick({ lat: cluster.lat, lng: cluster.lng });
        else latest.current.onSelect?.(cluster);
      };
      L.marker([cluster.lat, cluster.lng], {
        icon: L.divIcon({ html: button, className: "street-photo-icon", iconSize: [40, 40], iconAnchor: [20, 20] }),
        keyboard: false, bubblingMouseEvents: false,
      }).addTo(layer);
    }
    return () => { layer.remove(); };
  }, [ready, props.points, viewport]);

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map || !props.center) return;
    const center = props.center, layer = L.layerGroup().addTo(map);
    if (!props.compact) L.circle([center.lat, center.lng], {
      radius: props.radius * 1000, color: "#eac7a1", weight: 2, fillColor: "#eac7a1", fillOpacity: .08, interactive: false,
      className: "street-range-circle",
    }).addTo(layer);
    L.circleMarker([center.lat, center.lng], { radius: 5, color: "#fff1db", weight: 2, fillColor: "#b58d61", fillOpacity: 1, interactive: false }).addTo(layer);
    return () => { layer.remove(); };
  }, [ready, props.center?.lat, props.center?.lng, props.radius, props.compact]);

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map || !props.center) return;
    const center = streetCoordinates(props.center);
    // A radius edit or a click within the viewport must not reset the user's zoom.
    if (!map.getBounds().pad(-.1).contains([center.lat, center.lng])) map.panTo([center.lat, center.lng], { animate: !reduced });
  }, [ready, props.center?.lat, props.center?.lng, reduced]);

  const zoom = (delta: number) => {
    const map = mapRef.current; if (!map) return;
    if (delta < 0 && map.getZoom() === 3) props.onGlobe();
    else map.setZoom(map.getZoom() + delta, { animate: false });
  };
  return <div className={`street-map-stage ${props.compact ? "compact" : ""} ${props.picking ? "picking" : ""}`}>
    <div ref={host} className="street-map" role="region" aria-label="详细地图：方向键平移，加减键缩放" data-zoom={viewport.zoom} />
    <div className="map-mode-switch"><button type="button" onClick={props.onGlobe}><Globe2 size={15} />返回地球</button></div>
    {props.picking && <div className="earth-pick-label"><Crosshair size={14} />轻点地图选位置</div>}
    <div className="street-map-status" role="status">{loading ? "正在加载地图…" : streetLevelLabel(viewport.zoom)}<span> · {viewport.zoom} 级</span></div>
    <div className="earth-controls">
      <button type="button" className="icon-button" aria-label="放大地图" disabled={viewport.zoom >= 19} onClick={() => zoom(1)}><Plus size={17} /></button>
      <button type="button" className="icon-button" aria-label="缩小地图" onClick={() => zoom(-1)}><Minus size={17} /></button>
      <button type="button" className="icon-button" aria-label="地图复位" onClick={() => { const v = props.initialView; mapRef.current?.setView([v.lat, v.lng], v.zoom, { animate: false }); }}><RotateCcw size={16} /></button>
    </div>
    {tileError && <div className="street-map-error" role="status">部分地图未能加载，照片与圈选仍可使用。<button type="button" onClick={() => { setTileError(false); tilesRef.current?.redraw(); }}>重试</button></div>}
  </div>;
}
