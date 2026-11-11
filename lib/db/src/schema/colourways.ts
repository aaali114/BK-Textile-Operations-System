import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";
import { orderLinesTable } from "./orderLines";
import { provenanceColumns } from "./provenance";

export const colourwaysTable = pgTable(
  "bk_order_colourways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    // The PO line (style + process) this colour belongs to. The same colour
    // name can appear under two lines.
    lineId: uuid("line_id").references(() => orderLinesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    buyerReference: text("buyer_reference"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("bk_order_colourways_order_line_code_unique").on(t.orderId, t.lineId, t.code).nullsNotDistinct()],
);

// One row per colourway x size, so any size range fits without schema changes.
export const sizeQuantitiesTable = pgTable(
  "bk_order_size_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    colourwayId: uuid("colourway_id")
      .notNull()
      .references(() => colourwaysTable.id, { onDelete: "cascade" }),
    sizeLabel: text("size_label").notNull(),
    sizeSort: integer("size_sort").notNull(),
    quantity: integer("quantity").notNull(),
    ...provenanceColumns(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bk_order_size_quantities_colourway_size_unique").on(t.colourwayId, t.sizeLabel),
    index("bk_order_size_quantities_order_idx").on(t.orderId),
    check("bk_order_size_quantities_quantity_nonnegative", sql`${t.quantity} >= 0`),
  ],
);
