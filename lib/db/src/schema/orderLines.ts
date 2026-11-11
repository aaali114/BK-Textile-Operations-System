import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { provenanceColumns } from "./provenance";

// Priced lines on a PO: a style in a given process/finish. One PO can carry
// the same style in two finishes at different prices.
export const orderLinesTable = pgTable(
  "bk_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    styleNumber: text("style_number").notNull(),
    // As written on the PO, e.g. "GARMENT DYED CREW".
    description: text("description").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 4, mode: "number" }),
    quantity: integer("quantity").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bk_order_lines_order_style_description_unique").on(t.orderId, t.styleNumber, t.description),
    check("bk_order_lines_quantity_nonnegative", sql`${t.quantity} >= 0`),
  ],
);
