import { sql } from "drizzle-orm";
import { boolean, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { colourwaysTable } from "./colourways";
import { provenanceColumns } from "./provenance";
import { ordersTable } from "./orders";

export const trimsTable = pgTable(
  "bk_order_trims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    // Null = applies to every colourway on the order.
    colourwayId: uuid("colourway_id").references(() => colourwaysTable.id, { onDelete: "cascade" }),
    // Set for size-specific trims such as size labels.
    sizeLabel: text("size_label"),
    // main_label | care_label | size_label | hangtag | button | zip | thread |
    // polybag | carton | other
    trimType: text("trim_type").notNull(),
    // The item as named in the source ("hang tag", "care label"); a PO line and
    // a later trims sheet naming the same item update the same row.
    sourceLabel: text("source_label"),
    // False when the source says the item is not required.
    required: boolean("required").notNull().default(true),
    description: text("description").notNull(),
    supplier: text("supplier"),
    quantityPerPiece: numeric("quantity_per_piece", { precision: 12, scale: 4, mode: "number" }),
    unit: text("unit"),
    // Nominated or supplied by the buyer.
    buyerSupplied: boolean("buyer_supplied").notNull().default(false),
    notes: text("notes").notNull().default(""),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("bk_order_trims_order_idx").on(t.orderId),
    uniqueIndex("bk_order_trims_order_source_label_unique")
      .on(t.orderId, t.sourceLabel)
      .where(sql`${t.sourceLabel} IS NOT NULL AND ${t.colourwayId} IS NULL AND ${t.sizeLabel} IS NULL`),
  ],
);
