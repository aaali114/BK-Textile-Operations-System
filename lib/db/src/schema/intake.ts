import { bigint, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Where the mailbox reader stopped, per mailbox folder. If the server's
// UIDVALIDITY changes, UIDs restart and the reader rescans that folder
// (duplicates are caught by Message-ID).
export const intakeCursorTable = pgTable(
  "bk_intake_cursor",
  {
    mailbox: text("mailbox").notNull(),
    imapFolder: text("imap_folder").notNull(),
    imapUidvalidity: bigint("imap_uidvalidity", { mode: "number" }).notNull(),
    lastUid: bigint("last_uid", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mailbox, t.imapFolder] })],
);
