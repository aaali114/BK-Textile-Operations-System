import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orderFilesTable } from "./orderFiles";
import { ordersTable } from "./orders";

// One row per message fetched over IMAP from orders@bktextile.com and kept
// because it matched at least one order. Messages that match nothing are not
// stored (see replit.md -> Data rules).
export const sourceEmailsTable = pgTable(
  "bk_source_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailbox: text("mailbox").notNull(),
    imapFolder: text("imap_folder").notNull(),
    imapUidvalidity: bigint("imap_uidvalidity", { mode: "number" }).notNull(),
    imapUid: bigint("imap_uid", { mode: "number" }).notNull(),
    // RFC 5322 Message-ID. Unique so the same email forwarded from both
    // primary mailboxes is stored once.
    messageId: text("message_id").notNull().unique(),
    inReplyTo: text("in_reply_to"),
    referencesHeader: text("references_header"),
    threadKey: text("thread_key"),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    // Which primary BK mailbox the cPanel forwarder delivered it from
    // (Delivered-To / X-Forwarded-To), when the headers say.
    forwardedVia: text("forwarded_via"),
    subject: text("subject").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    bodyText: text("body_text"),
    // Full .eml in object storage; HTML bodies are read from here.
    rawObjectPath: text("raw_object_path").notNull().unique(),
    // order_details | tech_pack | trims_accessories | sample_requirements |
    // packaging | amendment | other | unclassified
    category: text("category").notNull().default("unclassified"),
    // pending | parsed | partial | failed
    parseStatus: text("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("bk_source_emails_imap_position_unique").on(t.mailbox, t.imapFolder, t.imapUidvalidity, t.imapUid),
    index("bk_source_emails_in_reply_to_idx").on(t.inReplyTo),
    index("bk_source_emails_thread_key_idx").on(t.threadKey),
    index("bk_source_emails_received_at_idx").on(t.receivedAt),
  ],
);

// Links emails to orders. Normally one order per email; the link table keeps
// room for an email that genuinely covers two POs, and records how it matched.
export const sourceEmailOrdersTable = pgTable(
  "bk_source_email_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => sourceEmailsTable.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    // matched | needs_review | ignored
    matchStatus: text("match_status").notNull(),
    // po_subject | invoice_ref | thread | po_body_only | manual
    matchMethod: text("match_method").notNull(),
    // Human-readable evidence, e.g. 'subject: "PO# 36572"'.
    matchReason: text("match_reason"),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when staff confirm or override a needs_review link.
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    unique("bk_source_email_orders_email_order_unique").on(t.emailId, t.orderId),
    index("bk_source_email_orders_order_idx").on(t.orderId, t.matchStatus),
  ],
);

export const sourceEmailAttachmentsTable = pgTable(
  "bk_source_email_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => sourceEmailsTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Spots the same PO sheet or tech pack re-sent in several emails.
    sha256: text("sha256").notNull(),
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),
    objectPath: text("object_path").notNull().unique(),
    // Text pulled from PDF / spreadsheet attachments, which often carry the
    // size grids, fabric and trim details. pending | extracted | failed | not_applicable
    extractStatus: text("extract_status").notNull().default("pending"),
    extractedText: text("extracted_text"),
    extractError: text("extract_error"),
    // Set when staff promote the attachment into the order's files.
    orderFileId: uuid("order_file_id").references(() => orderFilesTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bk_source_email_attachments_email_idx").on(t.emailId),
    index("bk_source_email_attachments_sha256_idx").on(t.sha256),
  ],
);
