import { eq, isNull } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { intersectionStatus, completedEntries } from "./domain";
import { demoEnabled } from "./config";
import type { Entry, JournalData, Member } from "./types";
export function readData(me: Member): JournalData {
  const members = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, seat: s.members.seat, color: s.members.color, avatarId: s.members.avatarId })
    .from(s.members).innerJoin(s.user, eq(s.members.userId, s.user.id)).orderBy(s.members.seat).all();
  const movieMap = new Map(db.select().from(s.movies).all().map(m => [m.entryId, m]));
  const bookMap = new Map(db.select().from(s.books).all().map(b => [b.entryId, b]));
  const confirmations = db.select().from(s.togetherConfirmations).all();
  const personalRecords = db.select().from(s.personalRecords).all();
  const entries: Entry[] = db.select().from(s.entries).all().map(entry => {
    const movie = movieMap.get(entry.id), book = bookMap.get(entry.id);
    const ownRecords = personalRecords.filter(r => r.entryId === entry.id);
    const { sharedAddedAt: _legacy, pinned: _pin, next: _next, ...metadata } = entry;
    return { ...metadata, creator: movie?.director ?? book?.author ?? "", year: movie?.year ?? book?.year ?? null,
      personalRecords: ownRecords,
      sharedStatus: entry.deletedAt ? null : intersectionStatus(ownRecords, members.map(m => m.id), entry.kind),
      together: confirmations.find(c => c.entryId === entry.id) ?? null };
  });
  const relations = db.select().from(s.challengeEntries).all();
  const challenges = db.select().from(s.challenges).all().map(c => ({ ...c, entryIds: relations.filter(r => r.challengeId === c.id).map(r => r.entryId) }));
  return { me, members, entries, challenges, recommendations: db.select().from(s.recommendations).all(), reviews: db.select().from(s.reviews).all(),
    memories: db.select().from(s.memories).where(isNull(s.memories.deletedAt)).all(),
    settings: db.select().from(s.settings).where(eq(s.settings.id, "home")).get()!, demo: demoEnabled };
}
export function updateMilestones(member: Member) {
  const data = readData(member);
  for (const c of data.challenges) if (!c.achievedAt && completedEntries(c, data.entries).length >= c.target) {
    db.update(s.challenges).set({ achievedAt: Date.now() }).where(eq(s.challenges.id, c.id)).run();
  }
}
