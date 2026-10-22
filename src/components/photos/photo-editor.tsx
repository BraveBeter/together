"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePhotos, saveTrip } from "@/lib/photo-actions";
import type { JournalData } from "@/lib/types";
import type { Photo, PhotoLocation, Trip } from "@/lib/photo-types";
import { Avatar, Button, ErrorNotice, Modal } from "../ui";
import { LocationPicker } from "./location-picker";
export function Participants({ data, value, onChange }: { data: JournalData; value: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="photo-participants"><legend>参与者</legend>{data.members.map(m => <label key={m.id}><input type="checkbox" checked={value.includes(m.id)} onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(v => v !== m.id))} /><Avatar member={m} small /><span>{m.name}</span></label>)}</fieldset>;
}
export function PhotoEditor({ data, photos, trips, close, saved }: { data: JournalData; photos: Photo[]; trips: Trip[]; close: () => void; saved: () => void }) {
  const first = photos[0], multiple = photos.length > 1, router = useRouter();
  const [targets, setTargets] = useState(photos), [caption, setCaption] = useState(first.caption), [date, setDate] = useState(first.takenOn ?? ""), [people, setPeople] = useState(first.participants), [tripId, setTripId] = useState(first.tripId ?? "");
  const [location, setLocation] = useState<PhotoLocation | null>(first.latitude === null ? null : { lat: first.latitude, lng: first.longitude!, place: first.place, source: first.locationSource! });
  const [changed, setChanged] = useState(new Set<string>()), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false), [latestNote, setLatestNote] = useState("");
  const mark = (field: string) => setChanged(old => new Set([...old, field]));
  async function refreshVersions() {
    setBusy(true);
    try {
      const loaded: Photo[] = []; let cursor: string | null = null;
      do { const r: Response = await fetch(`/api/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: targets.map(p => p.id) }) }); const body = await r.json(); if (!r.ok) throw new Error(); loaded.push(...body.items); cursor = body.cursor; } while (cursor);
      if (loaded.length !== targets.length) throw new Error("部分照片已移除，请关闭后重新选择。当前草稿仍保留。");
      setTargets(loaded); setConflict(false); setError(""); setLatestNote(loaded.map(p => `${p.caption || "未填写说明"} · ${p.takenOn || "日期未记"} · ${p.place || "地点未记"} · ${p.participants.map(id => data.members.find(m => m.id === id)?.name).join("、")}`).join("\n"));
    } catch (e) { setError(e instanceof Error ? e.message : "无法加载最新资料。"); } finally { setBusy(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const all = { caption, takenOn: date || null, participants: people, tripId: tripId || null, location };
    const changes = Object.fromEntries(Object.entries(all).filter(([key]) => changed.has(key)));
    try { const result = await savePhotos({ photos: targets.map(p => ({ id: p.id, revision: p.revision })), changes }); if (!result.ok) { setError(result.error); setConflict(!!result.conflict); return; } router.refresh(); saved(); close(); }
    catch { setError("网络暂时不可用，输入已保留。"); } finally { setBusy(false); }
  }
  return <Modal open onOpenChange={open => { if (!open && !busy) close(); }} title={multiple ? `整理 ${photos.length} 张照片` : "编辑照片资料"} drawer description={multiple ? "只应用你修改的字段，其余照片信息保留。" : "日期与地点可以留空，原始照片信息会保留。"}>
    <form onSubmit={submit} className="editor-form"><div className="photo-editor-strip">{photos.slice(0, 8).map(p => <img src={`/api/assets/${p.assetId}`} key={p.id} alt="待编辑照片" />)}</div>
      <label className="field">照片说明<textarea aria-label="照片说明" value={caption} maxLength={2000} onChange={e => { setCaption(e.target.value); mark("caption"); }} /></label>
      <label className="field">拍摄日期<input aria-label="拍摄日期" type="date" value={date} onChange={e => { setDate(e.target.value); mark("takenOn"); }} /><span className="field-hint">不知道具体日期可以留空。</span></label>
      <Participants data={data} value={people} onChange={value => { setPeople(value); mark("participants"); }} />
      <label className="field">所属旅行<select aria-label="所属旅行" value={tripId} onChange={e => { setTripId(e.target.value); mark("tripId"); }}><option value="">不分组</option>{trips.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <LocationPicker value={location} onChange={value => { setLocation(value); mark("location"); }} />
      {!multiple && <details className="form-details"><summary>原始照片信息</summary><p className="field-hint">拍摄时间：{first.originalMetadata.capturedAt || "未记录"} {first.originalMetadata.offset || ""}<br />GPS：{first.originalMetadata.latitude === null ? "未记录" : `${first.originalMetadata.latitude}, ${first.originalMetadata.longitude}`}<br />{first.width} × {first.height} 像素</p></details>}
      {latestNote && <div className="latest-record"><strong>最新资料（供合并参考）</strong><p>{latestNote}</p></div>}
      <ErrorNotice text={error} conflict={conflict} refresh={() => void refreshVersions()} />
      <div className="form-actions"><Button variant="secondary" type="button" disabled={busy} onClick={close}>取消</Button><Button busy={busy} disabled={!changed.size} type="submit">保存照片资料</Button></div>
    </form>
  </Modal>;
}
export function TripEditor({ trip, close, saved }: { trip?: Trip; close: () => void; saved: (id?: string) => void }) {
  const [id] = useState(() => trip?.id ?? crypto.randomUUID()), [title, setTitle] = useState(trip?.title ?? ""), [description, setDescription] = useState(trip?.description ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirm, setConfirm] = useState(false);
  const [latest, setLatest] = useState(trip), [conflict, setConflict] = useState(false), [latestText, setLatestText] = useState("");
  async function refreshTrip() {
    setBusy(true);
    try {
      const r = await fetch("/api/photos"); if (!r.ok) throw new Error();
      const fresh = (await r.json()).trips.find((t: Trip) => t.id === id) as Trip | undefined;
      if (!fresh) { setError("旅行已被解散。草稿保留，可复制后创建新的旅行。"); return; }
      setLatest(fresh); setLatestText(fresh.title + " · " + fresh.description); setConflict(false); setError("");
    } catch { setError("读取失败，草稿已保留。"); } finally { setBusy(false); }
  }
  async function submit(remove = false) {
    setBusy(true); setError("");
    try { const result = await saveTrip({ id, revision: latest?.revision ?? 0, title: title === trip?.title ? latest!.title : title, description: description === trip?.description ? latest!.description : description, coverPhotoId: latest?.coverPhotoId ?? null, remove }); if (!result.ok) { setError(result.error); setConflict(!!result.conflict); return; } saved(remove ? undefined : id); close(); }
    catch { setError("保存失败，输入已保留。"); } finally { setBusy(false); }
  }
  return <Modal open onOpenChange={open => { if (!open && !busy) close(); }} title={trip ? "编辑旅行" : "记一次旅行"} description="把沿途的照片，收进同一个故事。"><form onSubmit={e => { e.preventDefault(); void submit(); }}><label className="field">旅行名称<input aria-label="旅行名称" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required placeholder="例如：山海之间的周末" /></label><label className="field">旅行简介<textarea aria-label="旅行简介" value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} /></label><p className="field-hint">日期范围按照片自动整理。打开照片详情，可将照片设为旅行封面。</p><ErrorNotice text={error} conflict={conflict} refresh={() => void refreshTrip()} />{latestText && <p className="field-hint">最新资料：{latestText}</p>}<div className="form-actions">{trip && <Button type="button" variant="ghost" onClick={() => setConfirm(true)}>解散旅行分组</Button>}<Button type="submit" busy={busy}>保存旅行</Button></div></form>
    {confirm && <div className="error-notice"><p>解散后照片和评论都会保留，只取消这次旅行分组。</p><div className="inline-actions"><Button variant="secondary" onClick={() => setConfirm(false)}>保留分组</Button><Button variant="danger" busy={busy} onClick={() => void submit(true)}>确认解散</Button></div></div>}
  </Modal>;
}
