import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { buyersTable } from "./buyers";

// One order = one buyer PO = one BK invoice. The PO number is the key for
// extraction, sorting and communication; a revised PO with the same number
// updates this order, a new PO number is always a new order.
export const ordersTable = pgTable(
  "bk_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    buyer: text("buyer").notNull(),
    // Null only on synthetic preview orders created before buyers existed.
    buyerId: uuid("buyer_id").references(() => buyersTable.id, { onDelete: "restrict" }),
    agencyName: text("agency_name"),
    // The brand / end customer behind a sourcing agent, when the PO names one.
    endCustomer: text("end_customer"),
    previousOrderReference: text("previous_order_reference"),
    orderValue: numeric("order_value", { precision: 14, scale: 2, mode: "number" }),
    currencyCode: text("currency_code"),
    // Buyer's PO number. Unique per buyer.
    poNumber: text("po_number"),
    // BK invoice: sequential number plus the formatted reference
    // "{number}/BK-{buyer abbreviation}/{year received}", e.g. 4040/BK-SAS/2026.
    invoiceNumber: integer("invoice_number").unique(),
    invoiceRef: text("invoice_ref").unique(),
    // When the PO first reached BK; its year goes into invoiceRef.
    poReceivedAt: timestamp("po_received_at", { withTimezone: true }),
    poIssueDate: date("po_issue_date", { mode: "string" }),
    priceTerms: text("price_terms"),
    paymentTerms: text("payment_terms"),
    shipVia: text("ship_via"),
    countryOfOrigin: text("country_of_origin"),
    // Over-shipment the buyer allows, e.g. 3.00 for "3% over PO quantity".
    overShipTolerancePct: numeric("over_ship_tolerance_pct", { precision: 5, scale: 2, mode: "number" }),
    style: text("style").notNull(),
    description: text("description"),
    quantity: integer("quantity").notNull(),
    // Ship date on the PO.
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("development"),
    priority: text("priority").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("bk_orders_po_number_idx").on(t.poNumber),
    unique("bk_orders_buyer_po_unique").on(t.buyerId, t.poNumber),
    check(
      "bk_orders_invoice_ref_format",
      sql`${t.invoiceRef} IS NULL OR ${t.invoiceRef} ~ '^[0-9]+/BK-[A-Z]{2,5}/[0-9]{4}$'`,
    ),
    check(
      "bk_orders_invoice_number_with_ref",
      sql`(${t.invoiceNumber} IS NULL) = (${t.invoiceRef} IS NULL)`,
    ),
  ],
);
