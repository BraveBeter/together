"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, LngLat, Map as VectorMap, NavigationControl, ScaleControl, setWorkerCount, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { Compass, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import type { Coordinates, PhotoPoint } from "@/lib/photo-types";
import type { PhotoCluster } from "@/lib/photo-domain";
import { continuousMapStyle, footprintFeatures, footprintLayers, mapScaleName, rangeFeatures, sampleFootprints } from "@/lib/continuous-map";
import { setMapActive } from "@/lib/map-activity";
import { PHOTO_CIRCLE_RADIUS, photosInScreenCircle, screenCircleOutline, type ScreenPoint, type ScreenProjection } from "@/lib/map-selection";
import "maplibre-gl/dist/maplibre-gl.css";
import "./continuous-map.css";

setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
setWorkerCount(2);

type Props = { points: PhotoPoint[]; center: Coordinates | null; radius?: number; picking?: boolean; selection?: PhotoCluster | null; onPick(point: Coordinates): void; onSelect?(cluster: PhotoCluster): void; onClearSelection?(): void };
type Metrics = { fps: number; p95: number; frames: number };
type CircleSelection = { id: string; ids: string[]; outline: FeatureCollection; sampleCount: number };
const SHANGHAI: [number, number] = [121.49, 31.24];

export function ContinuousMap(props: Props) {
  const host = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), mapRef = useRef<VectorMap | null>(null);
  const circleCursor = useRef<HTMLDivElement>(null), circleCount = useRef<HTMLSpanElement>(null);
  const latest = useRef(props); latest.current = props;
  const [attempt, setAttempt] = useState(0), [ready, setReady] = useState(false), [error, setError] = useState("");
  const [zoom, setZoom] = useState(.25), [loading, setLoading] = useState(true), [large, setLarge] = useState(false);
  const [position, setPosition] = useState<[number, number]>(SHANGHAI);
  const [sampleCount, setSampleCount] = useState(0), [metrics, setMetrics] = useState<Metrics | null>(null), [selectionMessage, setSelectionMessage] = useState("");
  const [circleSelection, setCircleSelection] = useState<CircleSelection | null>(null);
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
    let selectionNumber = 0;
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
    canvas.setAttribute("aria-label", "连续足迹地图：拖动移动，滚轮或双指缩放；方向键移动，加减键缩放，回车圈选中心附近照片");
    engine.addControl(new NavigationControl({ showCompass: false }), "top-right");
    engine.addControl(new ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");
    engine.addControl(new AttributionControl({ compact: true }), "bottom-right");
    const circleRadius = matchMedia("(pointer: coarse)").matches ? 48 : PHOTO_CIRCLE_RADIUS;
    circleCursor.current?.style.setProperty("--circle-radius", `${circleRadius}px`);
    let hoverTimer: ReturnType<typeof setTimeout> | undefined, pointer: ScreenPoint | null = null;
    const projection: ScreenProjection = {
      project: point => engine.project([point.lng + 360 * Math.round((engine.getCenter().lng - point.lng) / 360), point.lat]),
      unproject: point => engine.unproject([point.x, point.y]).wrap(),
    };
    const onSurface = (point: ScreenPoint) => {
      const projected = projection.project(projection.unproject(point));
      return Math.hypot(projected.x - point.x, projected.y - point.y) <= 1;
    };
    const clearHover = () => {
      clearTimeout(hoverTimer); hoverTimer = undefined; pointer = null;
      if (circleCursor.current) circleCursor.current.hidden = true;
    };
    const photosAt = (point: ScreenPoint) => {
      const pad = circleRadius + 2, data = currentData.current;
      const candidates = engine.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers: ["photo-hit-points"] })
        .flatMap(hit => { const photo = data.pointIndex.get(String(hit.properties.id)); return photo ? [photo] : []; });
      return photosInScreenCircle(candidates, point, circleRadius, projection);
    };
    const showCursor = (point: ScreenPoint) => {
      if (latest.current.picking || engine.isMoving() || !engine.getLayer("photo-hit-points") || !onSurface(point)) { clearHover(); return; }
      pointer = point;
      const circle = circleCursor.current;
      if (circle) { circle.hidden = false; circle.style.transform = `translate3d(${point.x}px,${point.y}px,0)`; }
      // Move the DOM ring immediately; query at most 20 times per second, with
      // no React render, image fetch or full-dataset scan on pointer movement.
      if (!hoverTimer) hoverTimer = setTimeout(() => {
        hoverTimer = undefined;
        if (!alive || !pointer || !circleCount.current) return;
        const count = engine.isSourceLoaded("photo-hit-source") ? photosAt(pointer).length : null;
        circleCount.current.textContent = count === null ? "正在整理足迹…" : `${count} ${currentData.current.sampleCount ? "个模拟点" : "张照片"} · 点击圈选`;
      }, 50);
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
      if (canvas.matches(":focus-visible")) showCursor({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
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
      // MapLibre's transparent circle layer is still queryable. Its spatial
      // index includes every original photo, even inside a visual cluster.
      engine.addSource("photo-hit-source", { type: "geojson", data: footprintFeatures(currentData.current.shownPoints), maxzoom: 18 });
      engine.addLayer({ id: "photo-hit-points", type: "circle", source: "photo-hit-source", paint: { "circle-radius": 1, "circle-opacity": 0 } });
      engine.addSource("photo-circle-selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      engine.addLayer({ id: "photo-circle-fill", type: "fill", source: "photo-circle-selection", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#8ec5db", "fill-opacity": .07 } });
      engine.addLayer({ id: "photo-circle-outline", type: "line", source: "photo-circle-selection", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#91c7df", "line-width": 1.8, "line-opacity": .95 } });
      engine.addLayer({ id: "photo-circle-points", type: "circle", source: "photo-circle-selection", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#c8e3ec", "circle-stroke-color": "#f5faf8", "circle-stroke-width": 1 } });
      engine.addSource("photo-range", { type: "geojson", data: rangeFeatures(latest.current.center, latest.current.radius ?? 20) });
      engine.addLayer({ id: "range-outline", type: "line", source: "photo-range", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#90bdce", "line-width": 1.5, "line-opacity": .9 } });
      engine.addLayer({ id: "range-center", type: "circle", source: "photo-range", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#132933", "circle-radius": 3, "circle-stroke-color": "#b2d4df", "circle-stroke-width": 1.2 } });
      setReady(true);
    });

    const selectAt = (point: ScreenPoint) => {
      if (!onSurface(point) || engine.isMoving()) return;
      if (!engine.getLayer("photo-hit-points") || !engine.isSourceLoaded("photo-hit-source")) { setSelectionMessage("足迹正在更新，请稍后再圈选。"); return; }
      const selected = photosAt(point), data = currentData.current;
      if (selected.length > 10000) { setSelectionMessage("这一圈超过 10,000 张照片，请放大地图后缩小范围。"); return; }
      const at = projection.unproject(point), id = `screen-circle-${++selectionNumber}`;
      setCircleSelection({ id, ids: selected.map(photo => photo.id), outline: screenCircleOutline(point, circleRadius, projection), sampleCount: data.sampleCount });
      clearHover();
      if (data.sampleCount) setSelectionMessage(`圈中了 ${selected.length} 个模拟点，不会保存或生成照片。`);
      else {
        setSelectionMessage(selected.length ? `已圈选 ${selected.length} 张照片` : "这一圈暂无照片，可以换个位置再选。");
        latest.current.onSelect?.({ id, lat: at.lat, lng: at.lng, points: selected, count: selected.length });
        setLarge(false);
      }
    };
    const handleClick = (event: MapMouseEvent) => {
      if (latest.current.picking) {
        if (!onSurface(event.point)) return;
        latest.current.onPick({ lat: event.lngLat.lat, lng: event.lngLat.wrap().lng }); return;
      }
      if (event.originalEvent.detail > 1) return;
      selectAt(event.point);
    };
    engine.on("click", handleClick);
    const cursor = (event: MapMouseEvent) => {
      if (event.originalEvent.buttons) { clearHover(); return; }
      showCursor(event.point);
    };
    engine.on("mousemove", cursor);
    canvas.addEventListener("mouseleave", clearHover);
    const pickWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        if (latest.current.picking) {
          const at = engine.getCenter().wrap();
          latest.current.onPick({ lat: at.lat, lng: at.lng });
        } else selectAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
        event.preventDefault();
      }
      if (event.key === "Escape") { setCircleSelection(null); setSelectionMessage(""); latest.current.onClearSelection?.(); clearHover(); }
    };
    const focus = () => { if (canvas.matches(":focus-visible")) showCursor({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }); };
    canvas.addEventListener("keydown", pickWithKeyboard);
    canvas.addEventListener("focus", focus);
    canvas.addEventListener("blur", clearHover);
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(motionFrame);
      motionFrame = requestAnimationFrame(() => { if (alive) engine.resize(); });
    });
    resize.observe(host.current);
    const visibility = () => { if (document.hidden) { clearHover(); engine.stop(); setMapActive(owner, false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false; clearHover();
      resize.disconnect(); cancelAnimationFrame(motionFrame);
      clearTimeout(pendingTimer); clearTimeout(slowTimer);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("keydown", pickWithKeyboard);
      canvas.removeEventListener("focus", focus);
      canvas.removeEventListener("blur", clearHover);
      canvas.removeEventListener("mouseleave", clearHover);
      engine.remove(); mapRef.current = null; setMapActive(owner, false);
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) {
      const features = footprintFeatures(shownPoints);
      map.getSource<GeoJSONSource>("footprints")?.setData(features);
      map.getSource<GeoJSONSource>("photo-hit-source")?.setData(features);
    }
    setSelectionMessage("");
  }, [shownPoints, ready]);
  useEffect(() => {
    let selected = circleSelection;
    if (selected && (selected.sampleCount !== sampleCount || (!sampleCount && selected.id !== props.selection?.id))) {
      selected = null; setCircleSelection(null); setSelectionMessage("");
    }
    const map = mapRef.current;
    if (!ready || !map) return;
    const selectedPoints = selected?.ids.flatMap(id => { const point = pointIndex.get(id); return point ? [point] : []; }) ?? [];
    map.getSource<GeoJSONSource>("photo-circle-selection")?.setData({ type: "FeatureCollection", features: [...(selected?.outline.features ?? []), ...footprintFeatures(selectedPoints).features] });
  }, [circleSelection, sampleCount, props.selection?.id, ready, pointIndex]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource<GeoJSONSource>("photo-range")?.setData(rangeFeatures(props.center, props.radius ?? 20));
  }, [props.center?.lat, props.center?.lng, props.radius, ready]);
  useEffect(() => {
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = props.picking ? "crosshair" : "";
    if (props.picking && circleCursor.current) circleCursor.current.hidden = true;
  }, [props.picking]);
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
    <div className="map-circle-cursor" ref={circleCursor} hidden aria-hidden="true"><span ref={circleCount}>移动圆圈，点击查看照片</span></div>
    <div className="map-flight-bar" aria-label="缩放到不同尺度">
      {[{ label: "地球", zoom: .25 }, { label: "省域", zoom: 6 }, { label: "城市", zoom: 10 }, { label: "街道", zoom: 16.4 }].map(item => <button key={item.label} disabled={!ready} onClick={() => go(item.zoom)}>{item.label}</button>)}
    </div>
    <div className="map-secondary-controls">
      <button title="定位上海，体验街道细节" aria-label="定位上海，体验街道细节" disabled={!ready} onClick={() => go(15.5, SHANGHAI)}><Compass size={18} /></button>
      <button title={large ? "退出大图" : "展开大图"} aria-label={large ? "退出大图" : "展开大图"} onClick={() => setLarge(v => !v)}>{large ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
    </div>
    <div className="map-scale-label" aria-live="polite">{mapScaleName(zoom)}{loading && !error && <span> · 细节加载中</span>}</div>
    {props.picking && <div className="map-pick-prompt">点击选择范围中心；地图聚焦后可按回车选中心</div>}
    {!props.picking && selectionMessage && <div className="map-selection-status" role="status">{selectionMessage}</div>}
    {error && <div className="map-load-error" role="alert"><span>{error}</span><button onClick={() => setAttempt(v => v + 1)}><RotateCcw size={14} />重试地图</button></div>}
    <details className="map-prototype-checks"><summary>体验选项</summary><div>
      <label>地图上的点<select aria-label="流畅度测试点数" value={sampleCount} onChange={e => setSampleCount(Number(e.target.value))}><option value={0}>我的照片 · {props.points.length} 个点</option><option value={2000}>2,000 个模拟点</option><option value={10000}>10,000 个模拟点</option></select></label>
      <p>{sampleCount ? "模拟点只在此页面显示，不保存，也不加载照片。" : "移动圆圈，点击查看圈内全部照片；缩放地图调整覆盖范围。"}</p>
      <output aria-label="地图性能测量">{metrics ? `最近操作 ${metrics.fps} 帧/秒 · 95% 帧间隔 ≤ ${metrics.p95}ms` : "拖动或缩放后显示本次渲染帧率"}</output>
      <small>当前设备的渲染事件采样，网络加载另计。</small>
      <small>中心 {position[1].toFixed(4)}°, {position[0].toFixed(4)}° · 缩放 {zoom.toFixed(1)}</small>
    </div></details>
  </div>;
}
