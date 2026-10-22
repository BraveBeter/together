"use client";
import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, BookOpen, Film, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import type { Entry, Member } from "@/lib/types";

export function Button({ children, variant = "primary", busy, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`button ${variant} ${className}`}>{busy ? <Loader2 size={16} className="spin" /> : null}{children}</button>;
}
export function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  return <span className={`avatar ${small ? "small" : ""}`} style={{ "--avatar-color": member.color } as React.CSSProperties} title={member.name}>
    {member.avatarId ? <img src={`/api/assets/${member.avatarId}`} alt={member.name} /> : member.name.slice(0, 1)}
  </span>;
}
export function Cover({ entry, className = "", full = false }: { entry: Pick<Entry, "id" | "kind" | "title" | "creator" | "coverId">; className?: string; full?: boolean }) {
  const [broken, setBroken] = useState(false);
  const palette = [...entry.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;
  return <div className={`cover cover-${entry.kind} palette-${palette} ${className}`}>
    {entry.coverId && !broken ? <img src={`/api/assets/${entry.coverId}${full ? "?full=1" : ""}`} alt={`${entry.title}封面`} onError={() => setBroken(true)} loading="lazy" /> : <div className="type-cover">
      <span className="cover-eyebrow">{entry.kind === "movie" ? "电影" : "书籍"}</span>

      <strong>{entry.title}</strong>
      <span className="cover-creator">{entry.creator || ""}</span>
      <span className="cover-bottom">同页 · 私人收藏</span>
    </div>}
  </div>;
}
export function Modal({ open, onOpenChange, title, description, children, drawer = false, className = "" }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; drawer?: boolean; className?: string }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={`modal ${drawer ? "drawer" : ""} ${className}`} onOpenAutoFocus={e => { if (window.innerWidth < 600) e.preventDefault(); }}>
    <div className="modal-heading"><div><Dialog.Title className="serif">{title}</Dialog.Title><Dialog.Description>{description || "为我们留下这一刻。"}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭"><X size={20} /></Dialog.Close></div>
    {children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function ErrorNotice({ text, conflict, refresh }: { text?: string; conflict?: boolean; refresh?: () => void }) {
  return text ? <div className="error-notice" role="alert">{text}{conflict && refresh ? <button type="button" onClick={refresh}>加载最新记录（保留草稿）</button> : null}</div> : null;
}
export function Empty({ title, text, kind, action }: { title: string; text: string; kind?: "movie" | "book"; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{kind === "movie" ? <Film /> : <BookOpen />}</span><h3 className="serif">{title}</h3><p>{text}</p>{action}</div>;
}
export function SectionHeading({ eyebrow, title, href, action }: { eyebrow?: string; title: string; href?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 className="serif">{title}</h2></div>{href ? <Link className="text-link" href={href}>查看全部 <ArrowUpRight size={15} /></Link> : action}</div>;
}
export function Rating({ value }: { value: number | null }) { return value ? <span className="rating"><span>★</span> {value.toFixed(1)}</span> : <span className="muted">尚未评分</span>; }
export function AddButton({ onClick, text = "新增记录" }: { onClick: () => void; text?: string }) { return <Button onClick={onClick}><Plus size={16} />{text}</Button>; }

export function SaveCheckbox({ checked, disabled, onCommit, label }: { checked: boolean; disabled?: boolean; onCommit: (value: boolean) => Promise<boolean>; label: string }) {
  const [value, setValue] = useState(checked), [busy, setBusy] = useState(false);
  useEffect(() => { setValue(checked); }, [checked]);
  return <input type="checkbox" aria-label={label} checked={value} disabled={disabled || busy} onChange={async e => {
    const next = e.target.checked; setValue(next); setBusy(true);
    try { if (!await onCommit(next)) setValue(checked); } catch { setValue(checked); } finally { setBusy(false); }
  }} />;
}
