"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, LngLat, Map as VectorMap, NavigationControl, Popup, ScaleControl, setWorkerCount, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import { Compass, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import type { Coordinates, PhotoPoint } from "@/lib/photo-types";
import type { PhotoCluster } from "@/lib/photo-domain";
import { continuousMapStyle, footprintFeatures, footprintLayers, mapScaleName, rangeFeatures, sampleFootprints } from "@/lib/continuous-map";
import { setMapActive } from "@/lib/map-activity";
import "maplibre-gl/dist/maplibre-gl.css";
import "./continuous-map.css";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
setWorkerCount(2);

type Props = { points: PhotoPoint[]; center: Coordinates | null; radius?: number; picking?: boolean; onPick(point: Coordinates): void; onSelect?(cluster: PhotoCluster): void };
type Metrics = { fps: number; p95: number; frames: number };
const SHANGHAI: [number, number] = [121.49, 31.24];
const pointLayers = ["photo-clusters", "photo-points"];

export function ContinuousMap(props: Props) {
  const host = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), mapRef = useRef<VectorMap | null>(null);
  const latest = useRef(props); latest.current = props;
  const [attempt, setAttempt] = useState(0), [ready, setReady] = useState(false), [error, setError] = useState("");
  const [zoom, setZoom] = useState(.25), [loading, setLoading] = useState(true), [large, setLarge] = useState(false);
  const [position, setPosition] = useState<[number, number]>(SHANGHAI);
  const [sampleCount, setSampleCount] = useState(0), [metrics, setMetrics] = useState<Metrics | null>(null), [selectionMessage, setSelectionMessage] = useState("");
  const samples = useMemo(() => sampleFootprints(sampleCount), [sampleCount]);
  const shownPoints = sampleCount ? samples : props.points;
  const pointIndex = useMemo(() => new Map(shownPoints.map(p => [p.id, p])), [shownPoints]);
  const mapData = useMemo(() => ({ shownPoints, pointIndex, sampleCount }), [shownPoints, pointIndex, sampleCount]);
  const currentData = useRef(mapData); currentData.current = mapData;

  useEffect(() => {
    if (!host.current) return;
    let alive = true, engine: VectorMap;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let motionFrame = 0, lastFrame = 0;
    const frameTimes: number[] = [];
    let selectionRequest = 0;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const owner = {};
    setReady(false); setError(""); setLoading(true);

    try {
      engine = new VectorMap({
        container: host.current, style: continuousMapStyle(),
        center: latest.current.center ? [latest.current.center.lng, latest.current.center.lat] : SHANGHAI,
        zoom: latest.current.center ? 10 : .25, minZoom: -.5, maxZoom: 19, maxPitch: 0,
        // A flight starting in Mercator otherwise constrains its future globe
        // destination against the flat viewport and moves it to the equator.
        // Use the same geographic limits on both sides of the transition.
        transformConstrain: (at, level) => ({ center: new LngLat(at.lng, Math.max(-85.051129, Math.min(85.051129, at.lat))), zoom: Math.max(-.5, Math.min(19, level)) }),
        // Full 2x text on Retina screens, without 3x/4x full-canvas fill cost.
        pixelRatio: Math.min(devicePixelRatio || 1, 2), maxTileCacheSize: 160,
        localIdeographFontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        attributionControl: false, dragRotate: false, pitchWithRotate: false,
        fadeDuration: motion.matches ? 0 : 160,
        cancelPendingTileRequestsWhileZooming: true,
        locale: { "NavigationControl.ZoomIn": "放大地图", "NavigationControl.ZoomOut": "缩小地图", "NavigationControl.ResetBearing": "朝向正北", "AttributionControl.ToggleAttribution": "地图来源" },
      });
    } catch {
      setError("地图未能启动。请开启浏览器图形加速后重试，或返回现有地图。");
      setLoading(false); return;
    }
    mapRef.current = engine;
    const canvas = engine.getCanvas();
    canvas.setAttribute("aria-label", "连续足迹地图：拖动移动，滚轮或双指缩放；方向键移动，加减键缩放");
    engine.addControl(new NavigationControl({ showCompass: false }), "top-right");
    engine.addControl(new ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");
    engine.addControl(new AttributionControl({ compact: true }), "bottom-right");
    const tooltip = new Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "photo-dot-tooltip", maxWidth: "220px" });
    let hoveredId: string | number | undefined;
    const clearHover = () => {
      if (hoveredId !== undefined && engine.getSource("footprints")) engine.removeFeatureState({ source: "footprints", id: hoveredId }, "hover");
      hoveredId = undefined; tooltip.remove();
    };
    const hitAt = (event: MapMouseEvent) => {
      // Small visual marks still have a comfortable touch/click target.
      const pad = matchMedia("(pointer: coarse)").matches ? 16 : 10;
      return engine.queryRenderedFeatures([[event.point.x - pad, event.point.y - pad], [event.point.x + pad, event.point.y + pad]], { layers: pointLayers })
        .filter(hit => hit.geometry.type === "Point")
        .sort((a, b) => {
          const distance = (hit: typeof a) => {
            const at = engine.project((hit.geometry as GeoJSON.Point).coordinates as [number, number]);
            return Math.hypot(at.x - event.point.x, at.y - event.point.y);
          };
          return distance(a) - distance(b);
        })[0];
    };

    const markMoving = () => {
      clearHover();
      wrapper.current?.setAttribute("data-moving", "true");
      setMapActive(owner, true);
      frameTimes.length = 0; lastFrame = 0;
    };
    const recordFrame = () => {
      if (!engine.isMoving()) return;
      const now = performance.now();
      if (lastFrame) frameTimes.push(now - lastFrame);
      lastFrame = now;
    };
    const markStopped = () => {
      wrapper.current?.setAttribute("data-moving", "false");
      setMapActive(owner, false);
      if (!alive) return;
      setZoom(engine.getZoom());
      const center = engine.getCenter(); setPosition([center.lng, center.lat]);
      if (frameTimes.length >= 10) {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        setMetrics({ fps: Math.round(1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length)), p95: Math.round(sorted[Math.floor(sorted.length * .95)]), frames: frameTimes.length });
      }
    };
    const loadingStarted = () => {
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => { pendingTimer = undefined; if (alive && !engine.areTilesLoaded()) setLoading(true); }, 400);
    };
    const loaded = () => {
      clearTimeout(pendingTimer); pendingTimer = undefined;
      clearTimeout(slowTimer);
      if (alive) setLoading(false);
    };
    const failed = () => {
      if (alive) { setError("部分地图细节暂未加载，可继续缩放或重试。底图首次打开需要网络。"); setLoading(false); }
    };
    engine.on("movestart", markMoving);
    engine.on("moveend", markStopped);
    engine.on("render", recordFrame);
    engine.on("dataloading", loadingStarted);
    engine.on("sourcedataloading", event => { if (event.sourceId === "footprints") clearHover(); });
    engine.on("idle", loaded);
    engine.on("error", failed);
    slowTimer = setTimeout(() => { if (alive && !engine.areTilesLoaded()) failed(); }, 15000);

    engine.on("style.load", () => {
      if (!alive || engine.getSource("footprints")) return;
      engine.addSource("footprints", { type: "geojson", data: footprintFeatures(currentData.current.shownPoints), cluster: true, clusterMaxZoom: 17, clusterRadius: 20, maxzoom: 18 });
      for (const layer of footprintLayers()) engine.addLayer(layer);
      engine.addSource("photo-range", { type: "geojson", data: rangeFeatures(latest.current.center, latest.current.radius ?? 20) });
      engine.addLayer({ id: "range-outline", type: "line", source: "photo-range", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#90bdce", "line-width": 1.5, "line-opacity": .9 } });
      engine.addLayer({ id: "range-center", type: "circle", source: "photo-range", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#132933", "circle-radius": 3, "circle-stroke-color": "#b2d4df", "circle-stroke-width": 1.2 } });
      setReady(true);
    });

    const handleClick = async (event: MapMouseEvent) => {
      if (!engine.getLayer("photo-points")) return;
      if (latest.current.picking) {
        const projected = engine.project(event.lngLat);
        if (Math.hypot(projected.x - event.point.x, projected.y - event.point.y) > 3) return;
        latest.current.onPick({ lat: event.lngLat.lat, lng: event.lngLat.wrap().lng }); return;
      }
      const hit = hitAt(event);
      if (!hit || hit.geometry.type !== "Point") return;
      clearHover();
      const at = hit.geometry.coordinates as [number, number];
      const request = ++selectionRequest;
      const dataAtClick = currentData.current;
      try {
        const source = engine.getSource<GeoJSONSource>("footprints")!;
        if (hit.properties.cluster) {
          const level = await source.getClusterExpansionZoom(hit.properties.cluster_id);
          if (!alive || request !== selectionRequest || dataAtClick !== currentData.current) return;
          engine.easeTo({ center: at, zoom: Math.min(19, Math.max(engine.getZoom() + 1, level)), duration: motion.matches ? 0 : 650 });
          // The existing paginated photo endpoint accepts at most 10,000 IDs.
          // Identical coordinates can still be opened at maximum street zoom.
          const leaves = await source.getClusterLeaves(hit.properties.cluster_id, 10000, 0);
          if (!alive || request !== selectionRequest || dataAtClick !== currentData.current) return;
          const selected = leaves.flatMap(f => { const p = dataAtClick.pointIndex.get(String(f.properties?.id)); return p ? [p] : []; });
          if (dataAtClick.sampleCount) setSelectionMessage(`这组有 ${hit.properties.point_count} 个模拟点，不会写入收藏。`);
          else if (selected.length) latest.current.onSelect?.({ id: `vector-${hit.properties.cluster_id}`, lat: at[1], lng: at[0], points: selected, count: selected.length });
        } else {
          const p = dataAtClick.pointIndex.get(String(hit.properties.id));
          if (!p) return;
          if (dataAtClick.sampleCount) setSelectionMessage("这是流畅度测试用的模拟点，不会写入收藏。");
          else latest.current.onSelect?.({ id: p.id, lat: p.lat, lng: p.lng, points: [p], count: 1 });
        }
      } catch { if (alive) setSelectionMessage("这组足迹正在更新，请再点一次。"); }
    };
    engine.on("click", handleClick);
    const cursor = (event: MapMouseEvent) => {
      if (!engine.getLayer("photo-points") || engine.isMoving()) return;
      const hit = latest.current.picking ? undefined : hitAt(event);
      canvas.style.cursor = latest.current.picking ? "crosshair" : hit ? "pointer" : "";
      if (hit?.id === hoveredId) return;
      clearHover();
      if (!hit || hit.id === undefined || hit.geometry.type !== "Point") return;
      hoveredId = hit.id;
      engine.setFeatureState({ source: "footprints", id: hit.id }, { hover: true });
      const photo = currentData.current.pointIndex.get(String(hit.properties.id));
      const label = currentData.current.sampleCount ? "模拟足迹" : hit.properties.cluster ? `${hit.properties.point_count} 张照片` : photo?.place || "旅途照片";
      tooltip.setLngLat(hit.geometry.coordinates as [number, number]).setText(`${label}\n${hit.properties.cluster ? "点击展开这一片足迹" : "点击查看照片"}`).addTo(engine);
    };
    engine.on("mousemove", cursor);
    canvas.addEventListener("mouseleave", clearHover);
    const pickWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Enter" && latest.current.picking) {
        const at = engine.getCenter().wrap();
        latest.current.onPick({ lat: at.lat, lng: at.lng });
        event.preventDefault();
      }
    };
    canvas.addEventListener("keydown", pickWithKeyboard);
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(motionFrame);
      motionFrame = requestAnimationFrame(() => { if (alive) engine.resize(); });
    });
    resize.observe(host.current);
    const visibility = () => { if (document.hidden) { engine.stop(); setMapActive(owner, false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false; selectionRequest++;
      resize.disconnect(); cancelAnimationFrame(motionFrame);
      clearTimeout(pendingTimer); clearTimeout(slowTimer);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("keydown", pickWithKeyboard);
      canvas.removeEventListener("mouseleave", clearHover);
      tooltip.remove();
      engine.remove(); mapRef.current = null; setMapActive(owner, false);
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) map.getSource<GeoJSONSource>("footprints")?.setData(footprintFeatures(shownPoints));
    setSelectionMessage("");
  }, [shownPoints, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource<GeoJSONSource>("photo-range")?.setData(rangeFeatures(props.center, props.radius ?? 20));
  }, [props.center?.lat, props.center?.lng, props.radius, ready]);
  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = props.picking ? "crosshair" : ""; }, [props.picking]);
  useEffect(() => {
    if (!large) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLarge(false); return; }
      if (e.key !== "Tab" || !wrapper.current) return;
      const controls = Array.from(wrapper.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, select, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || !wrapper.current.contains(document.activeElement))) { last?.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first?.focus(); e.preventDefault(); }
    };
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); previousFocus?.focus(); };
  }, [large]);

  function go(level: number, at?: [number, number]) {
    const map = mapRef.current; if (!map) return;
    map.flyTo({ center: at ?? map.getCenter(), zoom: level, bearing: 0, pitch: 0, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800 });
  }
  return <div ref={wrapper} className={`continuous-map ${large ? "map-expanded" : ""}`} role={large ? "dialog" : undefined} aria-modal={large || undefined} aria-label={large ? "展开的足迹地图" : undefined} data-ready={ready} data-moving="false" data-zoom={zoom.toFixed(2)} data-center={position.join(",")}>
    <div className="continuous-map-stage" ref={host} />
    <div className="map-flight-bar" aria-label="缩放到不同尺度">
      {[{ label: "地球", zoom: .25 }, { label: "省域", zoom: 6 }, { label: "城市", zoom: 10 }, { label: "街道", zoom: 16.4 }].map(item => <button key={item.label} disabled={!ready} onClick={() => go(item.zoom)}>{item.label}</button>)}
    </div>
    <div className="map-secondary-controls">
      <button title="定位上海，体验街道细节" aria-label="定位上海，体验街道细节" disabled={!ready} onClick={() => go(15.5, SHANGHAI)}><Compass size={18} /></button>
      <button title={large ? "退出大图" : "展开大图"} aria-label={large ? "退出大图" : "展开大图"} onClick={() => setLarge(v => !v)}>{large ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
    </div>
    <div className="map-scale-label" aria-live="polite">{mapScaleName(zoom)}{loading && !error && <span> · 细节加载中</span>}</div>
    {props.picking && <div className="map-pick-prompt">点击选择范围中心；地图聚焦后可按回车选中心</div>}
    {error && <div className="map-load-error" role="alert"><span>{error}</span><button onClick={() => setAttempt(v => v + 1)}><RotateCcw size={14} />重试地图</button></div>}
    <details className="map-prototype-checks"><summary>体验选项</summary><div>
      <label>地图上的点<select aria-label="流畅度测试点数" value={sampleCount} onChange={e => setSampleCount(Number(e.target.value))}><option value={0}>我的照片 · {props.points.length} 个点</option><option value={2000}>2,000 个模拟点</option><option value={10000}>10,000 个模拟点</option></select></label>
      <p>{sampleCount ? "模拟点只在此页面显示，不保存，也不加载照片。" : "点击圆点查看照片；聚合的足迹会随缩放展开。"}</p>
      <output aria-label="地图性能测量">{metrics ? `最近操作 ${metrics.fps} 帧/秒 · 95% 帧间隔 ≤ ${metrics.p95}ms` : "拖动或缩放后显示本次渲染帧率"}</output>
      <small>当前设备的渲染事件采样，网络加载另计。</small>
      <small>中心 {position[1].toFixed(4)}°, {position[0].toFixed(4)}° · 缩放 {zoom.toFixed(1)}</small>
      {selectionMessage && <p role="status">{selectionMessage}</p>}
    </div></details>
  </div>;
}
