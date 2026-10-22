"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, BookOpen, Film, Search } from "lucide-react";
import { catalogKey, catalogSources, matchesCatalogEntry, type CatalogImport, type CatalogItem, type CatalogSearch } from "@/lib/catalog-metadata";
import { normalizeTitle } from "@/lib/domain";
import type { Entry, Kind } from "@/lib/types";
import { Button, Cover, ErrorNotice } from "./ui";

async function readCatalogResponse(response: Response) {
  try { return await response.json(); }
  catch { throw new Error("暂时未能读取服务响应，请重试或手动填写。已有输入会保留。"); }
}

function ResultCover({ item }: { item: CatalogItem }) {
  const [broken, setBroken] = useState(false);
  return <span className={`catalog-result-cover ${item.ref.kind}`}>
    {item.hasCover && !broken ? <img src={`/api/catalog/cover?${new URLSearchParams(item.ref)}`} alt="" loading="lazy" onError={() => setBroken(true)} /> : item.ref.kind === "movie" ? <Film size={20} /> : <BookOpen size={20} />}
  </span>;
}
export function CatalogPicker({ kind, entries, initialQuery, onExisting, onImport, onManual, onCancel }: {
  kind: Kind; entries: Entry[]; initialQuery: string; onExisting: (id: string) => void;
  onImport: (result: CatalogImport) => void; onManual: (query: string) => void; onCancel: () => void;
}) {
  const inputId = useId(), [query, setQuery] = useState(initialQuery), [result, setResult] = useState<CatalogSearch | null>(null);
  const [busy, setBusy] = useState(false), [selecting, setSelecting] = useState<string | null>(null), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null), requestId = useRef(0), selectingRef = useRef(false);
  const local = query.trim() ? entries.filter(e => !e.deletedAt && e.kind === kind && normalizeTitle(`${e.title} ${e.creator} ${e.metadata?.isbn ?? ""}`).includes(normalizeTitle(query))).slice(0, 5) : [];
  useEffect(() => () => { controller.current?.abort(); requestId.current++; }, []);
  async function search() {
    if (!query.trim() || selectingRef.current) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const current = ++requestId.current; setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/catalog/search?${new URLSearchParams({ kind, q: query.trim() })}`, { signal: abort.signal });
      const data = await readCatalogResponse(response); if (!response.ok) throw new Error(data.error || "暂时未能搜索，请重试。");
      if (current === requestId.current) setResult(data);
    } catch (e) { if (current === requestId.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : "网络暂不可用。可以重试，或手动填写。"); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  async function choose(item: CatalogItem) {
    if (selectingRef.current) return;
    const existing = entries.find(e => !e.deletedAt && matchesCatalogEntry(e, item));
    if (existing) { onExisting(existing.id); return; }
    selectingRef.current = true; setSelecting(catalogKey(item.ref)); setError("");
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/catalog/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.ref), signal: abort.signal });
      const data = await readCatalogResponse(response); if (!response.ok) throw new Error(data.error || "读取资料失败，请重试。");
      if (data.existingId && entries.some(e => e.id === data.existingId)) onExisting(data.existingId); else onImport(data);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "暂时未能读取作品。可以重试，或手动填写。"); }
    finally { selectingRef.current = false; setSelecting(null); }
  }
  return <form className="catalog-picker" onSubmit={e => { e.preventDefault(); void search(); }}>
    <label className="field-label" htmlFor={inputId}>{kind === "book" ? "搜索书名或 ISBN" : "搜索电影名称"}</label>
    <div className="catalog-search-input"><Search size={18} /><input id={inputId} value={query} disabled={!!selecting} maxLength={120} autoFocus autoComplete="off" placeholder={kind === "book" ? "例如：活着、9787506365437" : "例如：星际穿越"} onChange={e => { setQuery(e.target.value); controller.current?.abort(); requestId.current++; setBusy(false); setResult(null); setError(""); }} /><Button type="submit" busy={busy} disabled={!query.trim() || !!selecting}>搜索</Button></div>
    <p className="catalog-search-hint">选中作品后，自动填入资料与封面。{kind === "book" ? "同名书籍请留意作者和版本。" : "同名电影请留意导演和年份。"}</p>
    <div aria-live="polite" role="status" className="catalog-search-status">{selecting ? "正在读取作品资料与封面…" : busy ? "正在查找作品…" : result ? result.items.length ? `找到 ${result.items.length} 个结果，请选择对应作品。` : "没有找到匹配作品。试试其他名称、作者或 ISBN，也可以手动填写。" : ""}</div>
    {!!local.length && <section className="catalog-search-group"><h3>空间里已有</h3>{local.map(entry => <button type="button" className="catalog-pick-row local-result" key={entry.id} disabled={!!selecting} onClick={() => onExisting(entry.id)}><Cover entry={entry} /><span className="catalog-result-copy"><strong>{entry.title}</strong><small>{[entry.creator, entry.year, entry.metadata?.publisher].filter(Boolean).join(" · ") || "已有作品资料"}</small><span className="catalog-result-source">沿用作品资料，只填写你的记录</span></span><ArrowRight size={16} /></button>)}</section>}
    {result && result.items.length > 0 && <section className="catalog-search-group"><h3>作品目录</h3>{result.items.map(item => {
      const existing = entries.find(e => !e.deletedAt && matchesCatalogEntry(e, item));
      return <button type="button" className="catalog-pick-row" disabled={!!selecting} key={catalogKey(item.ref)} onClick={() => { void choose(item); }} aria-label={`选择 ${item.title}${item.year ? ` ${item.year}` : ""}${item.metadata.publisher ? ` ${item.metadata.publisher}` : ""}`}>
        <ResultCover item={item} /><span className="catalog-result-copy"><strong>{item.title}</strong><small>{[item.creator, item.year, item.metadata.publisher].filter(Boolean).join(" · ") || "基本资料待补充"}</small>{item.metadata.isbn && <small className="catalog-result-isbn">ISBN {item.metadata.isbn}</small>}<span className="catalog-result-source">{existing ? "空间里已有 · 使用已有作品" : catalogSources[item.ref.source].name}</span></span><ArrowRight size={16} />
      </button>;
    })}</section>}
    {result?.warning && <p className="field-hint">{result.warning}</p>}
    <ErrorNotice text={error} />
    <div className="catalog-picker-footer"><button type="button" className="text-link" disabled={!!selecting} onClick={() => onManual(query)}>没有找到？手动填写</button><Button type="button" variant="ghost" onClick={onCancel}>取消</Button></div>
  </form>;
}
