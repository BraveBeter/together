"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Check, Clock3, Crosshair, Edit3, Globe2, ImagePlus, MapPin, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { JournalData } from "@/lib/types";
import type { Coordinates, Photo, PhotoPage, PhotoPoint, Trip } from "@/lib/photo-types";
import { validCoordinates, type PhotoCluster } from "@/lib/photo-domain";
import { changePhotoTrash } from "@/lib/photo-actions";
import { dateLabel } from "@/lib/domain";
import { Button, ErrorNotice } from "../ui";
import { PhotoDetail } from "./photo-detail";
import { PhotoEditor, TripEditor } from "./photo-editor";
import { PhotoUpload } from "./photo-upload";
const Earth = dynamic(() => import("./earth").then(m => m.Earth), { ssr: false, loading: () => <div className="earth-placeholder">正在展开地球…</div> });
const filterNames = ["view", "year", "trip", "date", "unlocated", "trash", "lat", "lng", "radius"];
export function PhotoLibrary({ data, travel = false, initialPhoto }: { data: JournalData; travel?: boolean; initialPhoto?: string }) {
  const params = useSearchParams(), router = useRouter(), path = travel ? "/travels" : "/photos";
  const [epoch, setEpoch] = useState(0), [page, setPage] = useState<PhotoPage | null>(null), [busy, setBusy] = useState(true), [moreBusy, setMoreBusy] = useState(false), [error, setError] = useState("");
  const [upload, setUpload] = useState(false), [editor, setEditor] = useState<Photo[] | null>(null), [tripEditor, setTripEditor] = useState<Trip | "new" | null>(null), [selecting, setSelecting] = useState(false), [selection, setSelection] = useState<string[]>([]);
  const [points, setPoints] = useState<PhotoPoint[]>([]), [pointError, setPointError] = useState(""), [cluster, setCluster] = useState<PhotoCluster | null>(null), [picking, setPicking] = useState(false), [panelExpanded, setPanelExpanded] = useState(false);
  const query = filterNames.flatMap(key => params.get(key) ? [[key, params.get(key)!]] : []), queryKey = new URLSearchParams([...query, ...(travel ? [["kind", "travel"]] : [])]).toString();
  const pointQuery = new URLSearchParams(query.filter(([key]) => !["lat", "lng", "radius", "unlocated", "trash"].includes(key))).toString();
  const photoId = params.get("photo") || initialPhoto;
  const center: Coordinates | null = params.has("lat") && params.has("lng") && validCoordinates(Number(params.get("lat")), Number(params.get("lng"))) ? { lat: Number(params.get("lat")), lng: Number(params.get("lng")) } : null;
  const radius = Math.min(10000, Math.max(.1, Number(params.get("radius")) || 20));
  const refresh = useCallback(() => { setEpoch(v => v + 1); router.refresh(); }, [router]);
  function patch(values: Record<string, string | null>, push = false) {
    const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    window.history[push ? "pushState" : "replaceState"](null, "", `${path}${next.size ? `?${next}` : ""}`);
  }
  const clusterKey = cluster?.points.map(p => p.id).join(",") ?? "";
  const readPage = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    const q = new URLSearchParams(queryKey); if (cursor) q.set("cursor", cursor);
    const response = await fetch(`/api/photos?${q}`, { signal, ...(clusterKey ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: clusterKey.split(",") }) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "照片暂时无法读取。"); return result as PhotoPage;
  }, [queryKey, clusterKey]);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError(""); setSelection([]);
    const timer = setTimeout(() => { void readPage(null, abort.signal).then(result => { if (!abort.signal.aborted) setPage(result); }).catch(e => { if (!abort.signal.aborted) setError(e.message || "读取失败，请重试。"); }).finally(() => { if (!abort.signal.aborted) setBusy(false); }); }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [readPage, epoch]);
  useEffect(() => { const focus = () => { if (document.visibilityState === "visible") setEpoch(v => v + 1); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, []);
  useEffect(() => {
    if (!travel) return; const abort = new AbortController();
    void fetch(`/api/footprints?${pointQuery}`, { signal: abort.signal }).then(async r => { const result = await r.json(); if (!r.ok) throw new Error(result.error); if (!abort.signal.aborted) { setPoints(result.points); setPointError(""); } }).catch(e => { if (!abort.signal.aborted) setPointError(e.message); });
    return () => abort.abort();
  }, [travel, pointQuery, epoch]);
  const filteredTrip = page?.trips.find(t => t.id === params.get("trip"));
  const clearArea = () => { setCluster(null); setPicking(false); patch({ lat: null, lng: null, radius: null }); };
  const pick = (point: Coordinates) => { setCluster(null); patch({ lat: point.lat.toFixed(6), lng: point.lng.toFixed(6), radius: String(radius) }); setPanelExpanded(true); };
  const selectCluster = (c: PhotoCluster) => { setCluster(c); setPicking(false); patch({ lat: null, lng: null, radius: null }); setPanelExpanded(true); };
  const toggleSelect = (id: string) => setSelection(old => old.includes(id) ? old.filter(v => v !== id) : old.length < 50 ? [...old, id] : old);
  const activeIndex = page?.items.findIndex(p => p.id === photoId) ?? -1;
  const timelineLink = `/timeline?${new URLSearchParams({ kind: travel ? "travel" : "photo", ...(params.get("view") && params.get("view") !== "all" && params.get("view") !== "shared" ? { view: params.get("view")! } : {}), ...(params.get("trip") ? { trip: params.get("trip")! } : {}) })}`;
  const locationGroups = useMemo(() => {
    const map = new Map<string, PhotoPoint[]>(); for (const point of points) { const key = point.place || `${point.lat.toFixed(2)}°, ${point.lng.toFixed(2)}°`; map.set(key, [...(map.get(key) ?? []), point]); }
    return [...map].sort((a, b) => b[1].length - a[1].length);
  }, [points]);
  async function loadMore() { if (!page?.cursor || moreBusy) return; setMoreBusy(true); try { const next = await readPage(page.cursor); setPage(old => old ? { ...next, items: [...old.items, ...next.items.filter(p => !old.items.some(v => v.id === p.id))] } : next); } catch (e) { setError(e instanceof Error ? e.message : "读取失败"); } finally { setMoreBusy(false); } }
  const openPhoto = (id: string) => patch({ photo: id }, !photoId);
  return <section className={`photo-library ${travel ? "travel-library" : ""}`}>
    <div className="page-heading photo-page-heading"><div><div className="photo-page-kicker">{travel ? "把走过的地方，留在星球上" : "光影里的日常"}</div><h1 className="serif">{travel ? "我们的地球足迹" : "照片墙"}</h1></div><div className="inline-actions"><Link href={timelineLink} className="button ghost"><Clock3 size={16} /><span>时光轴</span></Link><Button onClick={() => setUpload(true)}><Plus size={17} />上传照片</Button></div></div>
    <div className="photo-view-switch"><Link href={`/photos${pointQuery ? `?${pointQuery}` : ""}`} aria-current={!travel ? "page" : undefined}><ImagePlus size={16} />照片墙</Link><Link href={`/travels${pointQuery ? `?${pointQuery}` : ""}`} aria-current={travel ? "page" : undefined}><Globe2 size={16} />地球足迹</Link><span>{busy ? "正在整理…" : `${page?.total ?? 0} 张照片`}</span></div>
    <div className="photo-filters"><label>参与者<select aria-label="筛选照片参与者" value={params.get("view") || "all"} onChange={e => { setCluster(null); patch({ view: e.target.value }); }}><option value="all">全部照片</option><option value="shared">我们两人</option>{data.members.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>时间<select aria-label="筛选照片年份" value={params.get("year") || ""} onChange={e => { setCluster(null); patch({ year: e.target.value, date: null }); }}><option value="">所有年份</option>{page?.years.map(y => <option key={y} value={y}>{y} 年</option>)}<option value="undated">日期未记</option></select></label><label>旅行<select aria-label="筛选旅行" value={params.get("trip") || ""} onChange={e => { setCluster(null); patch({ trip: e.target.value }); }}><option value="">所有旅行与日常</option>{page?.trips.map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
      {!travel && <label className="photo-check"><input type="checkbox" checked={params.get("unlocated") === "1"} onChange={e => patch({ unlocated: e.target.checked ? "1" : null })} />待补地点</label>}
      <button className="text-link" onClick={() => setTripEditor("new")}><Plus size={14} />记一次旅行</button>{!travel && <button className="text-link" onClick={() => { setSelecting(false); patch({ trash: params.get("trash") === "1" ? null : "1" }); }}><Trash2 size={14} />{params.get("trash") === "1" ? "回到照片墙" : "回收站"}</button>}
    </div>
    {params.get("date") && <div className="photo-active-filter">{params.get("date") === "undated" ? "日期未记" : params.get("date")}<button aria-label="清除日期筛选" onClick={() => patch({ date: null })}><X size={14} /></button></div>}
    {filteredTrip && <div className="selected-trip"><div><h2 className="serif">{filteredTrip.title}</h2>{filteredTrip.description && <p>{filteredTrip.description}</p>}<small>{dateLabel(filteredTrip.startedOn)}{filteredTrip.endedOn && filteredTrip.endedOn !== filteredTrip.startedOn ? ` — ${dateLabel(filteredTrip.endedOn)}` : ""} · {filteredTrip.photoCount} 张</small></div><button className="text-link" onClick={() => setTripEditor(filteredTrip)}><Edit3 size={14} />编辑旅行</button></div>}
    <ErrorNotice text={error || pointError} />
    {travel && <div className="travel-layout"><div className="travel-globe"><Earth points={points} center={center} radius={radius} picking={picking} onPick={pick} onSelect={selectCluster} />
      <div className="area-controls"><Button variant={picking ? "primary" : "secondary"} onClick={() => { setPicking(v => !v); setCluster(null); }}><Crosshair size={16} />{picking ? "正在圈选" : "圈选一片足迹"}</Button>{(center || cluster) && <button className="text-link" onClick={clearArea}>清除选择</button>}
        {center && <label className="radius-control">范围半径<input aria-label="范围半径滑杆" type="range" min={-1} max={4} step={.025} value={Math.log10(radius)} onChange={e => patch({ radius: (10 ** Number(e.target.value)).toFixed(1) })} /><input type="number" aria-label="范围半径（公里）" min={.1} max={10000} step={.1} value={radius} onChange={e => { const n = Number(e.target.value); if (n >= .1 && n <= 10000) patch({ radius: String(n) }); }} />公里</label>}
      </div><p className="travel-help">拖动旋转，滚轮或双指缩放。点击光点，看看当时的照片。</p></div>
      <aside className={`travel-photo-panel ${panelExpanded ? "expanded" : ""}`}><button className="panel-handle" onClick={() => setPanelExpanded(v => !v)} aria-expanded={panelExpanded}>{cluster ? `${cluster.count} 张照片` : center ? `半径 ${radius.toFixed(1)} 公里` : "沿途的片刻"}<span>{panelExpanded ? "收起" : "展开"}</span></button>
        <div className="travel-panel-content"><div className="travel-panel-heading"><h2 className="serif">{cluster ? "在这里留下的故事" : center ? "这一圈的回忆" : "沿途的片刻"}</h2><small>{page?.total ?? 0} 张照片</small></div>
        {busy ? <div className="photo-loading" role="status">正在寻找照片…</div> : page?.items.length ? <div className="travel-thumbnails">{page.items.map(p => <button key={p.id} onClick={() => openPhoto(p.id)} aria-label={`查看照片 ${p.caption || p.place || dateLabel(p.takenOn)}`}><img src={`/api/assets/${p.assetId}`} alt={p.caption || p.place || "旅途照片"} loading="lazy" /><span>{p.place || dateLabel(p.takenOn)}</span></button>)}</div> : <div className="photo-quiet-empty"><MapPin size={26} /><p>{center || cluster ? "这一片还没有照片，试着扩大范围。" : "上传有 GPS 的照片，点亮第一个地方。"}</p><button className="text-link" onClick={() => setUpload(true)}>添加照片<ArrowRight size={14} /></button></div>}
        {page?.cursor && <Button variant="ghost" busy={moreBusy} onClick={() => void loadMore()}>加载更多照片</Button>}</div>
      </aside></div>}
    {!travel && <>
      {page && page.items.length > 0 && params.get("trash") !== "1" && <div className="photo-selection-bar"><button className="text-link" onClick={() => { setSelecting(v => !v); setSelection([]); }}>{selecting ? "取消选择" : "批量整理照片"}</button>{selecting && <><button className="text-link" onClick={() => setSelection(page.items.slice(0, 50).map(p => p.id))}>选择前 {Math.min(50, page.items.length)} 张</button><span>已选 {selection.length} 张</span><Button variant="secondary" disabled={!selection.length} onClick={() => setEditor(page.items.filter(p => selection.includes(p.id)))}>整理所选</Button></>}</div>}
      {busy ? <div className="photo-loading" role="status"><span />正在整理光影…</div> : page?.items.length ? <div className="photo-date-groups">{[...new Set(page.items.map(p => p.takenOn?.slice(0, 7) ?? "undated"))].map(month => <section key={month} className="photo-month"><div className="photo-month-heading"><h2>{month === "undated" ? "日期未记" : `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`}</h2><span /></div><div className="photo-masonry">{page.items.filter(p => (p.takenOn?.slice(0, 7) ?? "undated") === month).map(p => <article key={p.id} className={`photo-tile ${selection.includes(p.id) ? "selected" : ""}`}>
        <button className="photo-tile-image" disabled={!!p.deletedAt} onClick={() => selecting ? toggleSelect(p.id) : openPhoto(p.id)} aria-label={selecting ? `选择照片 ${p.caption || dateLabel(p.takenOn)}` : `查看照片 ${p.caption || p.place || dateLabel(p.takenOn)}`} aria-pressed={selecting ? selection.includes(p.id) : undefined}><img src={`/api/assets/${p.assetId}`} width={p.width} height={p.height} alt={p.caption || p.place || "收藏的照片"} loading="lazy" />{selecting && <span className="photo-selection-check">{selection.includes(p.id) && <Check size={14} />}</span>}</button>
        <div className="photo-tile-meta"><span>{p.caption || p.place || dateLabel(p.takenOn)}</span>{p.commentCount > 0 && <small>{p.commentCount} 条留言</small>}</div>{p.deletedAt && <Button variant="secondary" onClick={async () => { try { const result = await changePhotoTrash({ id: p.id, revision: p.revision, restore: true }); if (!result.ok) setError(result.error); else refresh(); } catch { setError("恢复失败，请重试。"); } }}><RotateCcw size={14} />恢复照片</Button>}
      </article>)}</div></section>)}</div> : <div className="photo-empty"><div className="empty-photo-frame"><ImagePlus size={38} strokeWidth={1} /></div><h2 className="serif">{params.get("trash") === "1" ? "没有收起的照片" : "给日常，留一个位置"}</h2><p>{params.get("trash") === "1" ? "移入回收站的照片和评论会保留在这里。" : params.size ? "这里还没有符合筛选的照片，可以调整条件或添加新的片刻。" : "一张照片，一次旅行，或一个舍不得忘记的瞬间。"}</p>{params.get("trash") !== "1" && <Button onClick={() => setUpload(true)}><Plus size={16} />收藏第一张照片</Button>}</div>}
      {!busy && page?.cursor && <div className="photo-load-more"><Button variant="secondary" busy={moreBusy} onClick={() => void loadMore()}>再看一些照片</Button><small>已展示 {page.items.length} / {page.total} 张</small></div>}
    </>}
    {travel && locationGroups.length > 0 && <details className="footprint-locations"><summary>按地点浏览 · {locationGroups.length} 处</summary><div>{locationGroups.map(([place, group]) => <button key={place} onClick={() => { selectCluster({ id: group[0].id, lat: group[0].lat, lng: group[0].lng, points: group, count: group.length }); }}><MapPin size={14} /><span>{place}</span><small>{group.length} 张</small></button>)}</div></details>}
    {!params.get("trip") && page && page.trips.length > 0 && <section className="trip-shelf"><div className="section-heading"><h2 className="serif">一程一故事</h2><button className="text-link" onClick={() => setTripEditor("new")}>记一次旅行<Plus size={14} /></button></div><div className="trip-cards">{page.trips.map(t => <button key={t.id} onClick={() => { setCluster(null); patch({ trip: t.id }); window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}>{t.coverAssetId ? <img src={`/api/assets/${t.coverAssetId}`} alt={t.title} loading="lazy" /> : <div className="trip-empty-cover"><Globe2 size={32} /></div>}<span><strong className="serif">{t.title}</strong><small>{t.photoCount} 张照片 · {dateLabel(t.startedOn)}</small></span></button>)}</div></section>}
    {upload && <PhotoUpload data={data} trips={page?.trips ?? []} initialTrip={params.get("trip") ?? undefined} close={() => setUpload(false)} completed={(photos, edit) => { setUpload(false); refresh(); if (edit && photos.length) setEditor(photos); }} />}
    {editor && <PhotoEditor data={data} photos={editor} trips={page?.trips ?? []} close={() => setEditor(null)} saved={() => { setSelecting(false); setSelection([]); refresh(); }} />}
    {tripEditor && <TripEditor trip={tripEditor === "new" ? undefined : tripEditor} close={() => setTripEditor(null)} saved={trip => { setCluster(null); patch({ trip: trip ?? null }); refresh(); }} />}
    {photoId && <PhotoDetail key={photoId} id={photoId} data={data} close={() => { if (initialPhoto) router.replace("/photos"); else patch({ photo: null }); }} changed={refresh} previous={activeIndex > 0 && page ? () => patch({ photo: page.items[activeIndex - 1].id }) : undefined} next={page && activeIndex >= 0 && activeIndex < page.items.length - 1 ? () => patch({ photo: page.items[activeIndex + 1].id }) : undefined} />}
  </section>;
}
