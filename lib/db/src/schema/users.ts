import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * People who have signed in. Passwords and sign-in stay with Clerk; this
 * table holds who they are and what they may do. Everyone starts as
 * "pending" with no access until the administrator (or deputy) approves.
 */
export const usersTable = pgTable(
  "bk_users",
  {
    // Clerk user ID
    id: text("id").primaryKey(),
    email: text("email"),
    name: text("name"),
    // pending | active | disabled
    status: text("status").notNull().default("pending"),
    // admin (at most 2) | deputy (at most 2) | user; limits enforced in api-server lib/userAdmin.ts
    role: text("role").notNull().default("user"),
    // merchandising, fabrication, export, accounts, ... (see Department in the API)
    department: text("department"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    check("bk_users_status_valid", sql`${t.status} IN ('pending', 'active', 'disabled')`),
    check("bk_users_role_valid", sql`${t.role} IN ('admin', 'deputy', 'user')`),
    index("bk_users_role_idx").on(t.role),
  ],
);

/** Per-area access: no row means no access. */
export const userAreaAccessTable = pgTable(
  "bk_user_area_access",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // dashboard | merchandising | department_work | materials | quality
    area: text("area").notNull(),
    // read | write
    level: text("level").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.area] }),
    check("bk_user_area_access_level_valid", sql`${t.level} IN ('read', 'write')`),
  ],
);

/** Special permissions granted one by one. */
export const userPermissionsTable = pgTable(
  "bk_user_permissions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // invoice_override | commercial_edit | intake_run
    permission: text("permission").notNull(),
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] }), index("bk_user_permissions_permission_idx").on(t.permission)],
);
