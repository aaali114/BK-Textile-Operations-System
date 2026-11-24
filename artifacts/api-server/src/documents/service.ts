import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { activityTable, db, documentsTable, ordersTable, settingsTable, usersTable } from "@workspace/db";
import type { Access } from "../lib/access";
import type { BlobReader, BlobStore } from "../intake/run";
import { computeDocument, DEFAULT_COMPANY, defaultSettings, DOCUMENT_TYPES, TEMPLATE_VERSION, TYPE_TITLE, type CompanyProfile, type DocumentData, type DocumentSettings, type DocumentType } from "./compute";
import { renderPdf, renderXlsx, type Stamp } from "./render";

export class DocumentError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}
type Doc = typeof documentsTable.$inferSelect;
type Order = typeof ordersTable.$inferSelect;
const OPEN = ["draft", "in_review", "changes_requested"];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const label = (a: Access) => a.name || a.email || a.userId;

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, list));
  return new Map(rows.map((r) => [r.id, r.name || r.email || r.id]));
}

async function loadOrder(orderId: string): Promise<Order> {
  const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!o) throw new DocumentError(404, "Order not found");
  return o;
}
/** Changes are refused while the order is in the Bin. */
async function loadActiveOrder(orderId: string): Promise<Order> {
  const o = await loadOrder(orderId);
  if (o.archivedAt) throw new DocumentError(409, "This order is in the Bin. Restore it before working on its documents.");
  return o;
}
async function loadDoc(orderId: string, docId: string): Promise<Doc> {
  const [d] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, docId), eq(documentsTable.orderId, orderId)));
  if (!d) throw new DocumentError(404, "Document not found");
  return d;
}

async function loadLiveDoc(orderId: string, docId: string): Promise<Doc> {
  const d = await loadDoc(orderId, docId);
  if (d.archivedAt) throw new DocumentError(409, "This document is in the Bin. Restore it first.");
  return d;
}

/** Four-eyes: an approver with the permission, who is an administrator/deputy or the order's responsible merchandiser, and who did not prepare, edit or submit it. */
export function approvalBlocker(a: Access, doc: Doc, order: Order): string | null {
  if (doc.status !== "in_review") return "Only documents in review can be approved or sent back.";
  if (!a.permissions.has("approve_documents")) return "You do not have the approve documents permission.";
  if (!a.canManageUsers && order.responsibleUserId !== a.userId) return "Only administrators, deputies or the order's responsible merchandiser can approve.";
  if (doc.contributors.includes(a.userId)) return "You prepared or edited this document, so someone else must approve it.";
  return null;
}

async function logDoc(a: Access, doc: Doc, action: string, description: string, details: Record<string, unknown> = {}) {
  await db.insert(activityTable).values({ actor: label(a), actorId: a.userId, source: "staff", action, description, entityType: "document", entityId: doc.id, orderId: doc.orderId, details: { type: doc.type, revision: doc.revision, ...details } });
}

async function view(doc: Doc, order: Order, a: Access, withData: boolean) {
  const n = await names([doc.preparedBy, doc.submittedBy, doc.reviewedBy, ...doc.contributors]);
  const live = OPEN.includes(doc.status) || withData || doc.status === "approved" ? await computeDocument(order.id, doc.type as DocumentType, doc.settings as DocumentSettings) : null;
  const data = doc.status === "approved" || doc.status === "superseded" ? (doc.snapshot as DocumentData) : live!.data;
  return {
    id: doc.id,
    orderId: doc.orderId,
    type: doc.type,
    title: TYPE_TITLE[doc.type as DocumentType],
    revision: doc.revision,
    status: doc.status,
    docNumber: doc.docNumber,
    settings: doc.settings as DocumentSettings,
    templateVersion: doc.templateVersion,
    preparedBy: n.get(doc.preparedBy) ?? doc.preparedBy,
    contributors: doc.contributors.map((c) => n.get(c) ?? c),
    submittedBy: doc.submittedBy ? (n.get(doc.submittedBy) ?? doc.submittedBy) : null,
    submittedAt: doc.submittedAt,
    reviewedBy: doc.reviewedBy ? (n.get(doc.reviewedBy) ?? doc.reviewedBy) : null,
    reviewedAt: doc.reviewedAt,
    reviewNote: doc.reviewNote,
    problems: OPEN.includes(doc.status) ? live!.data.problems : [],
    // approved, but the order's data has changed since: offer a new revision
    outOfDate: doc.status === "approved" && !!live && live.sourceHash !== doc.sourceHash,
    canEdit: OPEN.includes(doc.status) && doc.status !== "in_review" && a.permissions.has("prepare_documents"),
    canSubmit: (doc.status === "draft" || doc.status === "changes_requested") && a.permissions.has("prepare_documents") && !live?.data.problems.length,
    approvalBlocker: doc.status === "in_review" ? approvalBlocker(a, doc, order) : null,
    files: doc.status === "approved" || doc.status === "superseded" ? { xlsxSha256: doc.xlsxSha256, pdfSha256: doc.pdfSha256 } : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    archivedAt: doc.archivedAt,
    data: withData ? data : null,
  };
}
export type DocumentView = Awaited<ReturnType<typeof view>>;

export async function listDocuments(a: Access, orderId: string) {
  const order = await loadOrder(orderId);
  // deleted documents are in the Bin (GET /bin)
  const docs = await db.select().from(documentsTable).where(and(eq(documentsTable.orderId, orderId), isNull(documentsTable.archivedAt))).orderBy(documentsTable.type, desc(documentsTable.revision));
  return Promise.all(docs.map((d) => view(d, order, a, false)));
}

export async function getDocument(a: Access, orderId: string, docId: string) {
  return view(await loadDoc(orderId, docId), await loadOrder(orderId), a, true);
}

export async function createDocument(a: Access, orderId: string, type: string) {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) throw new DocumentError(400, `Unknown document type "${type}".`);
  const order = await loadActiveOrder(orderId);
  const existing = await db.select().from(documentsTable).where(and(eq(documentsTable.orderId, orderId), eq(documentsTable.type, type))).orderBy(desc(documentsTable.revision));
  // revision numbers continue past documents in the Bin; those are otherwise ignored here
  const open = existing.find((d) => OPEN.includes(d.status) && !d.archivedAt);
  if (open) throw new DocumentError(409, `A ${TYPE_TITLE[type as DocumentType].toLowerCase()} is already in progress (revision ${open.revision}).`);
  const approved = existing.find((d) => d.status === "approved" && !d.archivedAt);
  // a new revision starts from the approved one's settings, so corrections are small
  const settings = approved ? (approved.settings as DocumentSettings) : await defaultSettings(orderId);
  const [doc] = await db
    .insert(documentsTable)
    .values({ orderId, type, revision: (existing[0]?.revision ?? 0) + 1, status: "draft", docNumber: order.invoiceRef ?? order.reference, settings, templateVersion: TEMPLATE_VERSION[type as DocumentType], preparedBy: a.userId, contributors: [a.userId], supersedesId: approved?.id ?? null })
    .returning();
  await logDoc(a, doc!, "document.created", `${TYPE_TITLE[type as DocumentType]} ${doc!.docNumber} revision ${doc!.revision} drafted`);
  return view(doc!, order, a, true);
}

function cleanSettings(current: DocumentSettings, patch: Partial<DocumentSettings>): DocumentSettings {
  const next = { ...current, sections: { ...current.sections } };
  if (patch.allowancePct !== undefined) {
    if (typeof patch.allowancePct !== "number" || patch.allowancePct < 0 || patch.allowancePct > 50) throw new DocumentError(400, "Allowance must be between 0 and 50 %.");
    next.allowancePct = Math.round(patch.allowancePct * 100) / 100;
  }
  if (patch.pcsPerCarton !== undefined) {
    if (patch.pcsPerCarton !== null && (!Number.isInteger(patch.pcsPerCarton) || patch.pcsPerCarton < 1 || patch.pcsPerCarton > 10000)) throw new DocumentError(400, "Pieces per carton must be a whole number from 1 to 10000.");
    next.pcsPerCarton = patch.pcsPerCarton;
  }
  for (const k of ["previousReference", "remarks"] as const) {
    if (patch[k] !== undefined) {
      const v = patch[k];
      if (v !== null && (typeof v !== "string" || v.length > (k === "remarks" ? 500 : 120))) throw new DocumentError(400, `${k} is too long.`);
      next[k] = v?.trim() || null;
    }
  }
  if (patch.sections) {
    for (const [lineId, s] of Object.entries(patch.sections)) {
      if ((s.description && s.description.length > 600) || (s.quality && s.quality.length > 200)) throw new DocumentError(400, "Section text is too long.");
      next.sections[lineId] = { description: s.description?.trim() || null, quality: s.quality?.trim() || null };
    }
  }
  return next;
}

export async function updateDocument(a: Access, orderId: string, docId: string, patch: Partial<DocumentSettings>) {
  await loadActiveOrder(orderId);
  const doc = await loadLiveDoc(orderId, docId);
  if (doc.status !== "draft" && doc.status !== "changes_requested") throw new DocumentError(409, doc.status === "in_review" ? "The document is in review; ask the reviewer to send it back to make changes." : "Approved documents cannot be changed; create a new revision.");
  const settings = cleanSettings(doc.settings as DocumentSettings, patch);
  const [updated] = await db
    .update(documentsTable)
    .set({ settings, contributors: doc.contributors.includes(a.userId) ? doc.contributors : [...doc.contributors, a.userId] })
    .where(eq(documentsTable.id, docId))
    .returning();
  await logDoc(a, updated!, "document.edited", `${TYPE_TITLE[doc.type as DocumentType]} ${doc.docNumber} rev ${doc.revision} edited`, { changes: Object.keys(patch) });
  return view(updated!, await loadOrder(orderId), a, true);
}

export async function submitDocument(a: Access, orderId: string, docId: string) {
  await loadActiveOrder(orderId);
  const doc = await loadLiveDoc(orderId, docId);
  if (doc.status !== "draft" && doc.status !== "changes_requested") throw new DocumentError(409, "Only drafts can be sent for review.");
  const { data } = await computeDocument(orderId, doc.type as DocumentType, doc.settings as DocumentSettings);
  if (data.problems.length) throw new DocumentError(409, `Fix before sending for review: ${data.problems.join(" ")}`);
  const [updated] = await db
    .update(documentsTable)
    .set({ status: "in_review", submittedBy: a.userId, submittedAt: new Date(), contributors: doc.contributors.includes(a.userId) ? doc.contributors : [...doc.contributors, a.userId] })
    .where(eq(documentsTable.id, docId))
    .returning();
  await logDoc(a, updated!, "document.submitted", `${TYPE_TITLE[doc.type as DocumentType]} ${doc.docNumber} rev ${doc.revision} sent for approval`);
  return view(updated!, await loadOrder(orderId), a, true);
}

export async function requestChanges(a: Access, orderId: string, docId: string, note: string) {
  const [doc, order] = [await loadLiveDoc(orderId, docId), await loadActiveOrder(orderId)];
  const blocker = approvalBlocker(a, doc, order);
  if (blocker) throw new DocumentError(403, blocker);
  if (!note.trim()) throw new DocumentError(400, "Say what needs to change.");
  const [updated] = await db.update(documentsTable).set({ status: "changes_requested", reviewedBy: a.userId, reviewedAt: new Date(), reviewNote: note.trim().slice(0, 1000) }).where(eq(documentsTable.id, docId)).returning();
  await logDoc(a, updated!, "document.changes_requested", `${TYPE_TITLE[doc.type as DocumentType]} ${doc.docNumber} rev ${doc.revision} sent back: ${note.trim().slice(0, 200)}`);
  return view(updated!, order, a, true);
}

/** Approve: render the final files from the current data, store them with their fingerprints, freeze the document, supersede the previous revision. */
export async function approveDocument(a: Access, orderId: string, docId: string, note: string | null, blobs: BlobStore) {
  const [doc, order] = [await loadLiveDoc(orderId, docId), await loadActiveOrder(orderId)];
  const blocker = approvalBlocker(a, doc, order);
  if (blocker) throw new DocumentError(403, blocker);
  const { data, sourceHash } = await computeDocument(orderId, doc.type as DocumentType, doc.settings as DocumentSettings);
  if (data.problems.length) throw new DocumentError(409, `Cannot approve: ${data.problems.join(" ")}`);
  const approvedAt = new Date();
  const n = await names([doc.preparedBy]);
  const stamp: Stamp = { kind: "approved", revision: doc.revision, preparedBy: n.get(doc.preparedBy) ?? doc.preparedBy, approvedBy: label(a), approvedAt, documentId: doc.id };
  const [xlsx, pdf] = [await renderXlsx(data, stamp), await renderPdf(data, stamp)];
  const xlsxPath = await blobs.put(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const pdfPath = await blobs.put(pdf, "application/pdf");
  const updated = await db.transaction(async (tx) => {
    const [d] = await tx
      .update(documentsTable)
      .set({ status: "approved", snapshot: data, sourceHash, reviewedBy: a.userId, reviewedAt: approvedAt, reviewNote: note?.trim() || null, xlsxObjectPath: xlsxPath, pdfObjectPath: pdfPath, xlsxSha256: sha(xlsx), pdfSha256: sha(pdf) })
      .where(and(eq(documentsTable.id, docId), eq(documentsTable.status, "in_review")))
      .returning();
    if (!d) throw new DocumentError(409, "The document changed while approving; reload and try again.");
    await tx.update(documentsTable).set({ status: "superseded" }).where(and(eq(documentsTable.orderId, orderId), eq(documentsTable.type, doc.type), eq(documentsTable.status, "approved"), isNull(documentsTable.archivedAt), ne(documentsTable.id, docId)));
    return d;
  });
  await logDoc(a, updated, "document.approved", `${TYPE_TITLE[doc.type as DocumentType]} ${doc.docNumber} rev ${doc.revision} approved`, { xlsxSha256: updated.xlsxSha256, pdfSha256: updated.pdfSha256 });
  return view(updated, order, a, true);
}

/** Approved: the stored file. Otherwise: rendered now with the DRAFT stamp (never stored). */
export async function documentFile(a: Access, orderId: string, docId: string, format: "xlsx" | "pdf", blobs: BlobReader) {
  const doc = await loadDoc(orderId, docId);
  const base = `${TYPE_TITLE[doc.type as DocumentType]} ${doc.docNumber} rev${doc.revision}`.replace(/[\\/:*?"<>|]+/g, "-");
  if (doc.status === "approved" || doc.status === "superseded") {
    const path = format === "xlsx" ? doc.xlsxObjectPath : doc.pdfObjectPath;
    const content = await blobs.get(path!);
    const expected = format === "xlsx" ? doc.xlsxSha256 : doc.pdfSha256;
    if (sha(content) !== expected) throw new DocumentError(409, "The stored file does not match its fingerprint; contact the administrator.");
    return { content, filename: `${base}${doc.status === "superseded" ? " (superseded)" : ""}.${format}` };
  }
  const { data } = await computeDocument(orderId, doc.type as DocumentType, doc.settings as DocumentSettings);
  const content = format === "xlsx" ? await renderXlsx(data, { kind: "draft" }) : await renderPdf(data, { kind: "draft" });
  return { content, filename: `${base} DRAFT.${format}` };
}

/** Documents in review that this user may approve, oldest first. */
export async function awaitingApproval(a: Access) {
  const docs = await db.select().from(documentsTable).where(and(eq(documentsTable.status, "in_review"), isNull(documentsTable.archivedAt))).orderBy(documentsTable.submittedAt);
  const out = [];
  for (const d of docs) {
    const order = await loadOrder(d.orderId);
    if (order.archivedAt) continue;
    if (!approvalBlocker(a, d, order)) out.push(await view(d, order, a, false));
  }
  return out;
}

export async function setResponsible(a: Access, orderId: string, userId: string | null) {
  const order = await loadOrder(orderId);
  if (userId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!u || u.status !== "active") throw new DocumentError(400, "Choose an approved user.");
  }
  await db.update(ordersTable).set({ responsibleUserId: userId }).where(eq(ordersTable.id, orderId));
  await db.insert(activityTable).values({ actor: label(a), actorId: a.userId, source: "staff", action: "order.responsible_set", description: `Responsible merchandiser for ${order.invoiceRef ?? order.reference} set`, entityType: "order", entityId: orderId, orderId, details: { changes: [{ field: "responsibleUserId", from: order.responsibleUserId, to: userId }] } });
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "company_profile"));
  return { ...DEFAULT_COMPANY, ...((row?.value as Partial<CompanyProfile>) ?? {}) };
}

export async function saveCompanyProfile(a: Access, p: CompanyProfile) {
  const value = { name: p.name.trim().slice(0, 120), taglineLines: p.taglineLines.map((l) => l.trim().slice(0, 160)).filter(Boolean).slice(0, 4), address: p.address.trim().slice(0, 300) };
  await db.insert(settingsTable).values({ key: "company_profile", value, updatedBy: a.userId }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedBy: a.userId, updatedAt: new Date() } });
  await db.insert(activityTable).values({ actor: label(a), actorId: a.userId, source: "staff", action: "settings.company_profile", description: "Company letterhead updated", entityType: "settings", entityId: "company_profile", details: value });
  return value;
}
