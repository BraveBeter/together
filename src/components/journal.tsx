"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, CircleCheck, Clock3, Film, Home, ImagePlus, Globe2, Menu, LockKeyhole, LogOut, Plus, Search, Settings, Trash2, Trophy, Undo2, X } from "lucide-react";
import { deleteMemory, personalRecordCommand, setChallenge, signOut } from "@/lib/actions";
import { activeRecord, completedEntries, dateLabel } from "@/lib/domain";
import type { Challenge, JournalData, Memory } from "@/lib/types";
import { Avatar, Button, Cover, Empty, Modal, SaveCheckbox, SectionHeading } from "./ui";
import { EntryForm, MemoryForm, PersonalRecordForm, TogetherForm, RecommendationForm, ReviewForm } from "./forms";
import { Catalog, EntryCard, PerspectiveTabs } from "./catalog";
import { EntryPage } from "./entry-detail";
import { SettingsPage } from "./settings";
import { BulkImport } from "./bulk-import";
import { PhotoLibrary } from "./photos/photo-library";
import { JournalTimeline, RecentExperiences } from "./journal-timeline";
import { BrandMark } from "./brand-mark";
import type { EditState, Run } from "./editor-types";
const nav = [{ href: "/", title: "首页", icon: Home }, { href: "/movies", title: "电影馆", icon: Film }, { href: "/books", title: "共同书房", icon: BookOpen }, { href: "/photos", title: "照片墙", icon: ImagePlus }, { href: "/travels", title: "旅游足迹", icon: Globe2 }, { href: "/challenges", title: "挑战", icon: Trophy }, { href: "/timeline", title: "时光轴", icon: Clock3 }];
export function Journal({ data, path }: { data: JournalData; path: string }) {
  const router = useRouter(), [edit, setEdit] = useState<EditState>(null), [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null), [pending, setPending] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null), [confirm, setConfirm] = useState<Memory | null>(null);
  useEffect(() => { function focus() { if (document.visibilityState === "visible") router.refresh(); } window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus); return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); }; }, [router]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(null), notice.error ? 9000 : 3500); return () => clearTimeout(timer); } }, [notice]);
  const run: Run = async (task, message) => {
    setPending(true); try { const result = await task(); if (!result.ok) { setNotice({ text: result.error, error: true }); return false; } router.refresh(); if (message) setNotice({ text: message, error: false }); return true; }
    catch { setNotice({ text: "网络暂时不可用，请稍后重试。", error: true }); return false; } finally { setPending(false); }
  };
  const active = (href: string) => href === "/" ? path === "/" : path.startsWith(href);
  const entry = path.startsWith("/entry/") ? data.entries.find(e => e.id === path.split("/")[2] && !e.deletedAt) : undefined;
  const editingEntry = edit && "entry" in edit && edit.entry ? data.entries.find(e => e.id === edit.entry!.id) : undefined;
  const title = edit?.type === "entry" ? editingEntry ? "编辑作品资料" : `添加${edit.kind === "book" ? "书籍" : "电影"}` : edit?.type === "personal" ? "我的清单记录" : edit?.type === "together" ? "共同完成记录" : edit?.type === "recommend" ? "想推荐给你" : edit?.type === "review" ? "我的感受" : "共同回忆";
  return <div className="site-shell"><a href="#main" className="skip-link">跳到主要内容</a>
    <header className="site-header"><div className="header-inner"><Link href="/" className="brand" aria-label={`${data.settings.name}首页`}><BrandMark size={29} /><span className="serif">{data.settings.name}</span></Link><nav className="desktop-nav" aria-label="主导航">{nav.map(n => <Link key={n.href} href={n.href} className={active(n.href) ? "active" : ""} aria-current={active(n.href) ? "page" : undefined}>{n.title}</Link>)}</nav><Dropdown.Root><Dropdown.Trigger className="avatar-button" aria-label="账户菜单"><Avatar member={data.me} small /><ChevronDown size={13} /></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" sideOffset={12} className="dropdown"><div className="dropdown-profile"><strong>{data.me.name}</strong><span>{data.me.email}</span></div><Dropdown.Item asChild><Link href="/settings"><Settings size={16} />空间设置</Link></Dropdown.Item><Dropdown.Item asChild><Link href="/trash"><Trash2 size={16} />我的回收站</Link></Dropdown.Item><Dropdown.Separator /><Dropdown.Item onSelect={() => { void signOut().then(() => { router.push("/login"); router.refresh(); }).catch(() => setNotice({ text: "退出失败，请重试。", error: true })); }}><LogOut size={16} />退出登录</Dropdown.Item></Dropdown.Content></Dropdown.Portal></Dropdown.Root></div></header>
    <main id="main" className="main-content">
      {path === "/" && <HomePage data={data} />}
      {(path === "/movies" || path === "/books") && <Catalog key={path} data={data} kind={path === "/movies" ? "movie" : "book"} edit={setEdit} run={run} pending={pending} />}
      {path === "/challenges" && <><PageHeading title="一起完成的一百件事" subtitle="每个格子，留给一次真正的共同经历。" /><div className="challenge-pair">{data.challenges.map(c => <ChallengeCard key={c.id} challenge={c} data={data} />)}</div><p className="quiet-empty">作品加入挑战、两人都已完成，并在详情确认一起完成后，点亮一格收藏。</p></>}
      {path.startsWith("/challenges/") && <ChallengePage data={data} challenge={data.challenges.find(c => c.id === path.split("/")[2])!} run={run} pending={pending} />}
      {path === "/timeline" && <JournalTimeline data={data} showImage={setLightbox} />}
      {entry && <EntryPage entry={entry} data={data} run={run} pending={pending} edit={setEdit} showImage={setLightbox} removeMemory={setConfirm} />}
      {path.startsWith("/entry/") && !entry && <Empty title="作品暂不可用" text="请返回清单查看其他作品。" />}
      {path === "/imports" && <BulkImport data={data} />}
      {(path === "/photos" || path.startsWith("/photos/")) && <PhotoLibrary data={data} initialPhoto={path.split("/")[2]} />}
      {(path === "/travels" || path === "/travels/prototype") && <PhotoLibrary key={path} data={data} travel prototype={path === "/travels/prototype"} />}
      {path === "/settings" && <SettingsPage data={data} />}
      {path === "/trash" && <TrashPage data={data} run={run} pending={pending} />}
    </main>
    <footer className="site-footer"><span>{data.members.map(m => m.name).join(" & ")} 的私人收藏</span><span><LockKeyhole size={12} />{data.demo ? "独立演示空间" : "仅我们可见"}</span></footer>
    <nav className="mobile-nav" aria-label="手机导航">{nav.filter(n => ["/", "/movies", "/books", "/photos"].includes(n.href)).map(n => <Link href={n.href} key={n.href} className={active(n.href) ? "active" : ""} aria-current={active(n.href) ? "page" : undefined}><n.icon size={20} strokeWidth={1.6} /><span>{n.title === "共同书房" ? "书房" : n.title}</span></Link>)}<Dropdown.Root><Dropdown.Trigger className={`mobile-more ${["/travels", "/timeline", "/challenges"].some(active) ? "active" : ""}`} aria-label="更多页面"><Menu size={20} strokeWidth={1.6} /><span>更多</span></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="dropdown" side="top" sideOffset={15}>{nav.filter(n => ["/travels", "/timeline", "/challenges"].includes(n.href)).map(n => <Dropdown.Item key={n.href} asChild><Link href={n.href}><n.icon size={16} />{n.title}</Link></Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root></nav>
    <Modal open={!!edit} onOpenChange={open => { if (!open) setEdit(null); }} title={title} description={edit?.type === "entry" && editingEntry ? "作品资料由两人共同维护。" : "保存到这个只属于你们的空间。"} drawer>
      {edit?.type === "entry" && <EntryForm key={editingEntry?.id ?? `new-${edit.kind}`} data={data} entry={editingEntry} initialKind={edit.kind} initialStatus={edit.status} onClose={() => setEdit(null)} />}
      {edit?.type === "personal" && editingEntry && <PersonalRecordForm data={data} entry={editingEntry} initialStatus={edit.status} onClose={() => setEdit(null)} />}
      {edit?.type === "together" && editingEntry && <TogetherForm entry={editingEntry} onClose={() => setEdit(null)} />}
      {edit?.type === "recommend" && editingEntry && <RecommendationForm data={data} entry={editingEntry} onClose={() => setEdit(null)} />}
      {edit?.type === "review" && editingEntry && <ReviewForm entry={editingEntry} review={data.reviews.find(r => r.entryId === editingEntry.id && r.userId === data.me.id)} onClose={() => setEdit(null)} />}
      {edit?.type === "memory" && editingEntry && <MemoryForm entry={editingEntry} memory={edit.memory ? data.memories.find(m => m.id === edit.memory!.id) ?? edit.memory : undefined} onClose={() => setEdit(null)} />}
    </Modal>
    <Modal open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }} title="删除这段回忆？" description="作品、个人记录与共同完成确认都会保留。"><div className="confirm-actions"><Button variant="secondary" onClick={() => setConfirm(null)}>取消</Button><Button variant="danger" busy={pending} onClick={() => { if (confirm) void run(() => deleteMemory({ id: confirm.id, revision: confirm.revision }), "回忆已删除").then(ok => { if (ok) setConfirm(null); }); }}>确认删除</Button></div></Modal>
    <Modal open={!!lightbox} onOpenChange={open => { if (!open) setLightbox(null); }} title="回忆照片">{lightbox && <div className="lightbox"><img src={`/api/assets/${lightbox}?full=1`} alt="回忆照片原图" /><a href={`/api/assets/${lightbox}?full=1`} target="_blank" rel="noreferrer" className="text-link">查看原图<ArrowUpRight size={14} /></a></div>}</Modal>
    {notice && <div className={`toast ${notice.error ? "toast-error" : ""}`} role={notice.error ? "alert" : "status"}><CircleCheck size={18} /><span>{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button></div>}
  </div>;
}
function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <div className="page-heading"><div><h1 className="serif">{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function HomePage({ data }: { data: JournalData }) {
  const reading = data.entries.filter(e => !e.deletedAt && e.kind === "book" && e.sharedStatus === "in_progress").slice(0, 6);
  const planned = data.entries.filter(e => !e.deletedAt && e.sharedStatus === "planned").slice(0, 6);
  return <><PageHeading title="我们的收藏" subtitle={data.settings.subtitle} action={<div className="couple-avatars">{data.members.map(m => <Avatar key={m.id} member={m} />)}</div>} />
    <div className="home-links"><Link href={`/books?view=${data.me.id}`}>我的书房<ArrowUpRight size={15} /></Link><Link href={`/movies?view=${data.me.id}`}>我的电影清单<ArrowUpRight size={15} /></Link></div>
    <section className="home-section"><SectionHeading title="正在共读" href="/books?status=in_progress" />{reading.length ? <div className="reading-strip">{reading.map(e => <Link href={`/entry/${e.id}`} key={e.id}><Cover entry={e} /><div className="reading-copy"><h3 className="serif">{e.title}</h3><p>{e.creator || "正在翻阅的故事"}</p><div className="reading-members">{data.members.map(m => <span className="named-rating" key={m.id}><Avatar member={m} small /><small>{m.name}</small></span>)}</div></div><ArrowUpRight size={15} /></Link>)}</div> : <div className="quiet-empty">当你们都开始读同一本书，它会出现在这里。<Link href={`/books?view=${data.me.id}`}>走进我的书房<ArrowRight size={14} /></Link></div>}</section>
    <section className="home-section"><SectionHeading title="共同期待" />{planned.length ? <div className="catalog-grid">{planned.map(e => <EntryCard key={e.id} entry={e} data={data} />)}</div> : <div className="quiet-empty">两人都想读的书、都想看的电影，留给下一次相聚。</div>}</section>
    <div className="home-lower"><section><SectionHeading title="最近的共同经历" href="/timeline" /><RecentExperiences data={data} /></section><section><SectionHeading title="我们的 100 挑战" href="/challenges" /><div className="challenge-stack">{data.challenges.map(c => <ChallengeCard key={c.id} challenge={c} data={data} />)}</div></section></div>
  </>;
}
function ChallengeCard({ challenge: c, data }: { challenge: Challenge; data: JournalData }) {
  const completed = completedEntries(c, data.entries), pct = Math.min(100, completed.length / c.target * 100);
  return <Link href={`/challenges/${c.id}`} className={`challenge-card ${c.kind}`}><div className="challenge-title">{c.kind === "movie" ? <Film size={18} /> : <BookOpen size={18} />}<h3>{c.title}</h3><ArrowUpRight size={16} /></div><div className="challenge-numbers"><strong>{String(completed.length).padStart(2, "0")}</strong><span>/ {c.target}</span><small>{Math.round(pct)}%</small></div><div className="progress-track"><span style={{ width: `${pct}%` }} /></div>{c.achievedAt && <p className="achievement">抵达一百 · {dateLabel(c.achievedAt)}</p>}</Link>;
}
function ChallengePage({ data, challenge: c, run, pending }: { data: JournalData; challenge: Challenge; run: Run; pending: boolean }) {
  const [picker, setPicker] = useState(false), [filter, setFilter] = useState("");
  const completed = completedEntries(c, data.entries), done = new Set(completed.map(e => e.id));
  const waiting = data.entries.filter(e => !e.deletedAt && c.entryIds.includes(e.id) && !done.has(e.id));
  const candidates = data.entries.filter(e => !e.deletedAt && e.kind === c.kind && e.title.toLowerCase().includes(filter.toLowerCase()) && e.personalRecords.some(r => r.removedAt === null));
  return <><Link href="/challenges" className="back-link"><ArrowLeft size={15} />所有挑战</Link><PageHeading title={c.title} subtitle="两人都已完成，并确认确实一起完成，才点亮这一格。" action={<Button onClick={() => setPicker(true)}><Plus size={15} />选择参与作品</Button>} />
    <div className={`challenge-detail ${c.kind}`}><div className="challenge-numbers"><strong>{String(completed.length).padStart(2, "0")}</strong><span>/ {c.target}</span><small>{Math.min(100, Math.round(completed.length / c.target * 100))}% 已完成</small></div>{c.achievedAt && <p className="achievement"><Trophy size={15} />完成纪念 · {dateLabel(c.achievedAt)}</p>}<div className="hundred-grid">{Array.from({ length: c.target }, (_, i) => completed[i] ? <Link href={`/entry/${completed[i].id}`} title={`${i + 1}. ${completed[i].title}`} aria-label={`第${i + 1}格：${completed[i].title}`} key={i}><Cover entry={completed[i]} /><span>{String(i + 1).padStart(2, "0")}</span></Link> : <div className="empty-slot" key={i}>{String(i + 1).padStart(2, "0")}</div>)}</div><p className="catalog-footnote">每部作品只点亮一次。重温的回忆，可以有很多次。</p></div>
    <section className="home-section"><SectionHeading title={`待完成 · ${waiting.length}`} />{waiting.length ? <div className="catalog-grid">{waiting.map(e => <div key={e.id}><EntryCard entry={e} data={data} /><p className="waiting-reason">{e.sharedStatus !== "completed" ? "等待双方完成" : !e.together || e.together.revokedAt !== null ? "等待确认一起完成" : "等待更新"}</p></div>)}</div> : <div className="quiet-empty">从已有清单中选择想参与挑战的作品。</div>}</section>
    <Modal open={picker} onOpenChange={setPicker} title="选择参与作品" description="这里只修改挑战清单，不会改变任何人的个人状态。"><div className="challenge-picker"><div className="search-box"><Search size={16} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="搜索已有作品" aria-label="搜索参与作品" /></div>{candidates.length ? candidates.map(e => <label className="picker-item" key={e.id}><SaveCheckbox checked={c.entryIds.includes(e.id)} disabled={pending} label={`选择${e.title}`} onCommit={value => run(() => setChallenge({ entryId: e.id, revision: e.revision, joined: value }))} /><Cover entry={e} /><span><strong>{e.title}</strong><small>{e.creator}</small></span></label>) : <p className="quiet-empty">先到自己的清单添加作品，再选择参与挑战。</p>}<Button variant="secondary" onClick={() => setPicker(false)}>完成选择</Button></div></Modal>
  </>;
}
function TrashPage({ data, run, pending }: { data: JournalData; run: Run; pending: boolean }) {
  const entries = data.entries.filter(e => !e.deletedAt && e.personalRecords.some(r => r.userId === data.me.id && r.removedAt !== null));
  return <><PageHeading title="我的回收站" action={<Link href="/photos?trash=1" className="button secondary">照片回收站</Link>} subtitle="恢复个人记录后，会重新计算共同清单和挑战。对方的记录一直保留。" />{entries.length ? <div className="trash-list">{entries.map(e => { const record = e.personalRecords.find(r => r.userId === data.me.id)!; return <div className="trash-item" key={e.id}><Cover entry={e} /><div><h3 className="serif">{e.title}</h3><p>{dateLabel(record.removedAt)} 移除</p></div><Button variant="secondary" busy={pending} onClick={() => { void run(() => personalRecordCommand({ entryId: e.id, revision: record.revision, command: "restore" }), "已恢复你的记录"); }}><Undo2 size={15} />恢复</Button></div>; })}</div> : <Empty title="没有暂时收起的记录" text="从你的清单移除的记录会保留在这里。" />}</>;
}
