import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const workItemsTable = pgTable("bk_work_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  department: text("department").notNull(),
  assignee: text("assignee"),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("normal"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
