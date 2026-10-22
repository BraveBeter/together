import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { EntryLink, Kind, RecommendationStatus, Status } from "../lib/types";
import type { CatalogMetadata } from "../lib/catalog-metadata";
export const user = sqliteTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false), image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const session = sqliteTable("session", {
  id: text("id").primaryKey(), expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});
export const account = sqliteTable("account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }), refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }), scope: text("scope"), password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey().references(() => user.id), seat: integer("seat").notNull().unique(), color: text("color").notNull(), avatarId: text("avatar_id"),
});
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(), name: text("name").notNull(), subtitle: text("subtitle").notNull(), revision: integer("revision").notNull().default(0),
});
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id), mime: text("mime").notNull(),
  filename: text("filename").notNull(), size: integer("size").notNull(), createdAt: integer("created_at").notNull(),
});
export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(), kind: text("kind").$type<Kind>().notNull(), title: text("title").notNull(), summary: text("summary").notNull().default(""),
  coverId: text("cover_id").references(() => assets.id), links: text("links", { mode: "json" }).$type<EntryLink[]>().notNull().default([]), tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false), next: integer("is_next", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(0), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), deletedAt: integer("deleted_at"),
  sharedAddedAt: integer("shared_added_at"),
  metadata: text("metadata", { mode: "json" }).$type<CatalogMetadata>(),
});
export const movies = sqliteTable("movies", {
  entryId: text("entry_id").primaryKey().references(() => entries.id, { onDelete: "cascade" }), director: text("director").notNull().default(""), year: integer("year"), status: text("status").$type<Status>().notNull().default("planned"), completedAt: integer("completed_at"),
});
export const books = sqliteTable("books", {
  entryId: text("entry_id").primaryKey().references(() => entries.id, { onDelete: "cascade" }), author: text("author").notNull().default(""), year: integer("year"),
});
export const readingProgress = sqliteTable("reading_progress", {
  entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }), userId: text("user_id").notNull().references(() => user.id),
  status: text("status").$type<Status>().notNull().default("planned"), startedAt: integer("started_at"), completedAt: integer("completed_at"), revision: integer("revision").notNull().default(0),
}, t => [uniqueIndex("reading_unique").on(t.entryId, t.userId)]);
export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(), entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id), rating: real("rating"), body: text("body").notNull().default(""), revision: integer("revision").notNull().default(0),
}, t => [uniqueIndex("review_unique").on(t.entryId, t.userId)]);
export const personalRecords = sqliteTable("personal_records", {
  entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id), completedOn: text("completed_on"),
  status: text("status").$type<Status>().notNull().default("completed"), startedOn: text("started_on"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false), updatedAt: integer("updated_at").notNull().default(0),
  createdAt: integer("created_at").notNull(), revision: integer("revision").notNull().default(1), removedAt: integer("removed_at"),
}, t => [uniqueIndex("personal_record_unique").on(t.entryId, t.userId)]);
export const recommendations = sqliteTable("recommendations", {
  id: text("id").primaryKey(), entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => user.id), recipientId: text("recipient_id").notNull().references(() => user.id),
  note: text("note").notNull().default(""), status: text("status").$type<RecommendationStatus>().notNull(),
  revision: integer("revision").notNull().default(1), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("recommendation_unique").on(t.entryId, t.senderId, t.recipientId)]);
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(), entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }), date: text("date"), place: text("place").notNull().default(""),
  body: text("body").notNull(), photos: text("photos", { mode: "json" }).$type<string[]>().notNull().default([]), revision: integer("revision").notNull().default(0), createdAt: integer("created_at").notNull(), deletedAt: integer("deleted_at"),
});
export const challenges = sqliteTable("challenges", {
  id: text("id").primaryKey(), kind: text("kind").$type<Kind>().notNull(), title: text("title").notNull(), target: integer("target").notNull(), achievedAt: integer("achieved_at"),
});
export const challengeEntries = sqliteTable("challenge_entries", {
  challengeId: text("challenge_id").notNull().references(() => challenges.id), entryId: text("entry_id").notNull().references(() => entries.id, { onDelete: "cascade" }),
}, t => [uniqueIndex("challenge_entry_unique").on(t.challengeId, t.entryId)]);

export const togetherConfirmations = sqliteTable("together_confirmations", {
  entryId: text("entry_id").primaryKey().references(() => entries.id, { onDelete: "cascade" }),
  completedOn: text("completed_on"), recordedBy: text("recorded_by").notNull().references(() => user.id),
  createdAt: integer("created_at").notNull(), revision: integer("revision").notNull().default(1), revokedAt: integer("revoked_at"),
});

// Photos remain independent from book/movie entries and reuse private assets.
export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(), title: text("title").notNull(), description: text("description").notNull().default(""),
  coverPhotoId: text("cover_photo_id"), createdBy: text("created_by").notNull().references(() => user.id),
  revision: integer("revision").notNull().default(1), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), deletedAt: integer("deleted_at"),
});
export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(), assetId: text("asset_id").notNull().unique().references(() => assets.id), contentHash: text("content_hash").notNull().unique(),
  caption: text("caption").notNull().default(""), width: integer("width").notNull(), height: integer("height").notNull(), takenOn: text("taken_on"),
  originalMetadata: text("original_metadata", { mode: "json" }).$type<import("../lib/photo-types").OriginalPhotoMetadata>().notNull(),
  latitude: real("latitude"), longitude: real("longitude"), place: text("place").notNull().default(""), locationSource: text("location_source").$type<"exif" | "manual" | "amap">(),
  tripId: text("trip_id").references(() => trips.id), uploadedBy: text("uploaded_by").notNull().references(() => user.id),
  revision: integer("revision").notNull().default(1), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), deletedAt: integer("deleted_at"),
});
export const photoParticipants = sqliteTable("photo_participants", {
  photoId: text("photo_id").notNull().references(() => photos.id), userId: text("user_id").notNull().references(() => members.userId),
}, t => [uniqueIndex("photo_participants_unique").on(t.photoId, t.userId)]);
export const photoComments = sqliteTable("photo_comments", {
  id: text("id").primaryKey(), photoId: text("photo_id").notNull().references(() => photos.id), authorId: text("author_id").notNull().references(() => members.userId),
  body: text("body").notNull(), revision: integer("revision").notNull().default(1), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), deletedAt: integer("deleted_at"),
});
