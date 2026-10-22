"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Edit3, MapPin, MessageCircle, Trash2, Image } from "lucide-react";
import { changePhotoTrash, savePhotoComment, saveTrip } from "@/lib/photo-actions";
import { dateLabel } from "@/lib/domain";
import type { JournalData } from "@/lib/types";
import type { Photo, PhotoComment, Trip } from "@/lib/photo-types";
import { Avatar, Button, ErrorNotice, Modal } from "../ui";
import { PhotoEditor } from "./photo-editor";
export function PhotoDetail({ id, data, close, changed, previous, next }: { id: string; data: JournalData; close: () => void; changed: () => void; previous?: () => void; next?: () => void }) {
  const [photo, setPhoto] = useState<Photo | null>(null), [comments, setComments] = useState<PhotoComment[]>([]), [trips, setTrips] = useState<Trip[]>([]), [error, setError] = useState("");
  const [body, setBody] = useState(""), [commentId, setCommentId] = useState(() => crypto.randomUUID()), [editing, setEditing] = useState<PhotoComment | null>(null), [busy, setBusy] = useState(false), [editor, setEditor] = useState(false), [remove, setRemove] = useState(false);
  const refresh = useCallback(async () => {
    try { const r = await fetch(`/api/photos?id=${id}`); const result = await r.json(); if (!r.ok) throw new Error(result.error); setPhoto(result.photo); setComments(result.comments); setTrips(result.trips); }
    catch (e) { setError(e instanceof Error ? e.message : "无法读取照片。"); }
  }, [id]);
  useEffect(() => { void refresh(); const focus = () => { if (document.visibilityState === "visible") void refresh(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || editor || remove) return; if (e.key === "ArrowLeft") previous?.(); if (e.key === "ArrowRight") next?.(); };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [previous, next, editor, remove]);
  async function comment(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const r = await savePhotoComment({ id: editing?.id ?? commentId, photoId: id, revision: editing?.revision ?? 0, body }); if (!r.ok) { setError(r.error); return; } setBody(""); setEditing(null); setCommentId(crypto.randomUUID()); await refresh(); changed(); }
    catch { setError("网络暂时不可用，评论输入已保留。"); } finally { setBusy(false); }
  }
  async function removeComment(c: PhotoComment) { setBusy(true); try { const r = await savePhotoComment({ id: c.id, photoId: id, revision: c.revision, body: c.body, remove: true }); if (!r.ok) setError(r.error); else { await refresh(); changed(); } } catch { setError("删除失败，请重试。"); } finally { setBusy(false); } }
  return <Modal open title="收藏的片刻" description={photo ? `${dateLabel(photo.takenOn)}${photo.place ? ` · ${photo.place}` : ""}` : "正在读取照片…"} onOpenChange={open => { if (!open && !busy) close(); }} className="photo-detail-modal">
    {photo && <div className="photo-detail-layout"><div className="photo-stage"><img src={`/api/assets/${photo.assetId}?size=display`} alt={photo.caption || photo.place || "收藏的照片"} />
      <div className="photo-paging"><button className="icon-button" aria-label="上一张照片" disabled={!previous} onClick={previous}><ChevronLeft size={22} /></button><a className="text-link" href={`/api/assets/${photo.assetId}?full=1`} download><ArrowDownToLine size={15} />原图</a><button className="icon-button" aria-label="下一张照片" disabled={!next} onClick={next}><ChevronRight size={22} /></button></div></div>
      <div className="photo-sidebar"><div className="photo-caption"><div className="photo-person-list">{photo.participants.map(person => { const member = data.members.find(m => m.id === person); return member && <span key={person}><Avatar member={member} small />{member.name}</span>; })}</div><p>{photo.caption || "把这一刻，留在这里。"}</p><div className="photo-detail-meta"><time>{dateLabel(photo.takenOn)}</time>{photo.latitude !== null && <span><MapPin size={13} />{photo.place || "已记录 GPS"}</span>}{photo.tripTitle && <span>{photo.tripTitle}</span>}</div></div>
      <div className="photo-detail-actions"><button className="text-link" onClick={() => setEditor(true)}><Edit3 size={14} />编辑资料</button><button className="text-link" onClick={() => setRemove(true)}><Trash2 size={14} />移入回收站</button>{photo.tripId && <button className="text-link" disabled={busy} onClick={async () => { const trip = trips.find(t => t.id === photo.tripId); if (!trip) return; setBusy(true); try { const result = await saveTrip({ id: trip.id, title: trip.title, description: trip.description, revision: trip.revision, coverPhotoId: photo.id }); if (!result.ok) setError(result.error); else { await refresh(); changed(); } } catch { setError("封面保存失败，请重试。"); } finally { setBusy(false); } }}><Image size={14} />{trips.find(t => t.id === photo.tripId)?.coverPhotoId === photo.id ? "已是旅行封面" : "设为旅行封面"}</button>}</div>
      <div className="photo-comments"><h3><MessageCircle size={16} />关于这一刻 <span>{comments.length}</span></h3>{comments.length === 0 && <p className="field-hint">留一句只有我们懂的话。</p>}{comments.map(c => { const member = data.members.find(m => m.id === c.authorId); return <article className="photo-comment" key={c.id}>{member && <Avatar member={member} small />}<div><header><strong>{member?.name}</strong><small>{new Date(c.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}{c.updatedAt !== c.createdAt ? " · 已编辑" : ""}</small></header><p>{c.body}</p>{c.authorId === data.me.id && <div className="comment-actions"><button type="button" onClick={() => { setEditing(c); setBody(c.body); setError(""); }}>编辑评论</button><button type="button" disabled={busy} onClick={() => void removeComment(c)}>删除评论</button></div>}</div></article>; })}</div>
      <form className="comment-form" onSubmit={comment}><label htmlFor="photo-comment">{editing ? "修改我的评论" : "写一条评论"}</label><textarea id="photo-comment" value={body} maxLength={2000} onChange={e => setBody(e.target.value)} placeholder="想起了什么？" /><div className="inline-actions">{editing && <Button variant="ghost" type="button" onClick={() => { setEditing(null); setBody(""); }}>取消编辑</Button>}<Button type="submit" disabled={!body.trim()} busy={busy}>{editing ? "保存评论" : "发表"}</Button></div></form>
      </div></div>}
    <ErrorNotice text={error} />
    {editor && photo && <PhotoEditor data={data} photos={[photo]} trips={trips} close={() => setEditor(false)} saved={() => { void refresh(); changed(); }} />}
    <Modal open={remove} onOpenChange={setRemove} title="暂时收起这张照片？" description="照片会从照片墙、地球和时光轴隐藏，评论一起保留，之后可以恢复。"><div className="confirm-actions"><Button variant="secondary" onClick={() => setRemove(false)}>取消</Button><Button variant="danger" busy={busy} onClick={async () => { if (!photo) return; setBusy(true); try { const r = await changePhotoTrash({ id: photo.id, revision: photo.revision, restore: false }); if (!r.ok) { setError(r.error); setRemove(false); } else { changed(); close(); } } catch { setError("移除失败，请重试。"); setRemove(false); } finally { setBusy(false); } }}>确认移入回收站</Button></div></Modal>
  </Modal>;
}
