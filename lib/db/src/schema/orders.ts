import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const ordersTable = pgTable("bk_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull().unique(),
  buyer: text("buyer").notNull(),
  poNumber: text("po_number"),
  style: text("style").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("development"),
  priority: text("priority").notNull().default("normal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
