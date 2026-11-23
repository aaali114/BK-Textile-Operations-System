import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  activityTable,
  db,
  documentsTable,
  orderFilesTable,
  ordersTable,
  sourceEmailAttachmentsTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
} from "@workspace/db";
import type { Access } from "./access";
import { logger } from "./logger";
import { parseEml } from "../intake/mime";
import { mentionsPo } from "../intake/match";
import { rebuildOrderFromEmails, type RebuildReport } from "../intake/reapply";
import { planAttachment, type BlobReader, type BlobRemover, type BlobStore } from "../intake/run";
import { poKey } from "../intake/text";

/**
 * The Bin. "Delete" anywhere in the app moves the item here: it disappears
 * from normal lists but can be restored by anyone with Write access to the
 * area. Only an administrator can empty it ("purge"), which removes the item
 * and its stored files for good. Approved documents are the exception on the
 * way in: only an administrator can move one to the Bin.
 *
 * What happens to the BK invoice number: an order in the Bin keeps it; a
 * purged order's number is retired and never handed out again.
 */
export class ArchiveError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type Blobs = BlobStore & BlobReader & BlobRemover;
type Kind = "order" | "file" | "email" | "document";
const FINAL = ["approved", "superseded"];
const OPEN = ["draft", "in_review", "changes_requested"];
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

const who = (a: Access) => a.name || a.email || a.userId;
export const isAdministrator = (a: Access) => a.status === "active" && a.role === "admin";
const cleanReason = (reason: unknown): string | null => (typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null);
const orderLabel = (o: { invoiceRef: string | null; reference: string }) => o.invoiceRef ?? o.reference;
const DOC_TITLE: Record<string, string> = { cutting_program: "Cutting program", packing_list: "Packing list" };

async function log(a: Access, entry: { entityType: string; entityId: string; orderId: string | null; action: string; description: string; details?: Record<string, unknown>; sourceEmailId?: string | null }) {
  await db.insert(activityTable).values({ actor: who(a), actorId: a.userId, source: "staff", ...entry, details: entry.details ?? {} });
}

async function loadOrder(orderId: string) {
  const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!o) throw new ArchiveError(404, "Order not found");
  return o;
}

/** Refuses changes to an order that is in the Bin. */
export async function assertOrderActive(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (o.archivedAt) throw new ArchiveError(409, `Order ${orderLabel(o)} is in the Bin. Restore it before making changes.`);
}

async function removeObjects(blobs: Blobs, paths: (string | null | undefined)[]) {
  for (const p of paths) {
    if (!p) continue;
    try {
      await blobs.remove(p);
    } catch (err) {
      // The database rows are already gone; a leftover file is harmless and is logged for cleanup.
      logger.warn({ err: (err as Error).message, objectPath: p }, "Could not delete a stored file during purge");
    }
  }
}

// ---------------------------------------------------------------- orders

export async function archiveOrder(a: Access, orderId: string, reason: unknown) {
  const o = await loadOrder(orderId);
  if (o.archivedAt) throw new ArchiveError(409, `Order ${orderLabel(o)} is already in the Bin.`);
  const [updated] = await db.update(ordersTable).set({ archivedAt: new Date(), archivedBy: who(a), archiveReason: cleanReason(reason) }).where(eq(ordersTable.id, orderId)).returning();
  await log(a, { entityType: "order", entityId: orderId, orderId, action: "order.archived", description: `Order ${orderLabel(o)} moved to the Bin${cleanReason(reason) ? `: ${cleanReason(reason)}` : ""}` });
  return updated!;
}

export async function restoreOrder(a: Access, orderId: string) {
  const o = await loadOrder(orderId);
  if (!o.archivedAt) throw new ArchiveError(409, `Order ${orderLabel(o)} is not in the Bin.`);
  const [updated] = await db.update(ordersTable).set({ archivedAt: null, archivedBy: null, archiveReason: null }).where(eq(ordersTable.id, orderId)).returning();
  await log(a, { entityType: "order", entityId: orderId, orderId, action: "order.restored", description: `Order ${orderLabel(o)} restored from the Bin` });
  return updated!;
}

/** Administrator only, and only from the Bin: removes the order with its lines, files, documents and the emails that belong only to it. */
async function purgeOrder(a: Access, orderId: string, blobs: Blobs) {
  const o = await loadOrder(orderId);
  if (!o.archivedAt) throw new ArchiveError(409, "Move the order to the Bin first.");
  const files = await db.select({ path: orderFilesTable.objectPath }).from(orderFilesTable).where(eq(orderFilesTable.orderId, orderId));
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.orderId, orderId));
  const links = await db.select({ emailId: sourceEmailOrdersTable.emailId }).from(sourceEmailOrdersTable).where(eq(sourceEmailOrdersTable.orderId, orderId));
  const onlyHere: string[] = [];
  for (const { emailId } of links) {
    const [other] = await db.select({ id: sourceEmailOrdersTable.id }).from(sourceEmailOrdersTable).where(and(eq(sourceEmailOrdersTable.emailId, emailId), ne(sourceEmailOrdersTable.orderId, orderId))).limit(1);
    if (!other) onlyHere.push(emailId);
  }
  const emailPaths = onlyHere.length ? await emailObjectPaths(onlyHere) : [];
  await db.transaction(async (tx) => {
    // approved documents may only be deleted from the Bin (database rule), so put them there first
    await tx.update(documentsTable).set({ archivedAt: new Date(), archivedBy: who(a), archiveReason: "order purged" }).where(and(eq(documentsTable.orderId, orderId), isNull(documentsTable.archivedAt)));
    await tx.delete(documentsTable).where(eq(documentsTable.orderId, orderId));
    if (onlyHere.length) await tx.delete(sourceEmailsTable).where(inArray(sourceEmailsTable.id, onlyHere));
    await tx.delete(ordersTable).where(eq(ordersTable.id, orderId));
  });
  await log(a, {
    entityType: "order",
    entityId: orderId,
    orderId: null,
    action: "order.purged",
    description: `Order ${orderLabel(o)} (PO ${o.poNumber ?? "-"}, ${o.buyer}) permanently deleted from the Bin${o.invoiceNumber ? `; invoice number ${o.invoiceNumber} is retired and will not be reused` : ""}`,
    details: { reference: o.reference, invoiceRef: o.invoiceRef, poNumber: o.poNumber, buyer: o.buyer, files: files.length, documents: docs.length, emails: onlyHere.length },
  });
  await removeObjects(blobs, [...files.map((f) => f.path), ...docs.flatMap((d) => [d.xlsxObjectPath, d.pdfObjectPath]), ...emailPaths]);
}

// ---------------------------------------------------------------- order files (images, tech packs)

async function loadFile(orderId: string, fileId: string) {
  const [f] = await db.select().from(orderFilesTable).where(and(eq(orderFilesTable.id, fileId), eq(orderFilesTable.orderId, orderId)));
  if (!f || !f.uploadedAt) throw new ArchiveError(404, "File not found");
  return f;
}

export async function archiveFile(a: Access, orderId: string, fileId: string, reason: unknown) {
  const f = await loadFile(orderId, fileId);
  if (f.archivedAt) throw new ArchiveError(409, "The file is already in the Bin.");
  await db.update(orderFilesTable).set({ archivedAt: new Date(), archivedBy: who(a), archiveReason: cleanReason(reason) }).where(eq(orderFilesTable.id, fileId));
  await log(a, { entityType: "order_file", entityId: fileId, orderId, action: "file.archived", description: `File "${f.originalName}" moved to the Bin${cleanReason(reason) ? `: ${cleanReason(reason)}` : ""}` });
}

export async function restoreFile(a: Access, orderId: string, fileId: string) {
  const f = await loadFile(orderId, fileId);
  if (!f.archivedAt) throw new ArchiveError(409, "The file is not in the Bin.");
  await db.update(orderFilesTable).set({ archivedAt: null, archivedBy: null, archiveReason: null }).where(eq(orderFilesTable.id, fileId));
  await log(a, { entityType: "order_file", entityId: fileId, orderId, action: "file.restored", description: `File "${f.originalName}" restored from the Bin` });
}

async function purgeFile(a: Access, orderId: string, fileId: string, blobs: Blobs) {
  const [f] = await db.select().from(orderFilesTable).where(and(eq(orderFilesTable.id, fileId), eq(orderFilesTable.orderId, orderId)));
  if (!f) throw new ArchiveError(404, "File not found");
  if (!f.archivedAt) throw new ArchiveError(409, "Move the file to the Bin first.");
  await db.delete(orderFilesTable).where(eq(orderFilesTable.id, fileId));
  await log(a, { entityType: "order_file", entityId: fileId, orderId: f.orderId, action: "file.purged", description: `File "${f.originalName}" permanently deleted from the Bin` });
  await removeObjects(blobs, [f.objectPath]);
}

// ---------------------------------------------------------------- documents

async function loadDoc(orderId: string, docId: string) {
  const [d] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, docId), eq(documentsTable.orderId, orderId)));
  if (!d) throw new ArchiveError(404, "Document not found");
  return d;
}
const docName = (d: { type: string; docNumber: string; revision: number }) => `${DOC_TITLE[d.type] ?? d.type} ${d.docNumber} rev ${d.revision}`;

export async function archiveDocument(a: Access, orderId: string, docId: string, reason: unknown) {
  const d = await loadDoc(orderId, docId);
  if (d.archivedAt) throw new ArchiveError(409, "The document is already in the Bin.");
  if (FINAL.includes(d.status) && !isAdministrator(a)) throw new ArchiveError(403, "Only an administrator can move an approved document to the Bin.");
  await db.update(documentsTable).set({ archivedAt: new Date(), archivedBy: who(a), archiveReason: cleanReason(reason) }).where(eq(documentsTable.id, docId));
  await log(a, { entityType: "document", entityId: docId, orderId, action: "document.archived", description: `${docName(d)} (${d.status}) moved to the Bin${cleanReason(reason) ? `: ${cleanReason(reason)}` : ""}`, details: { type: d.type, revision: d.revision, status: d.status } });
}

export async function restoreDocument(a: Access, orderId: string, docId: string) {
  const d = await loadDoc(orderId, docId);
  if (!d.archivedAt) throw new ArchiveError(409, "The document is not in the Bin.");
  if (FINAL.includes(d.status) && !isAdministrator(a)) throw new ArchiveError(403, "Only an administrator can restore an approved document.");
  const others = await db.select().from(documentsTable).where(and(eq(documentsTable.orderId, orderId), eq(documentsTable.type, d.type), isNull(documentsTable.archivedAt), ne(documentsTable.id, docId)));
  if (OPEN.includes(d.status)) {
    const open = others.find((o) => OPEN.includes(o.status));
    if (open) throw new ArchiveError(409, `Revision ${open.revision} is already in progress; finish or delete it before restoring this one.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(documentsTable).set({ archivedAt: null, archivedBy: null, archiveReason: null }).where(eq(documentsTable.id, docId));
    if (d.status === "approved") {
      // only one approved revision at a time: the older of the two becomes superseded
      const current = others.find((o) => o.status === "approved");
      if (current) {
        const older = current.revision < d.revision ? current.id : docId;
        await tx.update(documentsTable).set({ status: "superseded" }).where(eq(documentsTable.id, older));
      }
    }
  });
  await log(a, { entityType: "document", entityId: docId, orderId, action: "document.restored", description: `${docName(d)} restored from the Bin`, details: { type: d.type, revision: d.revision } });
}

async function purgeDocument(a: Access, orderId: string, docId: string, blobs: Blobs) {
  const [d] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, docId), eq(documentsTable.orderId, orderId)));
  if (!d) throw new ArchiveError(404, "Document not found");
  if (!d.archivedAt) throw new ArchiveError(409, "Move the document to the Bin first.");
  await db.delete(documentsTable).where(eq(documentsTable.id, docId));
  await log(a, { entityType: "document", entityId: docId, orderId: d.orderId, action: "document.purged", description: `${docName(d)} (${d.status}) permanently deleted from the Bin`, details: { type: d.type, revision: d.revision, xlsxSha256: d.xlsxSha256, pdfSha256: d.pdfSha256 } });
  await removeObjects(blobs, [d.xlsxObjectPath, d.pdfObjectPath]);
}

// ---------------------------------------------------------------- emails

async function loadLink(orderId: string, emailId: string) {
  const [l] = await db
    .select({ id: sourceEmailOrdersTable.id, matchStatus: sourceEmailOrdersTable.matchStatus, archivedAt: sourceEmailOrdersTable.archivedAt, subject: sourceEmailsTable.subject })
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .where(and(eq(sourceEmailOrdersTable.orderId, orderId), eq(sourceEmailOrdersTable.emailId, emailId)));
  if (!l) throw new ArchiveError(404, "Email not linked to this order");
  return l;
}

/**
 * Removes an email from an order (to the Bin), confirms a "needs review" link,
 * or puts a removed email back, then rebuilds the order's email data so it
 * reflects exactly the emails now linked.
 */
export async function setEmailLink(a: Access, orderId: string, emailId: string, to: "matched" | "ignored", reason: unknown, blobs: Blobs): Promise<RebuildReport | null> {
  const l = await loadLink(orderId, emailId);
  if (l.matchStatus === to) return null;
  const now = new Date();
  await db
    .update(sourceEmailOrdersTable)
    .set(to === "ignored" ? { matchStatus: "ignored", reviewedBy: who(a), reviewedAt: now, archivedAt: now, archivedBy: who(a), archiveReason: cleanReason(reason) } : { matchStatus: "matched", reviewedBy: who(a), reviewedAt: now, archivedAt: null, archivedBy: null, archiveReason: null })
    .where(eq(sourceEmailOrdersTable.id, l.id));
  const verb = to === "ignored" ? `removed from the order (moved to the Bin)${cleanReason(reason) ? `: ${cleanReason(reason)}` : ""}` : l.matchStatus === "ignored" ? "restored to the order" : "confirmed for this order";
  await log(a, { entityType: "source_email", entityId: emailId, orderId, sourceEmailId: emailId, action: to === "ignored" ? "email.removed" : l.matchStatus === "ignored" ? "email.restored" : "email.confirmed", description: `Email "${l.subject}" ${verb}`, details: { changes: [{ field: "matchStatus", from: l.matchStatus, to }] } });
  return rebuildOrderFromEmails(orderId, blobs, { id: a.userId, label: who(a) });
}

async function emailObjectPaths(emailIds: string[]) {
  const emails = await db.select({ raw: sourceEmailsTable.rawObjectPath }).from(sourceEmailsTable).where(inArray(sourceEmailsTable.id, emailIds));
  const atts = await db.select({ path: sourceEmailAttachmentsTable.objectPath }).from(sourceEmailAttachmentsTable).where(inArray(sourceEmailAttachmentsTable.emailId, emailIds));
  return [...emails.map((e) => e.raw), ...atts.map((x) => x.path)];
}

/** Administrator only: drops a removed email's link; the email itself (and its stored files) goes once no other order uses it. */
async function purgeEmail(a: Access, orderId: string, emailId: string, blobs: Blobs) {
  const l = await loadLink(orderId, emailId);
  if (l.matchStatus !== "ignored") throw new ArchiveError(409, "Remove the email from the order first.");
  const [other] = await db.select({ id: sourceEmailOrdersTable.id }).from(sourceEmailOrdersTable).where(and(eq(sourceEmailOrdersTable.emailId, emailId), ne(sourceEmailOrdersTable.orderId, orderId))).limit(1);
  const paths = other ? [] : await emailObjectPaths([emailId]);
  await db.transaction(async (tx) => {
    await tx.delete(sourceEmailOrdersTable).where(eq(sourceEmailOrdersTable.id, l.id));
    if (!other) await tx.delete(sourceEmailsTable).where(eq(sourceEmailsTable.id, emailId));
  });
  await log(a, { entityType: "source_email", entityId: emailId, orderId, action: "email.purged", description: `Email "${l.subject}" permanently deleted from the Bin${other ? " (kept for the other order it belongs to)" : ""}` });
  await removeObjects(blobs, paths);
}

/**
 * Adds an email a staff member saved from their mail program (.eml) to an
 * order, as if the mailbox reader had matched it, then rebuilds the order so
 * its PO / trims sheets apply in date order.
 */
export async function uploadEmail(a: Access, orderId: string, input: { filename?: string; contentBase64: string }, blobs: Blobs) {
  const o = await loadOrder(orderId);
  if (o.archivedAt) throw new ArchiveError(409, `Order ${orderLabel(o)} is in the Bin. Restore it before adding emails.`);
  const raw = Buffer.from(input.contentBase64 ?? "", "base64");
  if (!raw.length) throw new ArchiveError(400, "The file is empty.");
  if (raw.length > MAX_EMAIL_BYTES) throw new ArchiveError(400, "The email is larger than 25 MB.");
  if (input.filename && /\.msg$/i.test(input.filename)) throw new ArchiveError(400, "Outlook .msg files can't be read yet. Forward the email to orders@bktextile.com instead, or save it as an .eml file and upload that.");
  let email: Awaited<ReturnType<typeof parseEml>>;
  try {
    email = await parseEml(raw);
  } catch {
    throw new ArchiveError(400, "This is not a readable email file (.eml).");
  }
  if (!email.fromAddress && !email.subject && !email.attachments.length) throw new ArchiveError(400, "This is not a readable email file (.eml).");
  const messageId = email.messageId.startsWith("<no-id-") ? `<upload-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}@bk-upload>` : email.messageId;
  const warnings: string[] = [];
  if (o.poNumber && !mentionsPo(`${email.subject}\n${email.bodyText}`, poKey(o.poNumber)) && !email.attachments.some((x) => x.filename.toUpperCase().includes(poKey(o.poNumber!)))) {
    warnings.push(`The email does not mention PO ${o.poNumber}; check it belongs to this order.`);
  }

  const [existing] = await db.select({ id: sourceEmailsTable.id }).from(sourceEmailsTable).where(eq(sourceEmailsTable.messageId, messageId));
  let emailId: string;
  if (existing) {
    const [link] = await db.select().from(sourceEmailOrdersTable).where(and(eq(sourceEmailOrdersTable.emailId, existing.id), eq(sourceEmailOrdersTable.orderId, orderId)));
    if (link && link.matchStatus === "matched") throw new ArchiveError(409, "This email is already on the order.");
    if (link) {
      await db.update(sourceEmailOrdersTable).set({ matchStatus: "matched", reviewedBy: who(a), reviewedAt: new Date(), archivedAt: null, archivedBy: null, archiveReason: null }).where(eq(sourceEmailOrdersTable.id, link.id));
    } else {
      await db.insert(sourceEmailOrdersTable).values({ emailId: existing.id, orderId, matchStatus: "matched", matchMethod: "uploaded", matchReason: `uploaded by ${who(a)}`, reviewedBy: who(a), reviewedAt: new Date() });
    }
    emailId = existing.id;
  } else {
    const plans = email.attachments.map(planAttachment);
    const rawPath = await blobs.put(raw, "message/rfc822");
    const paths = await Promise.all(plans.map((p) => blobs.put(p.content, p.contentType)));
    const date = email.effectiveDate ?? email.sentAt ?? new Date();
    emailId = await db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(sourceEmailsTable)
        .values({
          mailbox: "uploaded",
          imapFolder: "uploaded",
          messageId,
          inReplyTo: email.inReplyTo,
          referencesHeader: email.references.join(" ") || null,
          threadKey: email.subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").toLowerCase().slice(0, 200),
          fromAddress: email.fromAddress || "unknown",
          fromName: email.fromName,
          toAddresses: email.to,
          ccAddresses: email.cc,
          forwardedVia: null,
          subject: email.subject,
          sentAt: date,
          receivedAt: new Date(),
          bodyText: email.bodyText,
          rawObjectPath: rawPath,
          category: plans.some((p) => p.po) ? "order_details" : plans.some((p) => p.trims) ? "trims_accessories" : /sample/i.test(email.subject) ? "sample_requirements" : "unclassified",
          parseStatus: plans.some((p) => p.extractStatus === "failed") ? "partial" : "parsed",
          processedAt: new Date(),
        })
        .returning({ id: sourceEmailsTable.id });
      if (plans.length) {
        await tx.insert(sourceEmailAttachmentsTable).values(
          plans.map((p, i) => ({ emailId: stored!.id, filename: p.filename, contentType: p.contentType, sizeBytes: p.content.length, sha256: p.sha256, contentId: p.contentId, isInline: p.isInline, objectPath: paths[i]!, extractStatus: p.extractStatus, extractedText: p.extractedText, extractError: p.extractError })),
        );
      }
      await tx.insert(sourceEmailOrdersTable).values({ emailId: stored!.id, orderId, matchStatus: "matched", matchMethod: "uploaded", matchReason: `uploaded by ${who(a)}${input.filename ? ` (${input.filename.slice(0, 120)})` : ""}`, reviewedBy: who(a), reviewedAt: new Date() });
      return stored!.id;
    });
  }
  await log(a, { entityType: "source_email", entityId: emailId, orderId, sourceEmailId: emailId, action: "email.uploaded", description: `Email "${email.subject}" added to the order by upload`, details: { filename: input.filename ?? null, warnings } });
  const rebuild = await rebuildOrderFromEmails(orderId, blobs, { id: a.userId, label: who(a) });
  return { emailId, warnings, rebuild };
}

// ---------------------------------------------------------------- the Bin

export type BinItem = {
  kind: Kind;
  id: string;
  orderId: string;
  orderRef: string;
  poNumber: string | null;
  title: string;
  detail: string | null;
  archivedAt: Date;
  archivedBy: string | null;
  reason: string | null;
  canRestore: boolean;
  canPurge: boolean;
};

/** Everything in the Bin, newest first. Items inside an order that is itself in the Bin are listed under the order only. */
export async function listBin(a: Access): Promise<BinItem[]> {
  const admin = isAdministrator(a);
  const items: BinItem[] = [];
  const orders = await db.select().from(ordersTable).where(isNotNull(ordersTable.archivedAt));
  for (const o of orders) {
    items.push({ kind: "order", id: o.id, orderId: o.id, orderRef: orderLabel(o), poNumber: o.poNumber, title: `Order ${orderLabel(o)}`, detail: [o.buyer, o.style].filter(Boolean).join(" · ") || null, archivedAt: o.archivedAt!, archivedBy: o.archivedBy, reason: o.archiveReason, canRestore: true, canPurge: admin });
  }
  const live = isNull(ordersTable.archivedAt);
  const files = await db
    .select({ f: orderFilesTable, invoiceRef: ordersTable.invoiceRef, reference: ordersTable.reference, poNumber: ordersTable.poNumber })
    .from(orderFilesTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderFilesTable.orderId))
    .where(and(isNotNull(orderFilesTable.archivedAt), live));
  for (const { f, ...o } of files) {
    items.push({ kind: "file", id: f.id, orderId: f.orderId, orderRef: orderLabel(o), poNumber: o.poNumber, title: f.originalName, detail: f.fileType === "garment_image" ? "Image" : "File", archivedAt: f.archivedAt!, archivedBy: f.archivedBy, reason: f.archiveReason, canRestore: true, canPurge: admin });
  }
  const docs = await db
    .select({ d: documentsTable, invoiceRef: ordersTable.invoiceRef, reference: ordersTable.reference, poNumber: ordersTable.poNumber })
    .from(documentsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, documentsTable.orderId))
    .where(and(isNotNull(documentsTable.archivedAt), live));
  for (const { d, ...o } of docs) {
    const final = FINAL.includes(d.status);
    items.push({ kind: "document", id: d.id, orderId: d.orderId, orderRef: orderLabel(o), poNumber: o.poNumber, title: docName(d), detail: d.status.replace(/_/g, " "), archivedAt: d.archivedAt!, archivedBy: d.archivedBy, reason: d.archiveReason, canRestore: !final || admin, canPurge: admin });
  }
  const emails = await db
    .select({ l: sourceEmailOrdersTable, subject: sourceEmailsTable.subject, fromAddress: sourceEmailsTable.fromAddress, invoiceRef: ordersTable.invoiceRef, reference: ordersTable.reference, poNumber: ordersTable.poNumber })
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .innerJoin(ordersTable, eq(ordersTable.id, sourceEmailOrdersTable.orderId))
    .where(and(eq(sourceEmailOrdersTable.matchStatus, "ignored"), live));
  for (const { l, subject, fromAddress, ...o } of emails) {
    items.push({ kind: "email", id: l.emailId, orderId: l.orderId, orderRef: orderLabel(o), poNumber: o.poNumber, title: subject || "(no subject)", detail: fromAddress, archivedAt: l.archivedAt ?? l.reviewedAt ?? l.matchedAt, archivedBy: l.archivedBy ?? l.reviewedBy, reason: l.archiveReason, canRestore: true, canPurge: admin });
  }
  return items.sort((x, y) => y.archivedAt.getTime() - x.archivedAt.getTime());
}

export async function restoreFromBin(a: Access, kind: string, orderId: string, id: string, blobs: Blobs) {
  switch (kind) {
    case "order":
      return void (await restoreOrder(a, id));
    case "file":
      return void (await restoreFile(a, orderId, id));
    case "document":
      return void (await restoreDocument(a, orderId, id));
    case "email":
      return void (await setEmailLink(a, orderId, id, "matched", null, blobs));
    default:
      throw new ArchiveError(400, `Unknown item type "${kind}".`);
  }
}

/** Empty one item from the Bin for good. Administrator only. */
export async function purgeFromBin(a: Access, kind: string, orderId: string, id: string, blobs: Blobs) {
  if (!isAdministrator(a)) throw new ArchiveError(403, "Only an administrator can permanently delete from the Bin.");
  switch (kind) {
    case "order":
      return purgeOrder(a, id, blobs);
    case "file":
      return purgeFile(a, orderId, id, blobs);
    case "document":
      return purgeDocument(a, orderId, id, blobs);
    case "email":
      return purgeEmail(a, orderId, id, blobs);
    default:
      throw new ArchiveError(400, `Unknown item type "${kind}".`);
  }
}
