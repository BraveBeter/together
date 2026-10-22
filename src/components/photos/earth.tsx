"use client";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { GlobeMethods } from "react-globe.gl";
import { Crosshair, Map, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { circlePath, clusterPhotoPoints, type PhotoCluster } from "@/lib/photo-domain";
import { DEFAULT_GLOBE_VIEW, streetViewFromGlobe, type GlobeView, type StreetView } from "@/lib/map-view";
import type { Coordinates, PhotoPoint } from "@/lib/photo-types";
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false, loading: () => <div className="earth-placeholder">正在展开地球…</div> });
const StreetMap = dynamic(() => import("./street-map"), { ssr: false, loading: () => <div className="earth-placeholder">正在展开详细地图…</div> });
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="earth-fallback">这台设备暂时无法显示 3D 地球。可以打开右上方的详细地图，或通过下方地点列表浏览照片。</div> : this.props.children; }
}
type Props = { points: PhotoPoint[]; center: Coordinates | null; radius?: number; picking?: boolean; compact?: boolean; onPick: (point: Coordinates) => void; onSelect?: (cluster: PhotoCluster) => void };
export function Earth(props: Props) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(700);
  const globeView = useRef<GlobeView>(props.center ? { ...props.center, altitude: props.compact ? .8 : Math.max(.01, Math.min(2, (props.radius ?? 20) / 1200)) } : DEFAULT_GLOBE_VIEW);
  const [mapView, setMapView] = useState<StreetView | null>(null), latestMapView = useRef<StreetView | null>(null);
  const height = props.compact ? 320 : width < 600 ? 430 : 650;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const openMap = (view = globeView.current) => {
    const next = streetViewFromGlobe(view, height); latestMapView.current = next; setMapView(next);
  };
  const returnToGlobe = () => {
    const view = latestMapView.current;
    if (view) globeView.current = { lat: view.lat, lng: view.lng, altitude: 1.4 };
    setMapView(null);
  };
  return <div ref={host} className="earth-view" style={{ "--map-height": `${height}px`, minHeight: height } as CSSProperties}>
    {mapView ? <StreetMap {...props} radius={props.radius ?? 20} picking={props.picking ?? false} compact={props.compact ?? false} initialView={mapView} onView={view => { latestMapView.current = view; }} onGlobe={returnToGlobe} /> : <>
      <GlobeBoundary><EarthCanvas {...props} initialView={globeView.current} onView={view => { globeView.current = view; }} onStreet={openMap} /></GlobeBoundary>
      <div className="map-mode-switch"><button type="button" onClick={() => openMap()}><Map size={15} />详细地图</button></div>
    </>}
  </div>;
}
function EarthCanvas({ points, center, radius = 20, picking = false, compact = false, onPick, onSelect, initialView, onView, onStreet }: Props & { initialView: GlobeView; onView: (view: GlobeView) => void; onStreet: (view: GlobeView) => void }) {
  const host = useRef<HTMLDivElement>(null), globe = useRef<GlobeMethods | undefined>(undefined);
  const [width, setWidth] = useState(700), [ready, setReady] = useState(false), [supported, setSupported] = useState<boolean | null>(null);
  const [altitude, setAltitude] = useState(2.2), [rotate, setRotate] = useState(false), [reduced, setReduced] = useState(false);
  const latest = useRef({ onSelect, onPick, picking }); latest.current = { onSelect, onPick, picking };
  const focusedCenter = useRef(center);
  useEffect(() => {
    const canvas = document.createElement("canvas"), gl = canvas.getContext("webgl2"); setSupported(!!gl); gl?.getExtension("WEBGL_lose_context")?.loseContext();
    const media = matchMedia("(prefers-reduced-motion: reduce)"); const sync = () => setReduced(media.matches); sync(); media.addEventListener("change", sync);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width)))); if (host.current) observer.observe(host.current);
    return () => { observer.disconnect(); media.removeEventListener("change", sync); };
  }, []);
  useEffect(() => {
    if (!ready || !globe.current) return;
    const controls = globe.current.controls(); controls.autoRotate = rotate && !reduced && !picking; controls.autoRotateSpeed = .28; controls.enablePan = false; controls.minDistance = 100.1; controls.maxDistance = 500;
    const sync = () => document.visibilityState === "visible" ? globe.current?.resumeAnimation() : globe.current?.pauseAnimation();
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && document.visibilityState === "visible" ? globe.current?.resumeAnimation() : globe.current?.pauseAnimation());
    if (host.current) observer.observe(host.current); document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, [ready, rotate, reduced, picking]);
  useEffect(() => {
    if (!ready) return;
    if (center && (center.lat !== focusedCenter.current?.lat || center.lng !== focusedCenter.current?.lng)) {
      setRotate(false); globe.current?.pointOfView({ ...center, altitude: compact ? .8 : Math.max(.01, Math.min(2, radius / 1200)) }, reduced ? 0 : 600);
    }
    focusedCenter.current = center;
  }, [center?.lat, center?.lng, ready]); // Radius changes the ring without moving the camera under a drag.
  const clusters = useMemo(() => clusterPhotoPoints(points, Math.max(.001, altitude * 5)), [points, altitude]);
  const ring = useMemo(() => center && !compact ? [{ coordinates: circlePath(center, radius) }] : [], [center?.lat, center?.lng, radius, compact]);
  const marker = useCallback((obj: object) => {
    const c = obj as PhotoCluster, button = document.createElement("button");
    button.className = `earth-marker ${c.count > 1 ? "cluster" : ""}`; button.textContent = c.count > 1 ? String(c.count) : "";
    button.setAttribute("aria-label", `查看${c.points[0].place || "此处"}的 ${c.count} 张照片`);
    button.title = `${c.points[0].place || "留下足迹的地方"} · ${c.count} 张照片`;
    // The globe raycaster listens to pointerup, before the button click. Keep a
    // marker selection from also selecting the surface behind the raised marker.
    button.onpointerdown = event => event.stopPropagation();
    button.onpointerup = event => event.stopPropagation();
    button.onclick = event => { event.stopPropagation(); setRotate(false); if (latest.current.picking) latest.current.onPick({ lat: c.lat, lng: c.lng }); else latest.current.onSelect?.(c); };
    return button;
  }, []);
  const zoom = (factor: number) => { const pov = globe.current?.pointOfView(); if (pov) globe.current?.pointOfView({ altitude: Math.min(3.5, Math.max(.005, pov.altitude * factor)) }, reduced ? 0 : 250); };
  const reset = () => { setRotate(false); globe.current?.pointOfView({ lat: 30, lng: 105, altitude: 2.2 }, reduced ? 0 : 500); };
  return <div ref={host} className={`earth-stage ${compact ? "compact" : ""} ${picking ? "picking" : ""}`} style={{ minHeight: compact ? 320 : width < 600 ? 430 : 650 }}>
    {supported === false ? <div className="earth-fallback">此设备不支持 3D 地球。你仍可打开右上方的详细地图，或通过地点列表浏览照片。</div> : supported === null ? <div className="earth-placeholder">正在展开地球…</div> : <div className="earth-canvas" tabIndex={0} role="region" aria-label="互动地球：方向键旋转，加减键缩放" onPointerDown={() => setRotate(false)} onKeyDown={e => {
      const pov = globe.current?.pointOfView(); if (!pov || e.target !== e.currentTarget) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(e.key)) { e.preventDefault(); setRotate(false); }
      if (e.key === "+") zoom(.65); else if (e.key === "-") zoom(1.5);
      else if (e.key.startsWith("Arrow")) globe.current?.pointOfView({ lat: Math.max(-89, Math.min(89, pov.lat + (e.key === "ArrowUp" ? 8 : e.key === "ArrowDown" ? -8 : 0))), lng: pov.lng + (e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0) }, reduced ? 0 : 200);
    }}>
      <Globe ref={globe} width={width} height={compact ? 320 : width < 600 ? 430 : 650} backgroundColor="rgba(0,0,0,0)" globeImageUrl="/textures/earth-day.jpg"
        atmosphereColor="#647b92" atmosphereAltitude={.12} showGraticules={false}
        htmlElementsData={clusters} htmlElement={marker} htmlAltitude={.008}
        htmlElementVisibilityModifier={(el, visible) => { el.style.visibility = visible ? "visible" : "hidden"; el.style.pointerEvents = visible ? "auto" : "none"; el.tabIndex = visible ? 0 : -1; }}
        pathsData={ring} pathPoints="coordinates" pathPointLat="lat" pathPointLng="lng" pathPointAlt={.006} pathColor={() => "#edc6a0"} pathStroke={1.7} pathTransitionDuration={0}
        pointsData={center ? [center] : []} pointColor={() => "#f7d7b6"} pointRadius={Math.max(.015, altitude * .15)} pointAltitude={.008} pointsTransitionDuration={0}
        onGlobeReady={() => { setReady(true); globe.current?.pointOfView(initialView, 0); globe.current?.renderer().setPixelRatio(Math.min(devicePixelRatio, 1.6)); if (initialView.altitude <= .18) onStreet(initialView); }}
        onGlobeClick={(coords, event) => { if (picking && !(event.target instanceof Element && event.target.closest(".earth-marker"))) onPick(coords); }}
        onZoom={pov => { setAltitude(pov.altitude); onView(pov); if (ready && pov.altitude <= .18) onStreet(pov); }} />
    </div>}
    {!compact && <div className="earth-caption"><span className="earth-caption-line" /><span>{picking ? "轻点地球，选一个圆心" : "每一束微光，都有一段故事"}</span></div>}
    {supported && <div className="earth-controls"><button className="icon-button" aria-label="放大地球" onClick={() => zoom(.6)}><Plus size={17} /></button><button className="icon-button" aria-label="缩小地球" onClick={() => zoom(1.6)}><Minus size={17} /></button><button className="icon-button" aria-label="地球复位" onClick={reset}><RotateCcw size={16} /></button><button className="icon-button" aria-label={rotate ? "暂停旋转" : "开始旋转"} disabled={reduced || picking} onClick={() => setRotate(v => !v)}>{rotate ? <Pause size={16} /> : <Play size={16} />}</button></div>}
    {picking && <div className="earth-pick-label"><Crosshair size={14} />选点模式</div>}
    <a className="earth-credit" href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/" target="_blank" rel="noreferrer">地球影像：NASA Earth Observatory</a>
  </div>;
}
