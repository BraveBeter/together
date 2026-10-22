"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark, MessageSquare, Plus, Search, SlidersHorizontal, Users, ListPlus, LayoutGrid, PanelsTopLeft, X } from "lucide-react";
import { actOnRecommendation } from "@/lib/actions";
import { activeRecord, canRecommend, pendingRecommendation, sharedLabels, statuses, statusLabels, validStatus } from "@/lib/domain";
import type { Entry, JournalData, Kind, Status } from "@/lib/types";
import { Avatar, Button, Cover, Empty, Rating } from "./ui";
import { MovieExhibition } from "./movie-exhibition";
import { movieThemes, matchesMovieGenre, primaryMovieTheme } from "@/lib/movie-themes";
import type { EditState, Run } from "./editor-types";
export function PerspectiveTabs({ data, value, onChange }: { data: JournalData; value: string; onChange: (value: string) => void }) {
  return <nav className="perspective-tabs" aria-label="人物视角"><button className={!value ? "selected" : ""} aria-current={!value ? "page" : undefined} onClick={() => onChange("")}><span className="avatar shared-avatar"><Users size={16} /></span><span>我们</span></button>{data.members.map(m => <button key={m.id} className={value === m.id ? "selected" : ""} aria-current={value === m.id ? "page" : undefined} onClick={() => onChange(m.id)}><Avatar member={m} small /><span>{m.name}</span></button>)}</nav>;
}
export function EntryCard({ entry, data, view = "", from, edit }: { entry: Entry; data: JournalData; view?: string; from?: string; edit?: (value: EditState) => void }) {
  const members = view ? data.members.filter(m => m.id === view) : data.members;
  const record = view ? activeRecord(entry, view) : null, other = data.members.find(m => m.id !== data.me.id);
  const recommendation = data.recommendations.find(r => r.entryId === entry.id && r.senderId === view && pendingRecommendation(r, entry));
  return <article className={`entry-card ${entry.kind}`} data-entry-id={entry.id}>
    <Link href={`/entry/${entry.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`} className="entry-card-link"><div className="cover-wrap"><Cover entry={entry} />{record?.pinned && <span className="pin-marker" aria-label="已置顶"><Bookmark size={14} fill="currentColor" /></span>}</div><h3 className="serif">{entry.title}</h3><p className="card-creator">{[entry.creator, entry.year].filter(Boolean).join(" · ") || (entry.kind === "book" ? "书籍" : "电影")}</p><div className="card-ratings">{members.map(m => { const review = data.reviews.find(r => r.entryId === entry.id && r.userId === m.id); return review?.rating ? <span className="named-rating" key={m.id}><span className="rating-name">{m.name}</span><Rating value={review.rating} /></span> : null; })}</div></Link>
    {recommendation && <div className="recommend-note"><MessageSquare size={13} /><span>{recommendation.note || "想推荐给你"}</span><small>等待回应</small></div>}
    {view === data.me.id && edit && other && canRecommend(entry, view, other.id) && <button className="card-recommend text-link" onClick={() => edit({ type: "recommend", entry })}>{recommendation ? "修改推荐留言" : "想推荐给你"}<ArrowRight size={13} /></button>}
  </article>;
}
export function Catalog({ data, kind, edit, run, pending }: { data: JournalData; kind: Kind; edit: (value: EditState) => void; run: Run; pending: boolean }) {
  const params = useSearchParams(), router = useRouter(), path = usePathname();
  const view = data.members.some(m => m.id === params.get("view")) ? params.get("view")! : "";
  const selectedStatus = params.get("status"), state = validStatus(kind, selectedStatus) ? selectedStatus : statuses(kind)[0];
  const own = view === data.me.id, person = data.members.find(m => m.id === view), q = params.get("q") ?? "", tag = params.get("tag") ?? "";
  const sort = ["recent", "title", "date"].includes(params.get("sort") ?? "") ? params.get("sort")! : "recent";
  const genre = movieThemes.some(t => t.key === params.get("genre")) ? params.get("genre")! : "", theme = movieThemes.some(t => t.key === params.get("theme")) ? params.get("theme")! : "";
  const [search, setSearch] = useState(q), [filters, setFilters] = useState(!!tag || !!genre || !!theme || sort !== "recent"), [inbox, setInbox] = useState(false);
  const from = `${path}?${params.toString()}`;
  const recordId = params.get("record");
  useEffect(() => {
    if (!own || !recordId) return;
    const entry = data.entries.find(e => e.id === recordId && e.kind === kind && !e.deletedAt);
    if (entry) edit({ type: "personal", entry, status: state });
    const next = new URLSearchParams(params); next.delete("record"); window.history.replaceState(null, "", `${path}?${next}`);
    // Open a requested record once after arriving in the owner's perspective.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, own]);
  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params); if (!("page" in values)) next.delete("page"); next.delete("relation"); next.delete("filter"); next.delete("recommendations");
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    window.history.replaceState(null, "", `${path}?${next.toString()}`);
  }
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    const key = `catalog-scroll:${from}`, saved = sessionStorage.getItem(key);
    if (saved) requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
    const remember = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true }); return () => window.removeEventListener("scroll", remember);
  }, [from]);
  const all = data.entries.filter(e => !e.deletedAt && e.kind === kind && (view ? !!activeRecord(e, view) : e.sharedStatus !== null));
  const list = all.filter(e => (view ? activeRecord(e, view)?.status : e.sharedStatus) === state && (!genre || matchesMovieGenre(e, genre)) && (!theme || primaryMovieTheme(e) === theme) && (!tag || e.tags.includes(tag)) && (!q || [e.title, e.creator, ...e.tags].join(" ").toLowerCase().includes(q.toLowerCase()))).sort((a, b) => {
    if (view) { const pin = Number(activeRecord(b, view)?.pinned) - Number(activeRecord(a, view)?.pinned); if (pin) return pin; }
    if (sort === "title") return a.title.localeCompare(b.title, "zh-CN");
    if (sort === "date") { const aDate = view ? activeRecord(a, view)?.completedOn : a.together?.completedOn, bDate = view ? activeRecord(b, view)?.completedOn : b.together?.completedOn; return (bDate ?? "").localeCompare(aDate ?? "") || b.createdAt - a.createdAt; }
    return (view ? activeRecord(b, view)!.updatedAt - activeRecord(a, view)!.updatedAt : b.createdAt - a.createdAt) || a.id.localeCompare(b.id);
  });
  const stateCount = all.filter(e => (view ? activeRecord(e, view)?.status : e.sharedStatus) === state).length;
  const layout = kind === "movie" && (params.get("layout") === "exhibition" || !params.has("layout") && !q && !genre && !theme && stateCount >= 12) ? "exhibition" : "grid";
  const totalPages = Math.max(1, Math.ceil(list.length / 48)), rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, totalPages) : 1;
  const tags = [...new Set(all.flatMap(e => e.tags))].sort();
  const incoming = data.recommendations.filter(r => r.recipientId === data.me.id && pendingRecommendation(r, data.entries.find(e => e.id === r.entryId && e.kind === kind)));
  const heading = person ? `${person.name}的${kind === "book" ? "书房" : "电影清单"}` : kind === "book" ? "共同书房" : "电影馆";
  return <div className={`catalog-page ${kind}`}>
    <div className="page-heading"><div><h1 className="serif">{heading}</h1><p>{view ? "各自的步调，也有交会的时刻。" : "两个人，同一份期待。"}</p></div>{own ? <div className="catalog-heading-actions"><Link className="button secondary" href={`/imports?kind=${kind}&status=${state}`}><ListPlus size={16} />批量导入</Link><Button onClick={() => edit({ type: "entry", kind, status: state })}><Plus size={16} />添加{kind === "book" ? "书籍" : "电影"}</Button></div> : <button className="button secondary" onClick={() => change({ view: data.me.id, status: state })}>到我的清单记录<ArrowRight size={15} /></button>}</div>
    <PerspectiveTabs data={data} value={view} onChange={value => { setInbox(false); change({ view: value, status: state }); }} />
    <div className="status-tabs" role="group" aria-label="清单状态">{statuses(kind).map(s => <button key={s} className={s === state ? "selected" : ""} aria-pressed={s === state} onClick={() => change({ status: s })}>{(view ? statusLabels : sharedLabels)[kind][s]}<span>{all.filter(e => (view ? activeRecord(e, view)?.status : e.sharedStatus) === s).length}</span></button>)}</div>
    {own && incoming.length > 0 && <div className="recommend-inbox"><button className="inbox-toggle" onClick={() => setInbox(!inbox)} aria-expanded={inbox}><MessageSquare size={16} /><span>留给你的推荐</span><strong>{incoming.length}</strong><span>{inbox ? "收起" : "展开"}</span></button>{inbox && <div className="inbox-list">{incoming.map(r => { const entry = data.entries.find(e => e.id === r.entryId)!, sender = data.members.find(m => m.id === r.senderId)!; return <article className="inbox-row" key={r.id}><Cover entry={entry} /><div><Link href={`/entry/${entry.id}`} className="serif">{entry.title}</Link><p>{r.note || `${sender.name} 觉得你会喜欢这部作品。`}</p><small>{sender.name} 的推荐</small><div className="inline-actions"><Button variant="secondary" busy={pending} onClick={() => { void run(() => actOnRecommendation({ id: r.id, revision: r.revision, command: "accept" }), "已加入你的清单").then(ok => { if (ok) change({ status: "planned" }); }); }}>加入我的{kind === "book" ? "想读" : "想看"}</Button><Button variant="ghost" busy={pending} onClick={() => { void run(() => actOnRecommendation({ id: r.id, revision: r.revision, command: "dismiss" }), "已暂放这条推荐"); }}>先放一放</Button></div></div></article>; })}</div>}</div>}
    <div className="catalog-toolbar"><form className="search-box" role="search" onSubmit={e => { e.preventDefault(); change({ q: search.trim(), layout: "grid" }); }}><Search size={16} /><input aria-label="搜索作品" placeholder={kind === "book" ? "搜索书名、作者、标签" : "搜索电影、导演、标签"} value={search} onChange={e => setSearch(e.target.value)} /><button type="submit" aria-label="提交搜索"><ArrowRight size={15} /></button></form>{kind === "movie" && <div className="catalog-layout-toggle" aria-label="浏览方式"><button aria-pressed={layout === "exhibition"} className={layout === "exhibition" ? "selected" : ""} onClick={() => change({ layout: "exhibition", theme: "" })}><PanelsTopLeft size={15} /><span>主题展映</span></button><button aria-pressed={layout === "grid"} className={layout === "grid" ? "selected" : ""} onClick={() => change({ layout: "grid" })}><LayoutGrid size={15} /><span>全部影片</span></button></div>}<span className="result-count">{list.length} {kind === "book" ? "本" : "部"}</span><button className={`filter-toggle ${filters ? "selected" : ""}`} aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={15} /><span>筛选与排序</span></button></div>
    {filters && <div className="filter-panel">{kind === "movie" && <label>类型<select value={genre} onChange={e => change({ genre: e.target.value, theme: "", layout: "grid" })}><option value="">全部类型</option>{movieThemes.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}</select></label>}<label>标签<select value={tag} onChange={e => change({ tag: e.target.value })}><option value="">全部标签</option>{tags.map(t => <option key={t}>{t}</option>)}</select></label><label>排序<select value={sort} onChange={e => change({ sort: e.target.value })}><option value="recent">最近记录</option><option value="title">作品名称</option><option value="date">完成日期</option></select></label>{(q || tag || genre || theme) && <button className="text-link" onClick={() => { setSearch(""); change({ q: "", tag: "", genre: "", theme: "" }); }}>清除筛选</button>}</div>}
    {theme && <div className="catalog-active-theme"><span>{movieThemes.find(t => t.key === theme)?.title}</span><button aria-label="清除主题筛选" onClick={() => change({ theme: "" })}><X size={14} /></button></div>}
    {list.length ? layout === "exhibition" ? <MovieExhibition entries={list} data={data} view={view} from={from} edit={edit} onShowAll={value => change({ layout: "grid", theme: value, genre: "" })} /> : <div className="catalog-grid">{list.slice((page - 1) * 48, page * 48).map(entry => <EntryCard key={entry.id} entry={entry} data={data} view={view} from={from} edit={edit} />)}</div> : <Empty kind={kind} title={q || tag || genre || theme ? "没有找到匹配的作品" : `还没有${(view ? statusLabels : sharedLabels)[kind][state]}的${kind === "book" ? "书" : "电影"}`} text={view ? own ? "从你的清单开始，日期和感受可以以后补充。" : "对方的记录会出现在这里。" : "双方都加入清单且状态相同时，作品会出现在这里。"} />}
    {layout === "grid" && totalPages > 1 && <nav className="collection-pagination" aria-label="作品分页"><Button variant="ghost" disabled={page === 1} onClick={() => change({ page: String(page - 1) })}>上一页</Button><span>{page} / {totalPages} 页 · 共 {list.length} {kind === "book" ? "本" : "部"}</span><Button variant="ghost" disabled={page === totalPages} onClick={() => change({ page: String(page + 1) })}>下一页</Button></nav>}
    {!view && <p className="catalog-footnote">仅展示双方状态相同的作品。共同看完或读完，不代表已确认一起完成。</p>}
  </div>;
}
