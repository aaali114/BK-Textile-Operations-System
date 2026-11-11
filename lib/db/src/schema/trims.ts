import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { colourwaysTable, provenanceColumns } from "./colourways";
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
  (t) => [index("bk_order_trims_order_idx").on(t.orderId)],
);
