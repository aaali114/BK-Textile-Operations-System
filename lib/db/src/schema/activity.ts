import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { sourceEmailsTable } from "./sourceEmails";

// The work log: a record of who changed what, by staff or by the email intake.
export const activityTable = pgTable(
  "bk_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    actorId: text("actor_id"),
    description: text("description").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
    // staff | email_intake | system
    source: text("source").notNull().default("staff"),
    // Machine-readable verb, e.g. intake.run, email.matched, size_qty.updated.
    action: text("action"),
    // Before/after values, parser warnings, skipped IMAP UIDs. Never
    // credentials, and never content of emails that matched no order.
    details: jsonb("details"),
    sourceEmailId: uuid("source_email_id").references(() => sourceEmailsTable.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bk_activity_order_occurred_idx").on(t.orderId, t.occurredAt.desc())],
);
