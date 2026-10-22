export type Kind = "movie" | "book";
export type Status = "planned" | "in_progress" | "completed";
export type Member = { id: string; name: string; email: string; seat: number; color: string; avatarId: string | null };
export type EntryLink = { label: string; url: string };
export type PersonalRecord = {
  entryId: string; userId: string; status: Status; startedOn: string | null; completedOn: string | null;
  pinned: boolean; createdAt: number; updatedAt: number; revision: number; removedAt: number | null;
};
export type TogetherConfirmation = { entryId: string; completedOn: string | null; recordedBy: string; createdAt: number; revision: number; revokedAt: number | null };
export type RecommendationStatus = "pending" | "accepted" | "dismissed" | "withdrawn" | "resolved";
export type Recommendation = { id: string; entryId: string; senderId: string; recipientId: string; note: string; status: RecommendationStatus; revision: number; createdAt: number; updatedAt: number };
export type Review = { id: string; entryId: string; userId: string; rating: number | null; body: string; revision: number };
export type Memory = { id: string; entryId: string; date: string | null; place: string; body: string; photos: string[]; revision: number; createdAt: number };
export type Entry = {
  id: string; kind: Kind; title: string; summary: string; creator: string; year: number | null;
  coverId: string | null; links: EntryLink[]; tags: string[]; personalRecords: PersonalRecord[];
  sharedStatus: Status | null; together: TogetherConfirmation | null;
  revision: number; createdAt: number; updatedAt: number; deletedAt: number | null;
  metadata?: import("./catalog-metadata").CatalogMetadata | null;
};
export type Challenge = { id: string; kind: Kind; title: string; target: number; entryIds: string[]; achievedAt: number | null };
export type JournalData = {
  me: Member; members: Member[]; entries: Entry[]; reviews: Review[]; memories: Memory[];
  challenges: Challenge[]; settings: { name: string; subtitle: string; revision: number }; demo: boolean;
  recommendations: Recommendation[];
};
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean };
