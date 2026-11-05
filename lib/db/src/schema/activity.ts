import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const activityTable = pgTable("bk_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  description: text("description").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
