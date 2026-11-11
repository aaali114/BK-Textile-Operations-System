import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { colourwaysTable } from "./colourways";
import { provenanceColumns } from "./provenance";
import { ordersTable } from "./orders";

export const fabricsTable = pgTable(
  "bk_order_fabrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    // Null = applies to every colourway on the order.
    colourwayId: uuid("colourway_id").references(() => colourwaysTable.id, { onDelete: "cascade" }),
    placement: text("placement").notNull(),
    description: text("description").notNull(),
    composition: text("composition"),
    construction: text("construction"),
    gsm: integer("gsm"),
    widthCm: numeric("width_cm", { precision: 12, scale: 4, mode: "number" }),
    colour: text("colour"),
    supplier: text("supplier"),
    consumptionPerPiece: numeric("consumption_per_piece", { precision: 12, scale: 4, mode: "number" }),
    consumptionUnit: text("consumption_unit"),
    notes: text("notes").notNull().default(""),
    ...provenanceColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("bk_order_fabrics_order_idx").on(t.orderId)],
);
