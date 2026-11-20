import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Saved dashboards. Either a user's own (owner_user_id set) or a department
 * template set by an administrator/deputy (department set; "*" = everyone).
 * The layout is a validated list of widgets (see api-server lib/dashboards.ts).
 */
export const dashboardsTable = pgTable(
  "bk_dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    department: text("department"),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    layout: jsonb("layout").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check("bk_dashboards_owner_xor_department", sql`(${t.ownerUserId} IS NULL) <> (${t.department} IS NULL)`),
    uniqueIndex("bk_dashboards_one_template_per_department").on(t.department).where(sql`${t.department} IS NOT NULL`),
    uniqueIndex("bk_dashboards_one_default_per_user").on(t.ownerUserId).where(sql`${t.isDefault}`),
    index("bk_dashboards_owner_idx").on(t.ownerUserId),
  ],
);
