import { uuid } from "drizzle-orm/pg-core";
import { sourceEmailAttachmentsTable, sourceEmailsTable } from "./sourceEmails";

// Provenance columns shared by every table the intake fills in. Null means a
// staff member entered the row by hand.
export const provenanceColumns = () => ({
  sourceEmailId: uuid("source_email_id").references(() => sourceEmailsTable.id, { onDelete: "set null" }),
  sourceAttachmentId: uuid("source_attachment_id").references(() => sourceEmailAttachmentsTable.id, {
    onDelete: "set null",
  }),
});
