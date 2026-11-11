import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Buyers / sourcing agents that issue POs. The abbreviation goes into the BK
// invoice reference (4040/BK-SAS/2026). Email domains help matching when a PO
// number alone is not enough.
export const buyersTable = pgTable(
  "bk_buyers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    abbreviation: text("abbreviation").notNull().unique(),
    emailDomains: text("email_domains").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [check("bk_buyers_abbreviation_format", sql`${t.abbreviation} ~ '^[A-Z]{2,5}$'`)],
);

// Single-row counter for BK invoice numbers. One sequence across all buyers
// and years (4051 on 31 Dec is followed by 4052 on 1 Jan). Taken with a row
// lock inside the order-creating transaction so numbers never skip or repeat;
// see assignInvoiceNumber() in ../invoices.ts.
export const invoiceCounterTable = pgTable(
  "bk_invoice_counter",
  {
    id: smallint("id").primaryKey().default(1),
    lastNumber: integer("last_number").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("bk_invoice_counter_single_row", sql`${t.id} = 1`)],
);
