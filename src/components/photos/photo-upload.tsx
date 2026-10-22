"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, RefreshCw, Check, X } from "lucide-react";
import type { JournalData } from "@/lib/types";
import type { Photo, Trip } from "@/lib/photo-types";
import { Button, ErrorNotice, Modal } from "../ui";
import { Participants } from "./photo-editor";
type Item = { id: string; file: File; percent: number; state: "waiting" | "uploading" | "processing" | "done" | "error"; message: string; photo?: Photo };
export function PhotoUpload({ data, trips, initialTrip, close, completed }: { data: JournalData; trips: Trip[]; initialTrip?: string; close: () => void; completed: (photos: Photo[], edit: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]), [people, setPeople] = useState(data.members.map(m => m.id)), [trip, setTrip] = useState(initialTrip ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), running = useRef(false);
  useEffect(() => { if (!running.current) setTrip(initialTrip ?? ""); }, [initialTrip]);
  function add(files: FileList | File[]) {
    if (running.current) return;
    const incoming = Array.from(files); if (incoming.length + items.length > 50) { setError("每批最多 50 张照片，请分批添加。"); return; }
    setError(""); setItems(old => [...old, ...incoming.map(file => ({ id: crypto.randomUUID(), file, percent: 0, state: "waiting" as const, message: "" }))]);
  }
  function patch(id: string, changes: Partial<Item>) { setItems(old => old.map(i => i.id === id ? { ...i, ...changes } : i)); }
  async function one(item: Item) {
    if (item.file.size > 25 * 1024 * 1024) { patch(item.id, { state: "error", message: "这张照片超过 25 MB。" }); return; }
    patch(item.id, { state: "uploading", percent: 0, message: "" });
    const form = new FormData(); form.append("file", item.file); form.append("participants", JSON.stringify(people)); if (trip) form.append("tripId", trip);
    await new Promise<void>(resolve => {
      const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/photos/upload"); xhr.timeout = 300_000;
      xhr.upload.onprogress = e => { if (e.lengthComputable) patch(item.id, { percent: Math.round(e.loaded / e.total * 100) }); };
      xhr.upload.onload = () => patch(item.id, { state: "processing", percent: 100 });
      const fail = (message: string) => { patch(item.id, { state: "error", message }); resolve(); };
      xhr.onerror = () => fail("网络中断，照片仍在列表中，可以重试。"); xhr.ontimeout = () => fail("处理超时，请单独重试。");
      xhr.onload = () => {
        try { const response = JSON.parse(xhr.responseText); if (xhr.status !== 200) { fail(response.error || "上传失败，可重试。"); return; }
          patch(item.id, { state: "done", percent: 100, photo: response.photo, message: response.duplicate ? response.photo.deletedAt ? "回收站已有这张照片，可前往恢复" : "照片已存在，保留原有信息" : "已保存" }); resolve();
        } catch { fail("未能确认上传结果，重试会自动查重。"); }
      };
      xhr.send(form);
    });
  }
  async function run(targets: Item[]) {
    if (running.current) return; if (!people.length) { setError("请选择至少一位参与者。"); return; }
    running.current = true; setBusy(true); setError(""); let cursor = 0;
    try { await Promise.all([0, 1].map(async () => { while (cursor < targets.length) { const item = targets[cursor++]; await one(item); } })); }
    finally { setBusy(false); running.current = false; }
  }
  const done = items.filter(i => i.state === "done"), photos = [...new Map(done.flatMap(i => i.photo && !i.photo.deletedAt ? [[i.photo.id, i.photo] as const] : [])).values()];
  return <Modal open onOpenChange={open => { if (!open && !busy) { if (done.length) completed(photos, false); else close(); } }} title="收藏照片" description="保留原图，也留住那一天的日期和地点。" className="upload-modal">
    <fieldset disabled={busy}><Participants data={data} value={people} onChange={setPeople} /><label className="field">归入旅行<select aria-label="上传所属旅行" value={trip} onChange={e => setTrip(e.target.value)}><option value="">暂不分组</option>{trips.map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label></fieldset>
    <button className="photo-drop" type="button" disabled={busy} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}><ImagePlus size={28} strokeWidth={1.3} /><strong>选择照片，或拖到这里</strong><span>JPG、PNG、WebP、HEIC · 每张最多 25 MB · 每批 50 张</span></button>
    <input ref={input} className="visually-hidden" type="file" multiple aria-label="选择上传照片" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={e => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
    <ErrorNotice text={error} />
    <div className="upload-queue" aria-live="polite">{items.map(item => <div className={`upload-row ${item.state}`} key={item.id}>
      {item.photo ? <img src={`/api/assets/${item.photo.assetId}`} alt="上传照片预览" /> : <ImagePlus size={24} />}
      <div><strong>{item.file.name}</strong><small>{item.state === "uploading" ? `上传中 ${item.percent}%` : item.state === "processing" ? "正在生成预览…" : item.message || `${(item.file.size / 1024 / 1024).toFixed(1)} MB · 等待上传`}</small>{["uploading", "processing"].includes(item.state) && <progress max={100} value={item.percent} />}</div>
      {item.state === "done" ? <Check size={17} /> : item.state === "error" ? <button type="button" className="icon-button" disabled={busy} aria-label={`重试 ${item.file.name}`} onClick={() => void run([item])}><RefreshCw size={16} /></button> : !busy && <button type="button" className="icon-button" aria-label={`移除 ${item.file.name}`} onClick={() => setItems(old => old.filter(i => i.id !== item.id))}><X size={16} /></button>}
    </div>)}</div>
    <div className="form-actions"><span className="field-hint">{done.length ? `已保存 ${done.length} / ${items.length} 张` : "上传后可以补充日期与地点"}</span>
      {photos.length > 0 && <Button type="button" variant="secondary" disabled={busy} onClick={() => completed(photos, true)}>批量整理</Button>}
      {items.some(i => i.state !== "done") ? <Button busy={busy} onClick={() => void run(items.filter(i => i.state === "waiting" || i.state === "error"))}><Upload size={16} />{items.some(i => i.state === "error") ? "重试未完成项" : "开始上传"}</Button> : <Button disabled={busy} onClick={() => done.length ? completed(photos, false) : close()}>完成</Button>}
    </div>
  </Modal>;
}
