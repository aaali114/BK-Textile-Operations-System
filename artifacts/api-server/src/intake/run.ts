import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activityTable,
  buyersTable,
  db,
  intakeCursorTable,
  invoiceCounterTable,
  invoiceYear,
  ordersTable,
  pool,
  sourceEmailAttachmentsTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
} from "@workspace/db";
import { createOrderWithInvoice, OrderInputError } from "../lib/orderCreation";
import { applySheet, linkedOrderIdsForMessages, logApplied, sheetsForOrder, type ApplyContext } from "./apply";
import { findPoKeys, invoiceNumbersIn, matchEmail, type KnownOrder, type OrderLink } from "./match";
import { parseEml, type ParsedEmail } from "./mime";
import { extractPoSheets, type PoSheetData } from "./poSheet";
import { isSpreadsheet, readWorkbook, sheetsToText } from "./spreadsheet";
import { poKey, sameCompany } from "./text";
import { extractTrimsSheet, type TrimRow } from "./trimsSheet";

export type Envelope = {
  uid: number;
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  internalDate: Date | null;
};
export interface MailSource {
  readonly mailbox: string;
  readonly folder: string;
  open(): Promise<{ uidValidity: number }>;
  listAfter(afterUid: number): Promise<Envelope[]>;
  fetchRaw(uid: number): Promise<Buffer>;
  close(): Promise<void>;
}
export interface BlobStore {
  put(content: Buffer, contentType: string): Promise<string>;
}
export interface BlobReader {
  get(objectPath: string): Promise<Buffer>;
}
/** Removes stored files when something is purged from the Bin. Missing files are not an error. */
export interface BlobRemover {
  remove(objectPath: string): Promise<void>;
}

type AttachmentPlan = {
  filename: string;
  contentType: string;
  content: Buffer;
  contentId: string | null;
  isInline: boolean;
  sha256: string;
  kind: "po_sheet" | "trims_sheet" | "spreadsheet" | "other";
  extractStatus: "extracted" | "failed" | "not_applicable";
  extractedText: string | null;
  extractError: string | null;
  /** Every PO in the attachment (one per workbook tab); empty when it holds none. */
  pos: PoSheetData[];
  trims: TrimRow[] | null;
};

export type IntakeEmailReport = {
  uid: number;
  subject: string;
  date: string | null;
  outcome: "stored" | "would_store" | "duplicate" | "not_matched" | "error";
  orders: { invoiceRef: string | null; poNumber: string | null; matchStatus: string; matchMethod: string; created: boolean }[];
  attachments: { filename: string; kind: string; changes: number; warnings: string[]; skipped: string | null }[];
  error: string | null;
};
export type IntakeRunSummary = {
  dryRun: boolean;
  mailbox: string;
  folder: string;
  /** "all", or the allow-listed PO keys */
  poScope: string;
  startDate: string | null;
  /** Messages that reached the mailbox before the start date (not downloaded). */
  beforeStartDate: number;
  fromUid: number;
  scanned: number;
  candidates: number;
  stored: number;
  duplicates: number;
  skipped: number;
  ordersCreated: string[];
  emails: IntakeEmailReport[];
  errors: string[];
};

const LOCK_KEY = 83439043;

/** Runs one pass over the mailbox. Only one pass runs at a time (advisory lock). */
export async function runIntake(opts: {
  source: MailSource;
  blobs: BlobStore;
  dryRun: boolean;
  poAllowlist: Set<string>;
  /** Every PO is handled (go-live); poAllowlist is then ignored. */
  allPos?: boolean;
  /** Mail that reached the mailbox before this moment is skipped without being downloaded. */
  startDate?: Date | null;
  rescanFromUid?: number;
}): Promise<IntakeRunSummary> {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0]?.ok) throw new Error("Another intake run is in progress; try again in a minute.");
    try {
      return await runLocked(opts);
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}

async function runLocked({ source, blobs, dryRun, poAllowlist, allPos = false, startDate = null, rescanFromUid }: Parameters<typeof runIntake>[0]): Promise<IntakeRunSummary> {
  const allowPo = (key: string) => allPos || poAllowlist.has(key);
  const summary: IntakeRunSummary = {
    dryRun, mailbox: source.mailbox, folder: source.folder, fromUid: 0,
    poScope: allPos ? "all" : [...poAllowlist].join(", "), startDate: startDate?.toISOString() ?? null, beforeStartDate: 0,
    scanned: 0, candidates: 0, stored: 0, duplicates: 0, skipped: 0, ordersCreated: [], emails: [], errors: [],
  };
  const skippedUids: number[] = [];
  const { uidValidity } = await source.open();
  try {
    const [cursor] = await db
      .select()
      .from(intakeCursorTable)
      .where(and(eq(intakeCursorTable.mailbox, source.mailbox), eq(intakeCursorTable.imapFolder, source.folder)));
    const fromUid = rescanFromUid !== undefined ? Math.max(0, rescanFromUid - 1) : cursor && cursor.imapUidvalidity === uidValidity ? cursor.lastUid : 0;
    summary.fromUid = fromUid + 1;
    const envelopes = (await source.listAfter(fromUid)).sort((a, b) => a.uid - b.uid);
    summary.scanned = envelopes.length;

    // ---- screen on envelopes only: nothing else is downloaded
    const known = await knownOrders();
    const knownPos = new Set(known.map((o) => o.poNumber).filter((p): p is string => !!p).map(poKey));
    const knownInvoices = new Set(known.map((o) => o.invoiceNumber).filter((n): n is number => n !== null));
    let candidates: Envelope[] = [];
    const watchKeys = [...new Set([...knownPos, ...poAllowlist])];
    const beforeStart = new Set<number>();
    for (const env of envelopes) {
      if (startDate && env.internalDate && env.internalDate.getTime() < startDate.getTime()) {
        beforeStart.add(env.uid);
        continue;
      }
      const pos = findPoKeys(env.subject, watchKeys);
      const inThread = (await linkedOrderIdsForMessages([env.inReplyTo, ...env.references].filter((x): x is string => !!x))).length > 0;
      const relevant =
        pos.some((p) => allowPo(p)) ||
        invoiceNumbersIn(env.subject).some((n) => knownInvoices.has(n)) ||
        (inThread && (pos.length === 0 || pos.some((p) => knownPos.has(p) || allowPo(p))));
      if (relevant) candidates.push(env);
    }
    // Replies to a candidate in this same batch are candidates too (their parent is not stored yet).
    for (let grew = true; grew; ) {
      grew = false;
      const ids = new Set(candidates.map((c) => c.messageId).filter(Boolean));
      for (const env of envelopes) {
        if (candidates.includes(env) || beforeStart.has(env.uid) || findPoKeys(env.subject, watchKeys).some((p) => !allowPo(p) && !knownPos.has(p))) continue;
        if ([env.inReplyTo, ...env.references].some((id) => id && ids.has(id))) {
          candidates.push(env);
          grew = true;
        }
      }
    }
    candidates = candidates.sort((a, b) => a.uid - b.uid);
    for (const env of envelopes) if (!candidates.includes(env) && !beforeStart.has(env.uid)) skippedUids.push(env.uid);
    summary.beforeStartDate = beforeStart.size;
    summary.candidates = candidates.length;
    // Dry run: orders it would create, so later emails in the batch are reported against them.
    const simulated = new Map<string, { id: string; invoiceRef: string }>();
    const simulatedByMessage = new Map<string, string[]>();

    // ---- download and parse candidates, then process oldest first so later emails win
    const parsed: { env: Envelope; email: ParsedEmail; attachments: AttachmentPlan[] }[] = [];
    for (const env of candidates) {
      try {
        const email = await parseEml(await source.fetchRaw(env.uid));
        parsed.push({ env, email, attachments: email.attachments.map(planAttachment) });
      } catch (error) {
        summary.errors.push(`UID ${env.uid}: ${(error as Error).message}`);
        summary.emails.push(report(env, null, "error", (error as Error).message));
      }
    }
    parsed.sort((a, b) => dateOf(a.email, a.env).getTime() - dateOf(b.email, b.env).getTime());

    for (const { env, email, attachments } of parsed) {
      const rep = report(env, email, "not_matched", null);
      summary.emails.push(rep);
      try {
        const [dup] = await db.select({ id: sourceEmailsTable.id }).from(sourceEmailsTable).where(eq(sourceEmailsTable.messageId, email.messageId));
        if (dup) {
          rep.outcome = "duplicate";
          summary.duplicates++;
          continue;
        }
        const orders = await knownOrders();
        const parentIds = [email.inReplyTo, ...email.references].filter((x): x is string => !!x);
        const threadOrderIds = [...new Set([...(await linkedOrderIdsForMessages(parentIds)), ...parentIds.flatMap((id) => simulatedByMessage.get(id) ?? [])])];
        let { links, poNumbersInSubject } = matchEmail(
          { subject: email.subject, forwardedSubjects: email.forwardedSubjects, fromAddress: email.fromAddress, threadOrderIds, watchPoKeys: [...poAllowlist] },
          orders,
        );
        // ---- a new allow-listed PO with its PO sheet attached becomes a new order
        const createdOrderIds = new Set<string>();
        for (const po of poNumbersInSubject.filter((p) => simulated.has(p))) {
          const sim = simulated.get(po)!;
          rep.orders.push({ invoiceRef: sim.invoiceRef, poNumber: po, matchStatus: "matched", matchMethod: "po_subject", created: false });
        }
        for (const id of threadOrderIds.filter((id) => id.startsWith("dry-run-"))) {
          const sim = [...simulated.values()].find((v) => v.id === id)!;
          rep.orders.push({ invoiceRef: sim.invoiceRef, poNumber: id.slice(8), matchStatus: "matched", matchMethod: "thread", created: false });
        }
        // Every PO sheet in the email (all attachments, all tabs), first copy of each PO wins.
        const sheets = new Map<string, PoSheetData>();
        for (const a of attachments) for (const s of a.pos) if (!sheets.has(poKey(s.poNumber))) sheets.set(poKey(s.poNumber), s);
        // Existing orders whose PO sheet is attached are linked too, even when the subject names another PO.
        for (const [key] of sheets) {
          const owners = orders.filter((o) => o.poNumber && poKey(o.poNumber) === key);
          for (const o of owners) {
            const existing = links.find((l) => l.orderId === o.id);
            // its own PO sheet is attached: no doubt which order it belongs to
            if (existing && owners.length === 1) existing.matchStatus = "matched";
            if (!existing) links.push({ orderId: o.id, matchStatus: owners.length === 1 ? "matched" : "needs_review", matchMethod: "po_sheet", matchReason: `PO sheet attached for PO ${key}${owners.length > 1 ? ` (PO shared by ${owners.length} buyers)` : ""}` });
          }
        }
        const newPos = [...new Set([...poNumbersInSubject, ...sheets.keys()])];
        for (const po of newPos.filter((p) => allowPo(p) && !simulated.has(p) && !orders.some((o) => o.poNumber && poKey(o.poNumber) === p))) {
          const sheet = sheets.get(po);
          if (!sheet) {
            rep.attachments.push({ filename: "-", kind: "note", changes: 0, warnings: [`PO ${po} is not in the system yet and this email has no PO sheet for it, so no order was created.`], skipped: null });
            continue;
          }
          const created = await createOrderFromSheet(sheet, email, dateOf(email, env), dryRun, simulated.size);
          if (typeof created === "string") {
            rep.attachments.push({ filename: "-", kind: "note", changes: 0, warnings: [created], skipped: null });
            continue;
          }
          createdOrderIds.add(created.id);
          if (dryRun) simulated.set(po, { id: created.id, invoiceRef: created.invoiceRef ?? sheet.poNumber });
          rep.orders.push({ invoiceRef: created.invoiceRef, poNumber: sheet.poNumber, matchStatus: "matched", matchMethod: poNumbersInSubject.includes(po) ? "po_subject" : "po_sheet", created: true });
          summary.ordersCreated.push(created.invoiceRef ?? `PO ${sheet.poNumber}`);
          const fromSubject = poNumbersInSubject.includes(po);
          if (!dryRun) links = [...links.filter((l) => l.orderId !== created.id), { orderId: created.id, matchStatus: "matched", matchMethod: fromSubject ? "po_subject" : "po_sheet", matchReason: `${fromSubject ? `subject: PO ${po}` : `PO sheet attached for PO ${po}`}; order created from its PO sheet` }];
        }
        // ---- the trial only stores emails about allow-listed POs
        const allowedIds = new Set((await knownOrders()).filter((o) => o.poNumber && allowPo(poKey(o.poNumber))).map((o) => o.id));
        links = links.filter((l) => allowedIds.has(l.orderId));
        for (const l of links) {
          const o = (await knownOrders()).find((x) => x.id === l.orderId)!;
          if (!createdOrderIds.has(l.orderId)) rep.orders.push({ invoiceRef: o.invoiceRef, poNumber: o.poNumber, matchStatus: l.matchStatus, matchMethod: l.matchMethod, created: false });
        }
        if (!links.length && !rep.orders.length) {
          rep.outcome = "not_matched";
          skippedUids.push(env.uid);
          continue;
        }
        if (dryRun) {
          rep.outcome = "would_store";
          simulatedByMessage.set(email.messageId, [...createdOrderIds, ...links.map((l) => l.orderId)]);
          // In a dry run "changes" is the number of items read (lines + colours, or trims), not a diff.
          for (const a of attachments) {
            if (a.pos.length > 1) for (const s of a.pos) rep.attachments.push({ filename: `${a.filename} (PO ${s.poNumber})`, kind: a.kind, changes: s.colourways.length + s.lines.length, warnings: s.warnings, skipped: null });
            else rep.attachments.push({ filename: a.filename, kind: a.kind, changes: a.pos[0] ? a.pos[0].colourways.length + a.pos[0].lines.length : (a.trims?.length ?? 0), warnings: a.pos[0]?.warnings ?? [], skipped: null });
          }
          continue;
        }
        await storeAndApply(email, env, uidValidity, source, attachments, links, blobs, rep);
        rep.outcome = "stored";
        summary.stored++;
      } catch (error) {
        rep.outcome = "error";
        rep.error = (error as Error).message;
        summary.errors.push(`UID ${env.uid} "${email.subject}": ${(error as Error).message}`);
      }
    }
    summary.skipped = skippedUids.length;

    if (!dryRun) {
      const lastUid = envelopes.length ? envelopes[envelopes.length - 1]!.uid : fromUid;
      if (rescanFromUid === undefined || lastUid > (cursor?.lastUid ?? 0)) {
        await db
          .insert(intakeCursorTable)
          .values({ mailbox: source.mailbox, imapFolder: source.folder, imapUidvalidity: uidValidity, lastUid })
          .onConflictDoUpdate({ target: [intakeCursorTable.mailbox, intakeCursorTable.imapFolder], set: { imapUidvalidity: uidValidity, lastUid, updatedAt: new Date() } });
      }
      await db.insert(activityTable).values({
        actor: "Email intake",
        description: `Mailbox run: ${summary.scanned} scanned, ${summary.stored} stored, ${summary.duplicates} already stored, ${summary.skipped} skipped${summary.beforeStartDate ? `, ${summary.beforeStartDate} before the start date` : ""}${summary.errors.length ? `, ${summary.errors.length} error(s)` : ""}`,
        entityType: "intake",
        entityId: source.mailbox,
        source: "email_intake",
        action: "intake.run",
        // Skipped messages are recorded by UID only: never subject, sender or content.
        details: { scanned: summary.scanned, stored: summary.stored, duplicates: summary.duplicates, skippedUids, beforeStartDate: summary.beforeStartDate, poScope: summary.poScope, startDate: summary.startDate, errors: summary.errors.length, ordersCreated: summary.ordersCreated },
      });
    }
    return summary;
  } finally {
    await source.close();
  }
}

export function currencyHintOf(email: ParsedEmail, attachments: AttachmentPlan[]): string | null {
  const usd = /\bUSD\b|\bUS\s?\$/i;
  return usd.test(email.bodyText) || attachments.some((a) => usd.test(a.extractedText ?? "")) ? "USD" : null;
}

function dateOf(email: ParsedEmail | null, env: Envelope): Date {
  return email?.effectiveDate ?? email?.sentAt ?? env.internalDate ?? new Date();
}

function report(env: Envelope, email: ParsedEmail | null, outcome: IntakeEmailReport["outcome"], error: string | null): IntakeEmailReport {
  return { uid: env.uid, subject: email?.subject ?? env.subject, date: dateOf(email, env).toISOString(), outcome, orders: [], attachments: [], error };
}

async function knownOrders(): Promise<(KnownOrder & { invoiceRef: string | null })[]> {
  const rows = await db
    .select({ id: ordersTable.id, poNumber: ordersTable.poNumber, invoiceNumber: ordersTable.invoiceNumber, invoiceRef: ordersTable.invoiceRef, domains: buyersTable.emailDomains })
    .from(ordersTable)
    .leftJoin(buyersTable, eq(buyersTable.id, ordersTable.buyerId))
    .where(sql`${ordersTable.poNumber} IS NOT NULL`);
  return rows.map((r) => ({ id: r.id, poNumber: r.poNumber, invoiceNumber: r.invoiceNumber, invoiceRef: r.invoiceRef, buyerDomains: r.domains ?? [] }));
}

export function planAttachment(a: ParsedEmail["attachments"][number]): AttachmentPlan {
  const base = { ...a, sha256: createHash("sha256").update(a.content).digest("hex"), pos: [] as PoSheetData[], trims: null, extractedText: null, extractError: null };
  if (!isSpreadsheet(a.filename, a.contentType)) return { ...base, kind: "other", extractStatus: "not_applicable" };
  try {
    const sheets = readWorkbook(a.content);
    const pos = extractPoSheets(sheets);
    const trims = pos.length ? null : extractTrimsSheet(sheets);
    return { ...base, pos, trims, kind: pos.length ? "po_sheet" : trims ? "trims_sheet" : "spreadsheet", extractStatus: "extracted", extractedText: sheetsToText(sheets) };
  } catch (error) {
    return { ...base, kind: "spreadsheet", extractStatus: "failed", extractError: (error as Error).message };
  }
}

async function createOrderFromSheet(sheet: PoSheetData, email: ParsedEmail, receivedAt: Date, dryRun: boolean, alreadySimulated = 0) {
  const buyers = await db.select().from(buyersTable);
  const domain = email.fromAddress.split("@")[1] ?? "";
  const buyer =
    buyers.find((b) => b.emailDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) ??
    (sheet.buyerName ? buyers.find((b) => sameCompany(b.name, sheet.buyerName!)) : undefined);
  if (!buyer) return `PO ${sheet.poNumber}: buyer "${sheet.buyerName ?? "unknown"}" does not match any buyer in the system, so no order was created.`;
  if (!sheet.shipDate) return `PO ${sheet.poNumber}: the PO sheet has no ship date, so no order was created.`;
  const quantity = sheet.grandTotalQty ?? sheet.colourways.reduce((s, c) => s + c.sizes.reduce((t, q) => t + q.quantity, 0), 0);
  const style = [...new Set(sheet.lines.map((l) => l.styleNumber).filter(Boolean))].join(", ") || "See PO";
  if (dryRun) {
    // the number it would get: the counter plus the orders this dry run already "created" before it
    const [counter] = await db.select({ last: invoiceCounterTable.lastNumber }).from(invoiceCounterTable);
    const next = counter ? String(counter.last + 1 + alreadySimulated) : "(next invoice)";
    return { id: `dry-run-${sheet.poNumber}`, invoiceRef: `${next}/BK-${buyer.abbreviation}/${invoiceYear(receivedAt)}` };
  }
  try {
    const order = await createOrderWithInvoice(
      { buyerId: buyer.id, buyer: buyer.name, poNumber: sheet.poNumber, poReceivedAt: receivedAt, style, quantity: Math.max(1, quantity), deliveryDate: sheet.shipDate },
      { id: "system:email-intake", label: "Email intake" },
      "email_intake",
    );
    return { id: order.id, invoiceRef: order.invoiceRef };
  } catch (error) {
    if (error instanceof OrderInputError) return error.message;
    throw error;
  }
}

async function storeAndApply(
  email: ParsedEmail,
  env: Envelope,
  uidValidity: number,
  source: MailSource,
  attachments: AttachmentPlan[],
  links: OrderLink[],
  blobs: BlobStore,
  rep: IntakeEmailReport,
) {
  // Upload first (outside the transaction), then record everything atomically.
  const rawPath = await blobs.put(await source.fetchRaw(env.uid), "message/rfc822");
  const attachmentPaths = await Promise.all(attachments.map((a) => blobs.put(a.content, a.contentType)));
  const currencyHint = currencyHintOf(email, attachments);
  const date = dateOf(email, env);
  const hasPo = attachments.some((a) => a.pos.length);
  const hasTrims = attachments.some((a) => a.trims);

  await db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(sourceEmailsTable)
      .values({
        mailbox: source.mailbox,
        imapFolder: source.folder,
        imapUidvalidity: uidValidity,
        imapUid: env.uid,
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        referencesHeader: email.references.join(" ") || null,
        threadKey: email.subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").toLowerCase().slice(0, 200),
        fromAddress: email.fromAddress,
        fromName: email.fromName,
        toAddresses: email.to,
        ccAddresses: email.cc,
        forwardedVia: email.forwardedVia,
        subject: email.subject,
        sentAt: date,
        receivedAt: env.internalDate ?? email.sentAt ?? new Date(),
        bodyText: email.bodyText,
        rawObjectPath: rawPath,
        category: hasPo ? "order_details" : hasTrims ? "trims_accessories" : /sample/i.test(email.subject) ? "sample_requirements" : "unclassified",
        parseStatus: attachments.some((a) => a.extractStatus === "failed") ? "partial" : "parsed",
        processedAt: new Date(),
      })
      .returning({ id: sourceEmailsTable.id });
    await tx.insert(sourceEmailOrdersTable).values(links.map((l) => ({ emailId: stored!.id, ...l })));
    const storedAttachments = attachments.length
      ? await tx
          .insert(sourceEmailAttachmentsTable)
          .values(
            attachments.map((a, i) => ({
              emailId: stored!.id,
              filename: a.filename,
              contentType: a.contentType,
              sizeBytes: a.content.length,
              sha256: a.sha256,
              contentId: a.contentId,
              isInline: a.isInline,
              objectPath: attachmentPaths[i]!,
              extractStatus: a.extractStatus,
              extractedText: a.extractedText,
              extractError: a.extractError,
            })),
          )
          .returning({ id: sourceEmailAttachmentsTable.id })
      : [];

    // Data is applied only to confirmed (matched) orders; needs_review links wait for staff.
    // Each order gets its own PO sheet (by PO number) and any trims sheet.
    const matched = links.filter((l) => l.matchStatus === "matched");
    const poOf = new Map((matched.length ? await tx.select({ id: ordersTable.id, poNumber: ordersTable.poNumber }).from(ordersTable).where(inArray(ordersTable.id, matched.map((l) => l.orderId))) : []).map((o) => [o.id, o.poNumber]));
    const poSheetsInEmail = attachments.reduce((n, a) => n + a.pos.length, 0);
    for (const link of matched) {
      for (const [i, a] of attachments.entries()) {
        for (const sheet of sheetsForOrder(a, poOf.get(link.orderId) ?? null, poSheetsInEmail)) {
          const ctx: ApplyContext = { orderId: link.orderId, emailId: stored!.id, attachmentId: storedAttachments[i]!.id, emailDate: date, currencyHint };
          const result = await applySheet(tx, ctx, sheet);
          const label = sheet.kind === "PO sheet" && a.pos.length > 1 ? `${a.filename} (PO ${sheet.po.poNumber})` : a.filename;
          await logApplied(tx, ctx, sheet.kind, label, email.subject, result);
          rep.attachments.push({ filename: label, kind: a.kind, changes: result.changes.length, warnings: result.warnings, skipped: result.skipped });
        }
      }
    }
    for (const a of attachments.filter((x) => !x.pos.length && !x.trims)) {
      rep.attachments.push({ filename: a.filename, kind: a.kind, changes: 0, warnings: a.extractError ? [a.extractError] : [], skipped: null });
    }
  });
}

/** Orders referenced by IDs, used in tests and reports. */
export async function ordersById(ids: string[]) {
  return ids.length ? db.select().from(ordersTable).where(inArray(ordersTable.id, ids)) : [];
}
