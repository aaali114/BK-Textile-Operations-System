import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

/**
 * Generated documents (cutting programs, packing lists; later accessory
 * sheets, POs, invoices). Lifecycle: draft -> in_review -> approved, with
 * changes_requested sending it back. Approved documents are frozen: their data
 * snapshot and files can never change or be deleted (enforced by a database
 * trigger, migration 0010); a correction is a new revision, which marks the
 * previous one superseded when it is approved.
 */
export const documentsTable = pgTable(
  "bk_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // restrict: an order with approved documents cannot be deleted
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    // cutting_program | packing_list
    type: text("type").notNull(),
    revision: integer("revision").notNull().default(1),
    // draft | in_review | changes_requested | approved | superseded
    status: text("status").notNull().default("draft"),
    docNumber: text("doc_number").notNull(),
    // editable while not approved: allowance, pieces per carton, texts
    settings: jsonb("settings").notNull(),
    // the exact data rendered, frozen at approval
    snapshot: jsonb("snapshot"),
    templateVersion: text("template_version").notNull(),
    // hash of the order data used; an approved document whose order data now hashes differently is "out of date"
    sourceHash: text("source_hash"),
    preparedBy: text("prepared_by").notNull(),
    // everyone who created, edited or submitted it: none of them may approve it (four-eyes)
    contributors: text("contributors").array().notNull().default([]),
    submittedBy: text("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    xlsxObjectPath: text("xlsx_object_path"),
    pdfObjectPath: text("pdf_object_path"),
    xlsxSha256: text("xlsx_sha256"),
    pdfSha256: text("pdf_sha256"),
    supersedesId: uuid("supersedes_id"),
    // Archive ("Bin"): hidden from normal lists, restorable; only an administrator can purge it for good.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by"),
    archiveReason: text("archive_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bk_documents_order_type_revision_unique").on(t.orderId, t.type, t.revision),
    // at most one document in progress per order and type
    uniqueIndex("bk_documents_one_open_per_type")
      .on(t.orderId, t.type)
      .where(sql`${t.status} IN ('draft', 'in_review', 'changes_requested') AND ${t.archivedAt} IS NULL`),
    index("bk_documents_status_idx").on(t.status),
  ],
);

/** Small key/value settings, e.g. the company letterhead ("company_profile"). */
export const settingsTable = pgTable("bk_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
