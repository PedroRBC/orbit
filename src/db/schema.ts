import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: integer().primaryKey({ autoIncrement: true }),
  channelId: text().notNull().unique(),
  name: text().notNull(),
  kind: text({ enum: ["youtube_rss", "youtube_home", "x_for_you", "instagram_feed", "valete_feed", "news_rss"] }).notNull().default("youtube_rss"),
  platform: text({ enum: ["youtube", "x", "instagram", "valete", "news"] }).notNull().default("youtube"),
  enabled: integer({ mode: "boolean" }).notNull().default(true),
  cooldownUntil: integer(),
});

export const rawItems = sqliteTable("raw_items", {
  id: text().primaryKey(),
  sourceId: integer().notNull().references(() => sources.id),
  platform: text().notNull(),
  externalId: text().notNull(),
  title: text().notNull(),
  text: text().notNull(),
  author: text().notNull(),
  url: text().notNull().unique(),
  thumbnail: text(),
  publishedAt: integer(),
  durationSeconds: integer(),
  evidence: text({ enum: ["rss", "youtube_home", "x_for_you", "instagram_feed", "valete_feed", "valete_dom", "news_rss"] }).notNull().default("rss"),
  metrics: text({ mode: "json" }).$type<Record<string, string>>(),
  fetchedAt: integer().notNull(),
});

export const sourceItems = sqliteTable("source_items", {
  sourceId: integer().notNull().references(() => sources.id),
  rawId: text().notNull().references(() => rawItems.id),
}, table => [primaryKey({ columns: [table.sourceId, table.rawId] })]);

export const processedItems = sqliteTable("processed_items", {
  rawId: text().primaryKey().references(() => rawItems.id),
  theme: text().notNull(),
  tone: text().notNull(),
  language: text().notNull(),
  type: text().notNull(),
  score: integer().notNull(),
  reason: text().notNull(),
  summary: text().notNull(),
  isSpam: integer({ mode: "boolean" }).notNull(),
  model: text().notNull(),
  processedAt: integer().notNull(),
  clusterId: text().references(() => topics.id),
});

export const interestProfile = sqliteTable("interest_profile", {
  id: integer().primaryKey(),
  interests: text().notNull(),
  excluded: text().notNull(),
  weights: text().notNull().default("{}"),
  updatedAt: integer().notNull(),
});

export const collectorRuns = sqliteTable("collector_runs", {
  id: integer().primaryKey({ autoIncrement: true }),
  sourceId: integer().references(() => sources.id),
  parentId: integer(),
  trigger: text({ enum: ["manual", "scheduled"] }).notNull().default("manual"),
  status: text().notNull(),
  startedAt: integer().notNull(),
  finishedAt: integer(),
  itemCount: integer().notNull().default(0),
  error: text(),
});

export const companionJobs = sqliteTable("companion_jobs", {
  id: text().primaryKey(),
  sourceId: integer().notNull().references(() => sources.id),
  runId: integer().notNull().references(() => collectorRuns.id),
  owner: text().notNull(),
  status: text().notNull(),
  createdAt: integer().notNull(),
  expiresAt: integer().notNull(),
  result: text({ mode: "json" }).$type<import("../collectors/types").RawItem[]>(),
  errorCode: text(),
});

export const briefings = sqliteTable("briefings", {
  id: integer().primaryKey({ autoIncrement: true }),
  snapshot: text().notNull().unique(),
  introduction: text().notNull(),
  createdAt: integer().notNull(),
  windowFrom: integer().notNull(),
  windowTo: integer().notNull(),
  model: text().notNull(),
  sourceCount: integer().notNull(),
  candidateCount: integer().notNull().default(0),
  budgetLimited: integer({ mode: "boolean" }).notNull().default(false),
});

export const topics = sqliteTable("topics", {
  id: text().primaryKey(),
  briefingId: integer().notNull().references(() => briefings.id),
  position: integer().notNull(),
  title: text().notNull(),
  summary: text().notNull(),
  itemIds: text().notNull(),
});

export const feedback = sqliteTable("feedback", {
  rawId: text().primaryKey().references(() => rawItems.id),
  vote: integer().notNull().default(0),
  saved: integer({ mode: "boolean" }).notNull().default(false),
  seen: integer({ mode: "boolean" }).notNull().default(false),
  clicked: integer({ mode: "boolean" }).notNull().default(false),
  updatedAt: integer().notNull(),
});

export const settings = sqliteTable("settings", { key: text().primaryKey(), value: text().notNull() });

export const aiCalls = sqliteTable("ai_calls", {
  id: integer().primaryKey({ autoIncrement: true }),
  day: text().notNull(),
  tokens: integer().notNull(),
  cost: real(),
  status: text().notNull(),
  createdAt: integer().notNull(),
});
