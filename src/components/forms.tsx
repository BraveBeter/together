"use client";
import { useEffect, useId, useState, useTransition, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Link as LinkIcon, Plus, Search, X } from "lucide-react";
import { personalRecordCommand, saveEntry, saveMemory, savePersonalRecord, saveTogether, saveRecommendation, saveReview } from "@/lib/actions";
import { dateLabel, normalizeTitle, statusLabels, statuses } from "@/lib/domain";
import type { Entry, EntryLink, JournalData, Kind, Memory, Result, Review, Status } from "@/lib/types";
import { catalogFacts, catalogSources, type CatalogImport, type CatalogMetadata } from "@/lib/catalog-metadata";
import { Button, ErrorNotice } from "./ui";
import { CatalogPicker } from "./catalog-picker";

export function UploadField({ ids, onChange, multiple = false, label = "封面", onBusyChange }: { ids: string[]; onChange: (ids: string[]) => void; multiple?: boolean; label?: string; onBusyChange?: (busy: boolean) => void }) {
  const inputId = useId(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function upload(files: File[]) {
    setError(""); if (!files.length || busy) return;
    if (multiple && ids.length + files.length > 8) { setError("一段回忆最多添加 8 张照片。"); return; }
    setBusy(true); onBusyChange?.(true); const added: string[] = [];
    try {
      for (const file of (multiple ? files : files.slice(0, 1))) {
        if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB。");
        const body = new FormData(); body.append("file", file);
        const response = await fetch("/api/assets", { method: "POST", body });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "上传失败，请重试。");
        added.push(data.id);
      }
      onChange(multiple ? [...ids, ...added] : added);
    } catch (e) { if (multiple && added.length) onChange([...ids, ...added]); setError(e instanceof Error ? e.message : "上传失败，请重试。"); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  function paste(e: ClipboardEvent) { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); void upload(files); } }
  return <div className="upload-field" onPaste={paste} tabIndex={0} aria-label={`${label}上传区域，可粘贴图片`}>
    <span className="field-label">{label}</span><div className="upload-items">{ids.map(assetId => <div className="upload-preview" key={assetId}><img src={`/api/assets/${assetId}`} alt={`${label}预览`} /><button type="button" className="remove-image" onClick={() => onChange(ids.filter(i => i !== assetId))} aria-label={`移除${label}`}><X size={13} /></button></div>)}
      <label className={`upload-drop ${busy ? "disabled" : ""}`} htmlFor={inputId}><ImagePlus size={22} /><span>{busy ? "正在上传…" : ids.length && !multiple ? "更换封面" : "选择图片"}</span><small>也可以点此后粘贴</small></label>
      <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} disabled={busy} className="sr-only" onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div><small className="field-hint">JPG、PNG、WebP · 每张不超过 10 MB</small><ErrorNotice text={error} />
  </div>;
}
function useSave() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  async function run<T>(task: () => Promise<Result<T>>, success: (data: T) => void) {
    setBusy(true); setError(""); setConflict(false);
    try { const r = await task(); if (!r.ok) { setError(r.error); setConflict(!!r.conflict); } else { router.refresh(); success(r.data); } }
    catch { setError("网络暂时不可用，输入已保留，请重试。"); } finally { setBusy(false); }
  }
  return { busy, error, conflict, run, refresh: () => router.refresh() };
}
export function useDraftVersion(latest: number) {
  const [expected, setExpected] = useState(latest);
  const [requested, setRequested] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (requested && !refreshing) { setExpected(latest); setRequested(false); }
  }, [requested, refreshing, latest]);
  return { expected, showLatest, loading: requested || refreshing, saved: () => setExpected(value => value + 1), refresh: () => {
    setExpected(latest); setShowLatest(true); setRequested(true); startRefresh(() => router.refresh());
  } };
}
export function EntryForm({ data, entry, initialKind = "movie", initialStatus = "planned", onClose }: { data: JournalData; entry?: Entry; initialKind?: Kind; initialStatus?: Status; onClose: () => void }) {
  const router = useRouter(), formId = useId(), save = useSave(), version = useDraftVersion(entry?.revision ?? 0);
  const [recordId] = useState(() => entry?.id ?? crypto.randomUUID()), kind = entry?.kind ?? initialKind;
  const [title, setTitle] = useState(entry?.title ?? ""), [creator, setCreator] = useState(entry?.creator ?? ""), [year, setYear] = useState(entry?.year?.toString() ?? "");
  const [summary, setSummary] = useState(entry?.summary ?? ""), [coverId, setCoverId] = useState<string | null>(entry?.coverId ?? null), [tags, setTags] = useState(entry?.tags.join("、") ?? "");
  const [links, setLinks] = useState<EntryLink[]>(entry?.links ?? []), [uploading, setUploading] = useState(false), [selectedId, setSelectedId] = useState<string | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [mode, setMode] = useState<"search" | "form">(entry ? "form" : "search");
  const [metadata, setMetadata] = useState<CatalogMetadata | null>(entry?.metadata ?? null), [metadataWarning, setMetadataWarning] = useState("");
  const [state, setState] = useState<PersonalDraft>({ status: initialStatus, startedOn: "", completedOn: "", pinned: false, rating: "", body: "" });
  const duplicates = !entry && title.trim() ? data.entries.filter(e => !e.deletedAt && e.kind === kind && normalizeTitle(e.title) === normalizeTitle(title)) : [];
  const selected = data.entries.find(e => e.id === selectedId);
  if (selected) return <PersonalRecordForm data={data} entry={selected} initialStatus={initialStatus} initialDraft={state} onClose={onClose} onBack={() => setSelectedId(null)} />;
  function fillFromCatalog(result: CatalogImport) {
    const item = result.item;
    setTitle(item.title); setCreator(item.creator); setYear(item.year?.toString() ?? ""); setSummary(item.summary);
    setCoverId(result.coverId); setLinks(item.links); setMetadata(item.metadata); setMetadataWarning(result.warning); setAllowDuplicate(false); setMode("form");
  }
  if (mode === "search") return <CatalogPicker kind={kind} entries={data.entries} initialQuery={title} onExisting={setSelectedId} onImport={fillFromCatalog} onCancel={entry || title ? () => setMode("form") : onClose} onManual={query => { if (!title) setTitle(query); setMode("form"); }} />;
  const field = (name: string) => `${formId}-${name}`;
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); if (uploading) return; void save.run(() => saveEntry({ id: recordId, revision: version.expected, create: !entry, kind, title, creator, year: year ? Number(year) : null, summary, coverId, tags: tags.split(/[、,，]/).map(t => t.trim()).filter(Boolean), links: links.filter(l => l.url.trim()), allowDuplicate, metadata, ...(!entry ? { personal: personalPayload(kind, state, 0) } : {}) }), result => { onClose(); router.push(`/entry/${result.id}`); }); }}>
    {!entry && <div className="catalog-selected-top"><span>{metadata ? "作品资料已填入" : "手动填写作品资料"}</span><button type="button" className="text-link" disabled={save.busy || uploading} onClick={() => setMode("search")}><Search size={14} />{metadata ? "重新选择" : "搜索自动填充"}</button></div>}
    {metadata && !entry && <div className="catalog-selected-work">{coverId && <img src={`/api/assets/${coverId}`} alt={`${title}封面`} />}<div><h3 className="serif">{title}</h3><p>{[creator, year, metadata.publisher].filter(Boolean).join(" · ")}</p>{metadata.isbn && <small>ISBN {metadata.isbn}</small>}<small>资料来自 {catalogSources[metadata.source].name}</small></div></div>}
    {metadataWarning && <p className="catalog-import-warning" role="status">{metadataWarning}</p>}
    <details className="catalog-objective-fields" open={!metadata || !!entry || duplicates.length > 0}><summary>{metadata ? "查看或修正作品资料" : "作品资料"}</summary>
    <div className="field"><label htmlFor={field("title")}>{kind === "movie" ? "电影名称" : "书名"} <span className="required">*</span></label><input id={field("title")} value={title} onChange={e => { setTitle(e.target.value); setAllowDuplicate(false); }} required maxLength={200} autoFocus placeholder={kind === "movie" ? "电影名称" : "书名"} /></div>
    {!!duplicates.length && <div className="duplicate-notice"><strong>空间里已有同名作品</strong>{duplicates.map(d => <button type="button" className="duplicate-choice" key={d.id} onClick={() => setSelectedId(d.id)}><span><strong>{d.title}</strong><small>{[d.creator, d.year].filter(Boolean).join(" · ") || "已有作品资料"}</small></span><span>使用已有作品 →</span></button>)}<label className="checkbox-row"><input type="checkbox" checked={allowDuplicate} onChange={e => setAllowDuplicate(e.target.checked)} />同名不同作品，仍然新建</label></div>}
    <div className="form-row"><div className="field"><label htmlFor={field("creator")}>{kind === "movie" ? "导演" : "作者"}</label><input id={field("creator")} value={creator} onChange={e => setCreator(e.target.value)} maxLength={200} placeholder="选填" /></div><div className="field"><label htmlFor={field("year")}>年份</label><input id={field("year")} type="number" min="1" max="2200" value={year} onChange={e => setYear(e.target.value)} placeholder="选填" /></div></div>
    <UploadField ids={coverId ? [coverId] : []} onChange={ids => setCoverId(ids[0] ?? null)} onBusyChange={setUploading} />
    <div className="field"><label htmlFor={field("summary")}>作品简介</label><textarea id={field("summary")} rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={10000} placeholder="选填" /></div>
    {metadata && <dl className="catalog-facts">{catalogFacts(metadata).map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
    </details>
    {!entry && <PersonalFields formId={formId} kind={kind} value={state} onChange={setState} />}
    <details className="form-details"><summary>标签与相关链接</summary><div className="field"><label htmlFor={field("tags")}>标签</label><input id={field("tags")} value={tags} onChange={e => setTags(e.target.value)} placeholder="用顿号分隔，如文学、周末" /></div><div className="field-label">相关链接 <button type="button" className="text-link" onClick={() => setLinks([...links, { label: "", url: "" }])}><Plus size={14} />添加链接</button></div>{links.map((link, index) => <div className="link-input" key={index}><LinkIcon size={16} /><input aria-label={`链接${index + 1}名称`} placeholder="名称" value={link.label} onChange={e => setLinks(links.map((l, i) => i === index ? { ...l, label: e.target.value } : l))} /><input aria-label={`链接${index + 1}地址`} type="url" placeholder="https://" value={link.url} onChange={e => setLinks(links.map((l, i) => i === index ? { ...l, url: e.target.value } : l))} /><button type="button" className="icon-button" aria-label="移除链接" onClick={() => setLinks(links.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</details>
    <ErrorNotice text={save.error} conflict={save.conflict} refresh={version.refresh} />
    {version.showLatest && entry && <div className="latest-record"><strong>服务器最新资料</strong><p>{entry.title} · {entry.creator} · {entry.year}</p><p>{entry.summary || "暂无简介"}</p>{entry.coverId && <img className="latest-cover" src={`/api/assets/${entry.coverId}`} alt="最新封面" />}<p>标签：{entry.tags.join("、") || "无"}</p>{entry.links.map(l => <p key={l.url}>{l.label}：{l.url}</p>)}<small>对照草稿合并，再保存一次。</small></div>}
    <div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button type="submit" disabled={uploading || !entry && !!duplicates.length && !allowDuplicate} busy={save.busy || version.loading}><Check size={16} />{entry ? "保存作品资料" : "加入我的清单"}</Button></div>
  </form>;
}
type PersonalDraft = { status: Status; startedOn: string; completedOn: string; pinned: boolean; rating: string; body: string };
function personalPayload(kind: Kind, value: PersonalDraft, reviewRevision: number) {
  return { status: value.status, startedOn: kind === "book" && value.status !== "planned" ? value.startedOn || null : null, completedOn: value.status === "completed" ? value.completedOn || null : null, pinned: value.pinned, review: { revision: reviewRevision, rating: value.rating ? Number(value.rating) : null, body: value.body } };
}
function PersonalFields({ formId, kind, value, onChange }: { formId: string; kind: Kind; value: PersonalDraft; onChange: (v: PersonalDraft) => void }) {
  const field = (key: string) => `${formId}-${key}`;
  return <div className="personal-fields"><div className="field"><label htmlFor={field("status")}>我的{kind === "book" ? "阅读" : "观看"}状态</label><select id={field("status")} value={value.status} onChange={e => onChange({ ...value, status: e.target.value as Status })}>{statuses(kind).map(s => <option key={s} value={s}>{statusLabels[kind][s]}</option>)}</select></div>
    {value.status !== "planned" && <><div className="form-row">{kind === "book" && <div className="field"><label htmlFor={field("start")}>我的开始日期</label><input id={field("start")} type="date" value={value.startedOn} onChange={e => onChange({ ...value, startedOn: e.target.value })} /></div>}{value.status === "completed" && <div className="field"><label htmlFor={field("end")}>我的{kind === "book" ? "读完" : "看完"}日期</label><input id={field("end")} type="date" value={value.completedOn} onChange={e => onChange({ ...value, completedOn: e.target.value })} /></div>}</div><p className="field-hint">日期选填。记不清就留空，不会以录入当天代替。</p></>}
    <div className="field"><label htmlFor={field("rating")}>我的评分</label><select id={field("rating")} value={value.rating} onChange={e => onChange({ ...value, rating: e.target.value })}><option value="">暂不评分</option>{Array.from({ length: 10 }, (_, i) => (10 - i) / 2).map(v => <option value={v} key={v}>{v.toFixed(1)} 分</option>)}</select></div>
    <div className="field"><label htmlFor={field("review")}>我的感受</label><textarea id={field("review")} value={value.body} onChange={e => onChange({ ...value, body: e.target.value })} rows={3} maxLength={10000} placeholder="留下一句话，也可以以后补充。" /></div>
    <label className="checkbox-row"><input type="checkbox" checked={value.pinned} onChange={e => onChange({ ...value, pinned: e.target.checked })} />在我的清单中置顶</label>
  </div>;
}
export function PersonalRecordForm({ data, entry, initialStatus = "planned", initialDraft, onClose, onBack }: { data: JournalData; entry: Entry; initialStatus?: Status; initialDraft?: PersonalDraft; onClose: () => void; onBack?: () => void }) {
  const record = entry.personalRecords.find(r => r.userId === data.me.id), review = data.reviews.find(r => r.entryId === entry.id && r.userId === data.me.id);
  const [state, setState] = useState<PersonalDraft>(!record && !review && initialDraft ? initialDraft : { status: record?.removedAt === null ? record.status : initialStatus, startedOn: record?.startedOn ?? "", completedOn: record?.completedOn ?? "", pinned: record?.pinned ?? false, rating: review?.rating?.toString() ?? "", body: review?.body ?? "" });
  const save = useSave(), version = useDraftVersion(record?.revision ?? 0), reviewVersion = useDraftVersion(review?.revision ?? 0), formId = useId(), router = useRouter();
  const [removing, setRemoving] = useState(false);
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); void save.run(() => savePersonalRecord({ entryId: entry.id, revision: version.expected, ...personalPayload(entry.kind, state, reviewVersion.expected) }), () => { onClose(); router.push(`/entry/${entry.id}`); }); }}>
    {onBack && <button type="button" className="text-link" onClick={onBack}>← 返回新建作品</button>}
    <div className="selected-work"><h3 className="serif">{entry.title}</h3><p>{[entry.creator, entry.year].filter(Boolean).join(" · ") || "沿用已有的作品资料与封面"}</p></div>
    <PersonalFields formId={formId} kind={entry.kind} value={state} onChange={setState} />
    <ErrorNotice text={save.error} conflict={save.conflict} refresh={() => { version.refresh(); reviewVersion.refresh(); }} />
    {version.showLatest && <div className="latest-record"><strong>服务器最新记录</strong><p>{record && !record.removedAt ? statusLabels[entry.kind][record.status] : "未在清单中"}</p><p>开始：{dateLabel(record?.startedOn ?? null)} · 完成：{dateLabel(record?.completedOn ?? null)}</p><p>{record?.pinned ? "已置顶" : "未置顶"} · {review?.rating ?? "未评分"}</p><p>{review?.body || "暂无感受"}</p><small>对照草稿合并，再保存一次。</small></div>}
    {record?.removedAt === null && <div className="remove-personal">{removing ? <><p>只从你的清单移除。对方的记录、作品资料与共同回忆保留，可在回收站恢复。</p><Button variant="danger" type="button" busy={save.busy || version.loading} onClick={() => { void save.run(() => personalRecordCommand({ entryId: entry.id, revision: version.expected, command: "remove" }), onClose); }}>确认移除我的记录</Button><Button variant="ghost" type="button" onClick={() => setRemoving(false)}>取消移除</Button></> : <button className="text-link" type="button" onClick={() => setRemoving(true)}>移除我的记录</button>}</div>}
    <div className="form-actions"><Button type="submit" busy={save.busy || version.loading || reviewVersion.loading}>保存我的记录</Button></div>
  </form>;
}
export function TogetherForm({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const old = entry.together, [confirmed, setConfirmed] = useState(!!old && old.revokedAt === null), [date, setDate] = useState(old?.completedOn ?? "");
  const save = useSave(), version = useDraftVersion(old?.revision ?? 0), formId = useId();
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); void save.run(() => saveTogether({ entryId: entry.id, revision: version.expected, confirmed, completedOn: date || null }), onClose); }}>
    <div className="selected-work"><h3 className="serif">{entry.title}</h3><p>仅记录这次共同经历，不会修改任何人的个人状态。</p></div>
    <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确实一起完成</label>
    <div className="field"><label htmlFor={formId}>共同完成日期</label><input id={formId} type="date" value={date} onChange={e => setDate(e.target.value)} /><small className="field-hint">选填，与两人的个人日期分别保存。</small></div>
    <p className="field-hint">加入挑战、两人均已完成并保留这项确认，才计入挑战。取消确认会重新计算，已有回忆保留。</p>
    <ErrorNotice text={save.error} conflict={save.conflict} refresh={version.refresh} />
    {version.showLatest && <div className="latest-record"><strong>最新共同记录</strong><p>{old && old.revokedAt === null ? "已确认一起完成" : "未确认一起完成"} · {dateLabel(old?.completedOn ?? null)}</p></div>}
    <div className="form-actions"><Button type="submit" busy={save.busy || version.loading}>保存共同记录</Button></div>
  </form>;
}
export function RecommendationForm({ entry, data, onClose }: { entry: Entry; data: JournalData; onClose: () => void }) {
  const old = data.recommendations.find(r => r.entryId === entry.id && r.senderId === data.me.id);
  const [note, setNote] = useState(old?.note ?? ""); const [command] = useState(old?.status === "pending" ? "edit" as const : "send" as const);
  const save = useSave(), version = useDraftVersion(old?.revision ?? 0), formId = useId();
  const other = data.members.find(m => m.id !== data.me.id);
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); void save.run(() => saveRecommendation({ entryId: entry.id, revision: version.expected, note, command }), onClose); }}>
    <div className="selected-work"><h3 className="serif">{entry.title}</h3><p>留给 {other?.name} 的一条推荐</p></div>
    <div className="field"><label htmlFor={formId}>推荐留言</label><textarea id={formId} rows={5} value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="觉得你也会喜欢它，因为……" /><small className="field-hint">选填 · {note.length} / 300 · 与你的短评分开保存</small></div>
    <ErrorNotice text={save.error} conflict={save.conflict} refresh={version.refresh} />{version.showLatest && <div className="latest-record"><strong>最新推荐留言</strong><p>{old?.note || "没有留言"}</p><p>{old?.status === "pending" ? "等待回应" : "推荐已收起"}</p></div>}
    <div className="form-actions"><Button type="submit" busy={save.busy || version.loading}>{command === "edit" ? "保存留言" : old ? "重新推荐" : "留给你"}</Button></div>
  </form>;
}
export function ReviewForm({ entry, review, onClose }: { entry: Entry; review?: Review; onClose: () => void }) {
  const [body, setBody] = useState(review?.body ?? ""); const [rating, setRating] = useState(review?.rating?.toString() ?? ""); const save = useSave(); const formId = useId();
  const version = useDraftVersion(review?.revision ?? 0);
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); void save.run(() => saveReview({ entryId: entry.id, revision: version.expected, rating: rating ? Number(rating) : null, body }), onClose); }}><div className="field"><label htmlFor={`${formId}-score`}>我的评分</label><select id={`${formId}-score`} value={rating} onChange={e => setRating(e.target.value)}><option value="">暂不评分</option>{Array.from({ length: 10 }, (_, i) => (i + 1) / 2).reverse().map(v => <option value={v} key={v}>{"★".repeat(Math.floor(v))} {v.toFixed(1)} 分</option>)}</select></div><div className="field"><label htmlFor={`${formId}-body`}>我的感受</label><textarea id={`${formId}-body`} rows={7} value={body} maxLength={10000} onChange={e => setBody(e.target.value)} placeholder={`关于《${entry.title}》，有什么想留下的？`} /></div><p className="field-hint">这是你的短评，对方可以阅读，只有你能修改。</p><ErrorNotice text={save.error} conflict={save.conflict} refresh={version.refresh} />{version.showLatest && <div className="latest-record"><strong>服务器中的最新短评 · {review?.rating ?? "未评分"}</strong><p>{review?.body || "尚无短评"}</p><small>请对照草稿合并，再保存一次。</small></div>}<div className="form-actions"><Button type="submit" busy={save.busy || version.loading}>保存我的感受</Button></div></form>;
}
export function MemoryForm({ entry, memory, onClose }: { entry: Entry; memory?: Memory; onClose: () => void }) {
  const [recordId] = useState(() => memory?.id ?? crypto.randomUUID()); const formId = useId(); const save = useSave();
  const [body, setBody] = useState(memory?.body ?? ""); const [date, setDate] = useState(memory?.date ?? ""); const [place, setPlace] = useState(memory?.place ?? ""); const [photos, setPhotos] = useState(memory?.photos ?? []);
  const version = useDraftVersion(memory?.revision ?? 0); const [uploading, setUploading] = useState(false);
  return <form className="editor-form" onSubmit={e => { e.preventDefault(); if (uploading) return; void save.run(() => saveMemory({ id: recordId, entryId: entry.id, create: !memory, revision: version.expected, body, date: date || null, place, photos }), onClose); }}><div className="form-row"><div className="field"><label htmlFor={`${formId}-date`}>发生日期</label><input type="date" id={`${formId}-date`} value={date} onChange={e => setDate(e.target.value)} /><small className="field-hint">记不清的话，留空也没关系。</small></div><div className="field"><label htmlFor={`${formId}-place`}>在哪里</label><input id={`${formId}-place`} value={place} onChange={e => setPlace(e.target.value)} maxLength={200} placeholder="家里的沙发、街角的小影院…" /></div></div><div className="field"><label htmlFor={`${formId}-body`}>那一刻的我们 <span className="required">*</span></label><textarea id={`${formId}-body`} rows={6} value={body} onChange={e => setBody(e.target.value)} required maxLength={20000} placeholder="剧情也许会忘记，但一起度过的这个晚上不会。" /></div><UploadField label="回忆照片" ids={photos} onChange={setPhotos} multiple onBusyChange={setUploading} /><ErrorNotice text={save.error} conflict={save.conflict} refresh={version.refresh} />{version.showLatest && memory && <div className="latest-record"><strong>服务器中的最新回忆</strong><p>{memory.date || "日期未记"} · {memory.place}</p><p>{memory.body}</p><div className="upload-items">{memory.photos.map(p => <div className="upload-preview" key={p}><img src={`/api/assets/${p}`} alt="最新回忆照片" /></div>)}</div><small>请对照草稿合并，再保存一次。</small></div>}<div className="form-actions"><Button busy={save.busy || version.loading} disabled={uploading} type="submit">保存这一刻</Button></div></form>;
}
