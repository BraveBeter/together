"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, MapPin, Camera } from "lucide-react";
import { timelineMoments } from "@/lib/timeline";
import { dateLabel } from "@/lib/domain";
import type { JournalData } from "@/lib/types";
import type { PhotoMoment } from "@/lib/photo-types";
import { PerspectiveTabs } from "./catalog";
import { Button, Cover, Empty, ErrorNotice } from "./ui";
import { PhotoDetail } from "./photos/photo-detail";
function usePhotoMoments(query: string, enabled: boolean, limit = 40) {
  const [items, setItems] = useState<PhotoMoment[]>([]), [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(enabled), [error, setError] = useState(""), [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setItems([]); setCursor(null); setError(""); setBusy(enabled);
    if (enabled) void fetch(`/api/photos?mode=timeline&limit=${limit}&${query}`, { signal: abort.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error); if (!abort.signal.aborted) { setItems(body.items); setCursor(body.cursor); } }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [query, enabled, epoch, limit]);
  useEffect(() => { const refresh = () => { if (document.visibilityState === "visible") setEpoch(v => v + 1); }; window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  async function more() {
    if (!cursor || busy) return; setBusy(true); setError("");
    try { const r = await fetch(`/api/photos?mode=timeline&${query}&momentCursor=${cursor}`); const body = await r.json(); if (!r.ok) throw new Error(body.error); setItems(old => [...old, ...body.items.filter((m: PhotoMoment) => !old.some(v => v.id === m.id))]); setCursor(body.cursor); }
    catch (e) { setError(e instanceof Error ? e.message : "加载失败"); } finally { setBusy(false); }
  }
  return { items, cursor, busy, error, more, refresh: () => setEpoch(v => v + 1) };
}
export function JournalTimeline({ data, showImage }: { data: JournalData; showImage: (id: string) => void }) {
  const params = useSearchParams(), view = data.members.some(m => m.id === params.get("view")) ? params.get("view")! : "";
  const kind = ["all", "movie", "book", "photo", "travel"].includes(params.get("kind") ?? "") ? params.get("kind")! : "all", trip = params.get("trip");
  const photos = usePhotoMoments(new URLSearchParams({ view: view || "shared", ...(kind === "travel" ? { kind: "travel" } : {}), ...(trip ? { trip } : {}) }).toString(), ["all", "photo", "travel"].includes(kind));
  const [photoId, setPhotoId] = useState<string | null>(null);
  const work = !trip && ["all", "movie", "book"].includes(kind) ? timelineMoments(data.entries.filter(e => kind === "all" || e.kind === kind), data.memories, view || null).map(m => ({ ...m, type: "work" as const })) : [];
  const cutoff = photos.cursor ? photos.items.at(-1)?.date ?? "" : "";
  const moments = [...work.filter(m => !photos.cursor || (m.date ?? "") >= cutoff), ...photos.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.order - a.order || a.id.localeCompare(b.id));
  const groups = [...new Set(moments.map(m => m.date?.slice(0, 7) ?? "undated"))];
  function update(values: Record<string, string | null>) { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); window.history.replaceState(null, "", `/timeline?${next}`); }
  return <><div className="page-heading"><div><h1 className="serif">时光轴</h1><p>{view ? "读过的故事，走过的地方，留下的片刻。" : "那些一起度过、值得记住的日子。"}</p></div></div><PerspectiveTabs data={data} value={view} onChange={value => update({ view: value || null })} />
    <div className="timeline-toolbar"><label>内容<select aria-label="时光轴内容" value={kind} onChange={e => update({ kind: e.target.value, ...(["movie", "book"].includes(e.target.value) ? { trip: null } : {}) })}><option value="all">全部经历</option><option value="movie">电影</option><option value="book">书籍</option><option value="photo">照片</option><option value="travel">旅行足迹</option></select></label><span>{moments.length} 段记录{photos.cursor ? " · 还有更多" : ""}</span>{trip && <button className="text-link" onClick={() => update({ trip: null })}>查看所有旅行</button>}</div>
    <ErrorNotice text={photos.error} />
    {moments.length ? <div className="timeline">{groups.map(key => <section className="timeline-group" key={key}><h2>{key === "undated" ? "日期未记" : `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`}</h2><div className="timeline-stories">{moments.filter(m => (m.date?.slice(0, 7) ?? "undated") === key).map(m => <article className={`timeline-item ${m.type === "photos" ? "timeline-photo-moment" : ""}`} key={m.id}><span className="timeline-dot" />
      {m.type === "work" ? <><Link href={`/entry/${m.entry.id}`} className="timeline-work"><Cover entry={m.entry} /><div><small>{dateLabel(m.date)}</small><h3 className="serif">{m.entry.title}</h3><p>{m.events.join(" · ") || "共同回忆"}</p></div><ArrowUpRight size={16} /></Link>{m.memories.map(memory => <div className="timeline-memory" key={memory.id}><p>{memory.body}</p>{memory.place && <small>{memory.place}</small>}<div className="memory-photos">{memory.photos.map((photo, i) => <button key={photo} onClick={() => showImage(photo)} aria-label={`查看回忆照片${i + 1}`}><img src={`/api/assets/${photo}`} alt="共同回忆照片" /></button>)}</div></div>)}</> : <><div className="timeline-photo-heading"><small>{dateLabel(m.date)}</small><h3 className="serif">{m.title}</h3><p><Camera size={13} />{m.total} 张照片{m.located > 0 && <><MapPin size={13} />留下了足迹</>}</p></div><div className="timeline-photo-strip">{m.photos.map(photo => <button key={photo.id} onClick={() => setPhotoId(photo.id)} aria-label={`查看照片 ${photo.caption || photo.place || "收藏的片刻"}`}><img src={`/api/assets/${photo.assetId}`} alt={photo.caption || photo.place || "收藏的照片"} loading="lazy" /></button>)}</div><Link className="text-link" href={`/photos?${new URLSearchParams({ date: m.date || "undated", view: view || "shared", ...(m.tripId ? { trip: m.tripId } : {}) })}`}>查看当天照片<ArrowUpRight size={14} /></Link></>}
    </article>)}</div></section>)}</div> : photos.busy ? <p className="photo-loading" role="status">正在整理时光…</p> : <Empty title="时光慢慢积累" text="书影音、照片与旅行，都可以在这里回看。未知日期会单独归组。" />}
    {photos.cursor && <div className="photo-load-more"><Button variant="secondary" busy={photos.busy} onClick={() => void photos.more()}>继续回看</Button></div>}
    {photoId && <PhotoDetail key={photoId} id={photoId} data={data} close={() => setPhotoId(null)} changed={photos.refresh} />}
  </>;
}
export function RecentExperiences({ data }: { data: JournalData }) {
  const photos = usePhotoMoments("view=shared", true, 3);
  const work = timelineMoments(data.entries, data.memories, null).slice(0, 3).map(m => ({ ...m, type: "work" as const }));
  const all = [...work, ...photos.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.order - a.order).slice(0, 3);
  return <>{all.length ? <div className="recent-moments">{all.map(m => m.type === "work" ? <Link key={m.id} href={`/entry/${m.entry.id}`}><Cover entry={m.entry} /><div><small>{dateLabel(m.date)}</small><h3 className="serif">{m.entry.title}</h3><p>{m.memories[0]?.body || m.events.join(" · ")}</p></div><ArrowUpRight size={16} /></Link> : <Link key={m.id} href={`/photos?${new URLSearchParams({ date: m.date || "undated", view: "shared", ...(m.tripId ? { trip: m.tripId } : {}) })}`}><img className="recent-photo" src={`/api/assets/${m.photos[0].assetId}`} alt={m.title} /><div><small>{dateLabel(m.date)}</small><h3 className="serif">{m.title}</h3><p>{m.total} 张照片{m.located ? " · 在世界留下足迹" : ""}</p></div><ArrowUpRight size={16} /></Link>)}</div> : <div className="quiet-empty">记录一次共同完成，或收藏一张照片，让时光慢慢积累。</div>}<ErrorNotice text={photos.error} /></>;
}
