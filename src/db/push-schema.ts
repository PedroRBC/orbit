import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text().primaryKey(),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  createdAt: integer().notNull(),
});

export const pushDeliveries = sqliteTable("push_deliveries", {
  id: integer().primaryKey({ autoIncrement: true }),
  // Sem FK: a exclusão da inscrição preserva a deduplicação sem guardar endpoint ou chaves.
  subscriptionId: text().notNull(),
  editionId: integer().notNull(),
  kind: text({ enum: ["edition", "test"] }).notNull().default("edition"),
  status: text({ enum: ["queued", "attempted", "sent", "failed", "expired", "cancelled"] }).notNull().default("queued"),
  createdAt: integer().notNull(),
  attemptedAt: integer(),
}, table => [
  uniqueIndex("push_deliveries_edition").on(table.subscriptionId, table.editionId).where(sql`${table.kind} = 'edition'`),
  index("push_deliveries_status").on(table.status, table.id),
]);
