"use client";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Film, MapPin, Pencil, Trash2 } from "lucide-react";
import { dateLabel } from "@/lib/domain";
import type { Entry, Memory } from "@/lib/types";
export function MemoryCard({ memory: m, entry, preview = false, showImage, edit, remove }: { memory: Memory; entry: Entry; preview?: boolean; showImage: (id: string) => void; edit?: () => void; remove?: () => void }) {
  return <article className={`memory-card ${preview ? "preview" : ""}`}><div className="memory-card-top"><span className="memory-date">{dateLabel(m.date)}</span>{edit && <div className="memory-tools"><button aria-label="编辑回忆" className="icon-button" onClick={edit}><Pencil size={14} /></button><button aria-label="删除回忆" className="icon-button" onClick={remove}><Trash2 size={14} /></button></div>}</div><Link href={`/entry/${entry.id}`} className="memory-work">{entry.kind === "movie" ? <Film size={13} /> : <BookOpen size={13} />}《{entry.title}》<ArrowUpRight size={12} /></Link><p className="memory-body">{m.body}</p>{m.photos.length > 0 && <div className={`memory-photos photos-${Math.min(3, m.photos.length)}`}>{m.photos.slice(0, preview ? 1 : 8).map((photo, i) => <button key={photo} onClick={() => showImage(photo)} aria-label={`查看回忆照片${i + 1}`}><img src={`/api/assets/${photo}`} alt={`与《${entry.title}》有关的回忆照片`} loading="lazy" /></button>)}</div>}{m.place && <span className="memory-place"><MapPin size={12} />{m.place}</span>}</article>;
}
