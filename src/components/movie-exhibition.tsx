"use client";
import { ArrowUpRight } from "lucide-react";
import { groupMovies } from "@/lib/movie-themes";
import type { Entry, JournalData } from "@/lib/types";
import type { EditState } from "./editor-types";
import { EntryCard } from "./catalog";
export function MovieExhibition({ entries, data, view, from, edit, onShowAll }: { entries: Entry[]; data: JournalData; view: string; from: string; edit: (v: EditState) => void; onShowAll: (theme: string) => void }) {
  const groups = groupMovies(entries);
  return <div className="movie-exhibition"><nav className="theme-navigation" aria-label="电影主题导航">{groups.map(g => <a key={g.key} href={`#theme-${g.key}`}>{g.title}<span>{g.entries.length}</span></a>)}</nav>
    {groups.map((group, index) => {
      const shown = group.entries.slice(0, 5), backdrop = shown.find(e => e.coverId)?.coverId;
      return <section className={`movie-chapter theme-${group.key}`} id={`theme-${group.key}`} key={group.key} aria-labelledby={`theme-heading-${group.key}`}>
        {backdrop && <img className="chapter-atmosphere" src={`/api/assets/${backdrop}`} alt="" aria-hidden="true" loading="lazy" />}
        <header className="chapter-heading"><div><span className="chapter-number">{String(index + 1).padStart(2, "0")}</span><h2 id={`theme-heading-${group.key}`} className="serif">{group.title}</h2><span className="chapter-count">{group.entries.length} 部</span><p>{group.subtitle}</p></div><button className="text-link" onClick={() => onShowAll(group.key)}>查看全部<ArrowUpRight size={16} /></button></header>
        <div className="chapter-stage">{shown.map(entry => <EntryCard entry={entry} key={entry.id} data={data} view={view} from={from} edit={edit} />)}</div>
      </section>;
    })}
  </div>;
}
