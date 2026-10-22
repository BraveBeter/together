"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, FileUp, ListPlus, Pause, Play, RefreshCw, Search } from "lucide-react";
import { importStateLabels, type ImportBatch, type ImportInput, type ImportItem, type ImportState, type ImportSummary } from "@/lib/import-types";
import { parseImport, matchText } from "@/lib/import-parser";
import { catalogSources, type CatalogItem } from "@/lib/catalog-metadata";
import { statuses, statusLabels, validStatus } from "@/lib/domain";
import type { JournalData, Kind, Status } from "@/lib/types";
import { Button, ErrorNotice, Modal } from "./ui";
type Reply = { item?: ImportItem; batch?: ImportBatch; batches?: ImportSummary[] };
async function call(body?: unknown, query = ""): Promise<Reply> {
  const response = await fetch(`/api/imports${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" }).catch(() => { throw new Error("网络暂时不可用。输入和导入进度会保留，请稍后重试。"); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "网络暂时不可用。输入和导入进度会保留，请稍后重试。");
  return result;
}
function CatalogThumb({ item, assetId }: { item?: CatalogItem | null; assetId?: string | null }) {
  return <span className={`import-thumb ${item?.ref.kind ?? ""}`}>{item && (assetId || item.hasCover) ? <img loading="lazy" alt={`${item.title}封面`} src={assetId ? `/api/assets/${assetId}` : `/api/catalog/cover?${new URLSearchParams(item.ref)}`} /> : <ListPlus size={20} />}</span>;
}
export function BulkImport({ data }: { data: JournalData }) {
  const params = useSearchParams(), router = useRouter(), kind: Kind = params.get("kind") === "book" ? "book" : "movie";
  const [status, setStatus] = useState<Status>(validStatus(kind, params.get("status")) ? params.get("status") as Status : "completed");
  const [text, setText] = useState(""), [format, setFormat] = useState<"text" | "csv">("text"), [label, setLabel] = useState("");
  const [batch, setBatch] = useState<ImportBatch | null>(null), [history, setHistory] = useState<ImportSummary[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<"match" | "commit" | null>(null), [message, setMessage] = useState(""), [filter, setFilter] = useState<ImportState | "all">("all"), [page, setPage] = useState(1), [inspect, setInspect] = useState<string | null>(null);
  const continueRun = useRef(false), mounted = useRef(true), newId = useRef<string | null>(null);
  const batchId = params.get("batch"), draftKey = `tongye-import-draft:${data.me.id}:${kind}`, draftReady = useRef(false);
  useEffect(() => { mounted.current = true; const hide = () => { if (document.visibilityState === "hidden") continueRun.current = false; }; document.addEventListener("visibilitychange", hide); return () => { mounted.current = false; continueRun.current = false; document.removeEventListener("visibilitychange", hide); }; }, []);
  useEffect(() => { draftReady.current = false; try { const saved = JSON.parse(localStorage.getItem(draftKey) || "null"); if (saved) { setText(saved.text || ""); setFormat(saved.format === "csv" ? "csv" : "text"); setLabel(saved.label || ""); } else { setText(""); setFormat("text"); setLabel(""); } } catch { /* A malformed draft should not prevent opening the importer. */ } draftReady.current = true; }, [draftKey]);
  useEffect(() => { if (draftReady.current) { try { localStorage.setItem(draftKey, JSON.stringify({ text, format, label })); } catch { /* Server tasks remain durable if browser storage is unavailable. */ } } }, [text, format, label, draftKey]);
  useEffect(() => { let active = true; setError(""); void call(undefined, batchId ? `?id=${encodeURIComponent(batchId)}` : "").then(r => { if (!active) return; if (r.batch) setBatch(r.batch); else { setBatch(null); setHistory(r.batches ?? []); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; continueRun.current = false; }; }, [batchId]);
  function openBatch(id: string | null) { continueRun.current = false; setFilter("all"); setPage(1); setInspect(null); const next = new URLSearchParams({ kind, status }); if (id) next.set("batch", id); window.history.pushState(null, "", `/imports?${next}`); }
  function updateItem(item: ImportItem) { setBatch(b => b ? { ...b, items: b.items.map(i => i.id === item.id ? item : i) } : b); }
  async function refresh() { if (batch) { const r = await call(undefined, `?id=${batch.id}`); setBatch(r.batch!); } }
  async function operate(body: unknown) {
    setBusy(true); setError("");
    try { const r = await call(body); if (r.item) updateItem(r.item); if (r.batch) setBatch(r.batch); return r.item; }
    catch (e) { setError((e as Error).message); return undefined; } finally { setBusy(false); }
  }
  async function execute(operation: "match" | "commit", start = batch) {
    if (!start || running) return;
    setError(""); setRunning(operation); continueRun.current = true;
    try {
      let working = (await call(undefined, `?id=${start.id}`)).batch!;
      const applicable = (i: ImportItem) => operation === "match" ? i.state === "pending" : i.selected && ["ready", "existing"].includes(i.state);
      while (continueRun.current) {
        const remaining = working.items.filter(applicable); if (!remaining.length) break;
        const next = remaining.filter(i => i.leaseUntil <= Date.now() && i.retryAt <= Date.now()).slice(0, 2);
        if (!next.length) { setMessage("正在等待信源或上一项处理完成，可以随时暂停。"); await new Promise(r => setTimeout(r, 1000)); working = (await call(undefined, `?id=${start.id}`)).batch!; continue; }
        setMessage(operation === "match" ? `正在核对 ${next.map(i => i.input.title).join("、")}` : `正在保存 ${next.map(i => i.catalog?.title || i.input.title).join("、")}`);
        const results = await Promise.allSettled(next.map(i => call({ op: "step", batchId: start.id, itemId: i.id, operation })));
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          const item = result.value.item!; working = { ...working, items: working.items.map(i => i.id === item.id ? item : i) };
        }
        if (mounted.current) setBatch(working);
        await new Promise(r => setTimeout(r, 500));
      }
      if (mounted.current) { setBatch((await call(undefined, `?id=${start.id}`)).batch!); setMessage(continueRun.current ? operation === "match" ? "匹配完成。核对例外项后，导入已勾选的作品。" : "本次保存完成，结果已留在这份任务中。" : "已暂停。再次打开这份任务即可继续。"); router.refresh(); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { continueRun.current = false; if (mounted.current) setRunning(null); }
  }
  async function create() {
    setBusy(true); setError("");
    try {
      const inputs = parseImport(text, format, kind, status); newId.current ??= crypto.randomUUID();
      const { batch: created } = await call({ op: "create", id: newId.current, kind, inputs, label });
      newId.current = null; setBatch(created!); openBatch(created!.id);
      setMessage("清单已保存。点击“匹配资料”开始自动检索。");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const actualKind = batch?.kind ?? kind, title = actualKind === "book" ? "书单" : "片单";
  const displayed = (batch?.items ?? []).filter(i => filter === "all" || i.state === filter), pageCount = Math.max(1, Math.ceil(displayed.length / 50)), currentPage = Math.min(page, pageCount);
  const eligible = batch?.items.filter(i => ["ready", "existing"].includes(i.state) && i.selected).length ?? 0;
  const count = (state: ImportState) => batch?.items.filter(i => i.state === state).length ?? 0;
  const inspecting = batch?.items.find(i => i.id === inspect);
  return <div className={`bulk-page ${actualKind}`}>
    <Link className="text-link import-back" href={`/${actualKind === "book" ? "books" : "movies"}?view=${data.me.id}&status=${status}`}><ArrowLeft size={15} />回到我的{actualKind === "book" ? "书房" : "电影馆"}</Link>
    <header className="page-heading"><div><h1 className="serif">批量收藏</h1><p>把散落的{title}，慢慢收进 {data.me.name} 的清单。</p></div>{batch && <Button variant="secondary" disabled={!!running || busy} onClick={() => openBatch(null)}><ListPlus size={16} />新的{title}</Button>}</header>
    <ErrorNotice text={error} />
    {!batch && <div className="import-start"><section className="import-input-panel"><div className="import-step"><span>01</span><h2>带来你的{title}</h2></div><div className="import-form-row"><label>清单名称<input maxLength={100} placeholder="例如：这些年看过的电影" value={label} onChange={e => { setLabel(e.target.value); newId.current = null; }} /></label><label>默认状态<select value={status} onChange={e => { setStatus(e.target.value as Status); newId.current = null; }}>{statuses(kind).map(s => <option key={s} value={s}>{statusLabels[kind][s]}</option>)}</select></label></div><div className="import-text-field"><label htmlFor="import-list-text">{format === "csv" ? "CSV 内容" : "作品名称"}</label><textarea id="import-list-text" rows={12} value={text} onChange={e => { setText(e.target.value); newId.current = null; }} placeholder={kind === "book" ? "活着\n小王子\n百年孤独\n\n每行一本；有 ISBN 的书单可以使用 CSV。" : "星际穿越 (2014)\n心灵奇旅\n机器人之梦\n\n每行一部，也可以粘贴带书名号的片单。"} /></div><div className="import-input-tools"><label className="text-link file-button"><FileUp size={15} />上传 CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setError("文件过大，请拆成每批最多 500 条。"); return; } setText(await file.text()); setFormat("csv"); newId.current = null; }} /></label><a className="text-link" href="/api/imports?format=template"><Download size={15} />下载模板</a>{format === "csv" && <button className="text-link" onClick={() => setFormat("text")}>切换为逐行清单</button>}</div><p className="import-hint">每批最多 500 条。评分、感受和未知日期留空；已有的个人记录会保留。</p><Button busy={busy} disabled={!text.trim()} onClick={() => void create()}>检查清单<ArrowRight size={16} /></Button></section><aside className="import-aside"><div className="import-step"><span>02</span><h2>资料自动找</h2></div><p>封面、年份、导演或作者，从作品目录取得。同名作品和不同版本，留给你最后确认。</p><div className="import-step"><span>03</span><h2>只处理例外</h2></div><p>确认后统一保存。关闭页面会暂停，回来可以继续，已经成功的作品不会再加一遍。</p>{history.filter(b => b.kind === kind).length > 0 && <div className="import-history"><h3>最近的导入</h3>{history.filter(b => b.kind === kind).map(b => <button key={b.id} onClick={() => openBatch(b.id)}><span>{b.label}<small>{b.done} / {b.total} 条已处理</small></span><ArrowRight size={16} /></button>)}</div>}</aside></div>}
    {batch && <>
      <section className="import-batch-heading"><div><h2 className="serif">{batch.label}</h2><p>{batch.items.length} 条 · {count("done")} 条已处理 · {count("skipped")} 条已跳过</p></div><a className="text-link" href={`/api/imports?id=${batch.id}&format=csv`}><Download size={15} />导出结果</a></section>
      <div className="import-progress" role="progressbar" aria-label="匹配进度" aria-valuenow={batch.items.length - count("pending")} aria-valuemin={0} aria-valuemax={batch.items.length}><span style={{ width: `${100 * (batch.items.length - count("pending")) / batch.items.length}%` }} /></div>
      <div className="import-controls">{running ? <Button variant="secondary" onClick={() => { continueRun.current = false; setMessage("正在暂停，当前处理结束后会保存进度。"); }}><Pause size={15} />暂停</Button> : <><Button variant="secondary" disabled={busy || !count("pending")} onClick={() => void execute("match")}><Search size={15} />匹配资料 {count("pending") || ""}</Button><Button disabled={busy || !eligible} onClick={() => void execute("commit")}><Check size={16} />导入已选 {eligible} 条</Button></>}<button className="text-link" disabled={busy || !!running} onClick={() => void refresh().catch(e => setError(e.message))}><RefreshCw size={14} />刷新进度</button><label className="import-uniform">统一未处理状态<select aria-label="统一未处理状态" defaultValue="" disabled={busy || !!running} onChange={async e => { const value = e.target.value; if (!value) return; try { const latest = (await call(undefined, `?id=${batch.id}`)).batch!; await operate({ op: "status", batchId: batch.id, updatedAt: latest.updatedAt, status: value }); } catch (e) { setError((e as Error).message); } }}><option value="">保持各自状态</option>{statuses(actualKind).map(s => <option key={s} value={s}>{statusLabels[actualKind][s]}</option>)}</select></label></div>
      <p className="import-live" role="status">{message || "可勾选明确匹配的作品，一次导入；未确定的条目可以稍后再处理。"}</p>
      <nav className="import-filters" aria-label="导入结果筛选">{(["all", "pending", "ready", "existing", "confirm", "not_found", "failed", "done", "skipped"] as const).map(s => <button key={s} aria-pressed={filter === s} className={filter === s ? "selected" : ""} onClick={() => { setFilter(s); setPage(1); }}>{s === "all" ? "全部" : importStateLabels[s]}<span>{s === "all" ? batch.items.length : count(s)}</span></button>)}</nav>
      <div className="import-rows">{displayed.slice((currentPage - 1) * 50, currentPage * 50).map(row => <article key={row.id} className="import-row" data-import-id={row.id}><input type="checkbox" aria-label={`选择${row.input.title}`} checked={row.selected} disabled={busy || !!running || !["ready", "existing"].includes(row.state)} onChange={e => void operate({ op: "edit", batchId: batch.id, itemId: row.id, revision: row.revision, command: "select", selected: e.target.checked })} /><span className="import-index">{String(row.position).padStart(2, "0")}</span><CatalogThumb item={row.catalog} assetId={data.entries.find(e => e.id === row.entryId)?.coverId} /><div className="import-row-copy"><h3>{row.catalog?.title || row.input.title}</h3><p>{row.catalog ? [row.catalog.creator, row.catalog.year, row.catalog.metadata.publisher].filter(Boolean).join(" · ") : [row.input.creator, row.input.year].filter(Boolean).join(" · ") || "等待查找作品资料"}</p>{row.outcome && <small>{row.outcome}</small>}{(row.error || row.warning) && <small className="import-row-warning">{row.error || row.warning}</small>}</div><span className={`import-state ${row.state}`}>{importStateLabels[row.state]}</span><span className="import-own-status">{statusLabels[actualKind][row.input.status]}</span><div className="import-row-actions">{row.state === "done" ? <>{row.entryId && <Link className="text-link" href={`/entry/${row.entryId}`}>查看</Link>}{row.warning && <button className="text-link" disabled={busy || !!running} onClick={() => void operate({ op: "step", batchId: batch.id, itemId: row.id, operation: "cover" })}>重试补图</button>}</> : <button className="text-link" disabled={!!running || busy} onClick={() => setInspect(row.id)}>核对<ArrowRight size={14} /></button>}</div></article>)}{!displayed.length && <p className="quiet-empty">这一栏暂时没有作品。</p>}</div>
      {pageCount > 1 && <nav className="collection-pagination" aria-label="导入清单分页"><Button variant="ghost" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>上一页</Button><span>{currentPage} / {pageCount}</span><Button variant="ghost" disabled={currentPage === pageCount} onClick={() => setPage(p => p + 1)}>下一页</Button></nav>}
      <p className="import-hint">已读／已看的已有记录不会被降级，已有日期与感受会保留。移入回收站的作品需要先恢复。</p>
    </>}
    <Modal open={!!inspecting} onOpenChange={v => { if (!v) setInspect(null); }} title="核对这部作品" description="确认名称、年份或版本，再收进自己的清单。" drawer>{inspecting && batch && <InspectImport key={inspecting.id} row={inspecting} batch={batch} data={data} busy={busy} failure={error} operate={operate} close={() => setInspect(null)} />}</Modal>
  </div>;
}
function InspectImport({ row, batch, data, busy, failure, operate, close }: { row: ImportItem; batch: ImportBatch; data: JournalData; busy: boolean; failure: string; operate: (body: unknown) => Promise<ImportItem | undefined>; close: () => void }) {
  const [draft, setDraft] = useState<ImportInput>(row.input), [query, setQuery] = useState(row.input.isbn || row.input.title), [candidates, setCandidates] = useState(row.candidates), [searching, setSearching] = useState(false), [error, setError] = useState("");
  const common = { batchId: batch.id, itemId: row.id, revision: row.revision };
  async function choose(item: CatalogItem, extra = {}) { const result = await operate({ ...common, op: "choose", ref: item.ref, ...extra }); if (result && ["ready", "existing"].includes(result.state)) close(); }
  async function search() { setSearching(true); setError(""); try { const r = await fetch(`/api/catalog/search?${new URLSearchParams({ kind: batch.kind, q: query })}`); const result = await r.json(); if (!r.ok) throw new Error(result.error); setCandidates(result.items); if (result.warning) setError(result.warning); } catch (e) { setError((e as Error).message || "搜索暂不可用，请重试。"); } finally { setSearching(false); } }
  const local = row.catalog ? data.entries.filter(e => e.kind === batch.kind && matchText(e.title) === matchText(row.catalog!.title)) : [];
  return <div className="import-inspect"><ErrorNotice text={error || failure || row.error} /><div className="import-form-row"><label>名称<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>年份<input type="number" value={draft.year ?? ""} onChange={e => setDraft({ ...draft, year: e.target.value ? Number(e.target.value) : null })} /></label></div><label>{batch.kind === "book" ? "作者" : "导演"}<input value={draft.creator} onChange={e => setDraft({ ...draft, creator: e.target.value })} /></label>{batch.kind === "book" && <label>ISBN<input value={draft.isbn} onChange={e => setDraft({ ...draft, isbn: e.target.value })} /></label>}<div className="import-form-row"><label>我的状态<select value={draft.status} onChange={e => { const status = e.target.value as Status; setDraft({ ...draft, status, startedOn: status === "planned" ? null : draft.startedOn, completedOn: status === "completed" ? draft.completedOn : null }); }}>{statuses(batch.kind).map(s => <option key={s} value={s}>{statusLabels[batch.kind][s]}</option>)}</select></label>{batch.kind === "book" && draft.status !== "planned" && <label>开始日期<input type="date" value={draft.startedOn ?? ""} onChange={e => setDraft({ ...draft, startedOn: e.target.value || null })} /></label>}{draft.status === "completed" && <label>完成日期<input type="date" value={draft.completedOn ?? ""} onChange={e => setDraft({ ...draft, completedOn: e.target.value || null })} /></label>}</div><Button variant="secondary" busy={busy} onClick={async () => { const result = await operate({ ...common, op: "edit", command: "edit", input: draft }); if (result) close(); }}>保存这项修改</Button>
      {row.catalog && <section className="import-current"><h3>目前选择</h3><div className="catalog-pick-row"><CatalogThumb item={row.catalog} /><span className="catalog-result-copy"><strong>{row.catalog.title}</strong><small>{[row.catalog.creator, row.catalog.year, row.catalog.metadata.publisher].filter(Boolean).join(" · ")}</small></span></div><button className="text-link" disabled={busy} onClick={() => void choose(row.catalog!, { existingId: row.expected?.entryId, newWork: row.newWork })}>重新检查这份资料</button>{row.state === "confirm" && local.map(e => <button key={e.id} className="button secondary" disabled={busy || !!e.deletedAt} onClick={() => void choose(row.catalog!, { existingId: e.id })}>复用已有作品：{e.title} {e.year ?? ""}</button>)}{row.state === "confirm" && local.length > 0 && <button className="text-link" disabled={busy} onClick={() => void choose(row.catalog!, { newWork: true })}>这是同名的另一部作品</button>}</section>}
      <form className="catalog-search-input" onSubmit={e => { e.preventDefault(); void search(); }}><Search size={16} /><input aria-label="重新检索作品" value={query} onChange={e => setQuery(e.target.value)} /><Button busy={searching} disabled={!query.trim()} type="submit">搜索</Button></form><div className="catalog-search-group">{candidates.map(item => <button key={`${item.ref.source}:${item.ref.id}`} className="catalog-pick-row" disabled={busy} onClick={() => void choose(item)}><CatalogThumb item={item} /><span className="catalog-result-copy"><strong>{item.title}</strong><small>{[item.creator, item.year, item.metadata.publisher, item.metadata.translator].filter(Boolean).join(" · ")}</small>{item.metadata.isbn && <small>ISBN {item.metadata.isbn}</small>}<small>{catalogSources[item.ref.source].name}</small></span><ArrowRight size={15} /></button>)}</div><div className="import-inspect-footer"><Button variant="ghost" disabled={busy} onClick={async () => { const result = await operate({ ...common, op: "edit", command: "skip" }); if (result) close(); }}>先跳过这一项</Button><Button variant="secondary" onClick={close}>稍后核对</Button></div>
    </div>;
}
