import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const ordersTable = pgTable(
  "bk_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    buyer: text("buyer").notNull(),
    agencyName: text("agency_name"),
    previousOrderReference: text("previous_order_reference"),
    orderValue: numeric("order_value", { precision: 14, scale: 2, mode: "number" }),
    currencyCode: text("currency_code"),
    // Buyer's purchase order number. Not unique: sub-invoices (e.g. 4040 and
    // 4040-A) can share one PO.
    poNumber: text("po_number"),
    // BK Team invoice number: 4 digits, optionally a sub-invoice suffix
    // ("4040", "4040-A"; a sub-invoice suffix is always one letter). The
    // intake matches emails on this plus the PO.
    bkInvoiceNumber: text("bk_invoice_number").unique(),
    // A sub-invoice (4040-A) points at its parent invoice's order (4040).
    parentOrderId: uuid("parent_order_id").references((): AnyPgColumn => ordersTable.id, {
      onDelete: "set null",
    }),
    style: text("style").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("development"),
    priority: text("priority").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("bk_orders_po_number_idx").on(t.poNumber),
    index("bk_orders_parent_order_id_idx").on(t.parentOrderId),
    check(
      "bk_orders_bk_invoice_number_format",
      sql`${t.bkInvoiceNumber} IS NULL OR ${t.bkInvoiceNumber} ~ '^[0-9]{4}(-[A-Z])?$'`,
    ),
  ],
);
