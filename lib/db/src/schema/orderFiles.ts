import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

export const orderFilesTable = pgTable("bk_order_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  fileType: text("file_type").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectPath: text("object_path").notNull().unique(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  // Archive ("Bin"): hidden from normal lists, restorable; only an administrator can purge it for good.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
  archiveReason: text("archive_reason"),
});

export const insertOrderFileSchema = createInsertSchema(orderFilesTable).omit({
  id: true,
  createdAt: true,
  uploadedAt: true,
});
export type InsertOrderFile = typeof orderFilesTable.$inferInsert;
export type OrderFile = typeof orderFilesTable.$inferSelect;
