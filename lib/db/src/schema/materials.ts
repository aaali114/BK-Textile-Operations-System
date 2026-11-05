import { date, doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const materialLotsTable = pgTable("bk_material_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  material: text("material").notNull(),
  type: text("type").notNull(),
  supplier: text("supplier").notNull(),
  lotReference: text("lot_reference").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  status: text("status").notNull().default("pending_qc"),
  receivedAt: date("received_at", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inspectionsTable = pgTable("bk_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materialLotsTable.id, { onDelete: "cascade" }),
  inspectionType: text("inspection_type").notNull(),
  result: text("result").notNull(),
  defectCount: doublePrecision("defect_count").notNull().default(0),
  notes: text("notes").notNull().default(""),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull().defaultNow(),
});
