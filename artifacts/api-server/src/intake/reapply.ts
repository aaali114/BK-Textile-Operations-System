import { and, asc, eq, inArray, isNotNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  activityTable,
  colourwaysTable,
  db,
  fabricsTable,
  orderLinesTable,
  ordersTable,
  sizeQuantitiesTable,
  trimsTable,
  sourceEmailAttachmentsTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
} from "@workspace/db";
import { applyPoSheet, applyTrimsSheet, logApplied, type ApplyContext } from "./apply";
import { parseEml } from "./mime";
import { currencyHintOf, planAttachment, type BlobReader } from "./run";
import { isSpreadsheet } from "./spreadsheet";

export type ReapplyReport = {
  orderId: string;
  emails: {
    emailId: string;
    subject: string;
    previousDate: string | null;
    originalDate: string | null;
    attachments: { filename: string; kind: string; changes: number; warnings: string[]; skipped: string | null }[];
  }[];
};

/**
 * Re-reads every email matched to an order from storage, corrects its
 * original date (e.g. the buyer's date inside a manual forward), and applies
 * its PO / trims sheets again from oldest to newest, so the latest email wins.
 * Each application is logged as "Re-applied ..." with its old -> new values.
 */
export async function reapplyOrderEmails(orderId: string, blobs: BlobReader, actor: { id: string; label: string }): Promise<ReapplyReport> {
  const emails = await db
    .select({ id: sourceEmailsTable.id, subject: sourceEmailsTable.subject, sentAt: sourceEmailsTable.sentAt, receivedAt: sourceEmailsTable.receivedAt, rawObjectPath: sourceEmailsTable.rawObjectPath })
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .where(and(eq(sourceEmailOrdersTable.orderId, orderId), eq(sourceEmailOrdersTable.matchStatus, "matched")));
  const attachments = emails.length
    ? await db
        .select()
        .from(sourceEmailAttachmentsTable)
        .where(inArray(sourceEmailAttachmentsTable.emailId, emails.map((e) => e.id)))
        .orderBy(asc(sourceEmailAttachmentsTable.createdAt))
    : [];

  // 1. correct dates from the stored raw messages
  const prepared: { e: (typeof emails)[number]; parsed: Awaited<ReturnType<typeof parseEml>>; originalDate: Date }[] = [];
  for (const e of emails) {
    const parsed = await parseEml(await blobs.get(e.rawObjectPath));
    const originalDate = parsed.effectiveDate ?? parsed.sentAt ?? e.sentAt ?? e.receivedAt;
    if (!e.sentAt || e.sentAt.getTime() !== originalDate.getTime()) {
      await db.update(sourceEmailsTable).set({ sentAt: originalDate }).where(eq(sourceEmailsTable.id, e.id));
    }
    prepared.push({ e, parsed, originalDate });
  }
  prepared.sort((a, b) => a.originalDate.getTime() - b.originalDate.getTime());

  // 2. re-apply oldest first
  const report: ReapplyReport = { orderId, emails: [] };
  for (const { e, parsed, originalDate } of prepared) {
    const entry: ReapplyReport["emails"][number] = {
      emailId: e.id,
      subject: e.subject,
      previousDate: e.sentAt?.toISOString() ?? null,
      originalDate: originalDate.toISOString(),
      attachments: [],
    };
    report.emails.push(entry);
    const plans: { a: (typeof attachments)[number]; plan: ReturnType<typeof planAttachment> }[] = [];
    for (const a of attachments.filter((x) => x.emailId === e.id && isSpreadsheet(x.filename, x.contentType))) {
      const plan = planAttachment({ filename: a.filename, contentType: a.contentType, content: await blobs.get(a.objectPath), contentId: a.contentId, isInline: a.isInline });
      plans.push({ a, plan });
    }
    const currencyHint = currencyHintOf(parsed, plans.map((p) => p.plan));
    await db.transaction(async (tx) => {
      for (const { a, plan } of plans) {
        if (!plan.po && !plan.trims) {
          entry.attachments.push({ filename: a.filename, kind: plan.kind, changes: 0, warnings: plan.extractError ? [plan.extractError] : [], skipped: null });
          continue;
        }
        const ctx: ApplyContext = { orderId, emailId: e.id, attachmentId: a.id, emailDate: originalDate, currencyHint };
        const result = plan.po ? await applyPoSheet(tx, ctx, plan.po) : await applyTrimsSheet(tx, ctx, plan.trims!);
        await logApplied(tx, ctx, plan.po ? "PO sheet" : "trims sheet", a.filename, e.subject, result, true);
        entry.attachments.push({ filename: a.filename, kind: plan.kind, changes: result.changes.length, warnings: result.warnings, skipped: result.skipped });
      }
    });
  }
  // 3. "PO received" is the earliest original email about the order. The BK invoice number is never changed here.
  const earliest = prepared[0]?.originalDate;
  const [order] = await db.select({ poReceivedAt: ordersTable.poReceivedAt }).from(ordersTable).where(eq(ordersTable.id, orderId));
  const receivedChange =
    earliest && order && (!order.poReceivedAt || earliest.getTime() < order.poReceivedAt.getTime())
      ? { field: "order.poReceivedAt", from: order.poReceivedAt?.toISOString() ?? null, to: earliest.toISOString() }
      : null;
  if (receivedChange) await db.update(ordersTable).set({ poReceivedAt: earliest }).where(eq(ordersTable.id, orderId));

  await db.insert(activityTable).values({
    actor: actor.label,
    actorId: actor.id,
    description: `Re-applied ${report.emails.length} email(s) in their original date order${receivedChange ? `; PO received corrected to ${earliest!.toISOString().slice(0, 10)}` : ""}`,
    entityType: "order",
    entityId: orderId,
    orderId,
    source: "staff",
    action: "intake.reapplied",
    details: {
      changes: receivedChange ? [receivedChange] : [],
      emails: report.emails.map((x) => ({ subject: x.subject, previousDate: x.previousDate, originalDate: x.originalDate })),
    },
  });
  return report;
}

export type RebuildReport = ReapplyReport & { cleared: { sizes: number; trims: number; fabrics: number; colours: number; lines: number; header: boolean } };

/**
 * Rebuilds an order's email data after an email was removed from it (or put
 * back, or uploaded): first clears what came only from emails that are no
 * longer linked to the order, then re-applies the remaining linked emails from
 * oldest to newest so the latest one wins again. Rows staff entered by hand
 * (no source email) are never touched. Header values the removed email set
 * stay until a remaining email sets them again; they are then shown as edited
 * by hand (no source).
 */
export async function rebuildOrderFromEmails(orderId: string, blobs: BlobReader, actor: { id: string; label: string }): Promise<RebuildReport> {
  const cleared = await db.transaction(async (tx) => {
    await tx.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    const linked = (
      await tx
        .select({ id: sourceEmailOrdersTable.emailId })
        .from(sourceEmailOrdersTable)
        .where(and(eq(sourceEmailOrdersTable.orderId, orderId), eq(sourceEmailOrdersTable.matchStatus, "matched")))
    ).map((r) => r.id);
    const stale = (orderCol: PgColumn, sourceCol: PgColumn): SQL =>
      and(eq(orderCol, orderId), isNotNull(sourceCol), linked.length ? notInArray(sourceCol, linked) : sql`true`)!;

    const sizes = await tx.delete(sizeQuantitiesTable).where(stale(sizeQuantitiesTable.orderId, sizeQuantitiesTable.sourceEmailId)).returning({ id: sizeQuantitiesTable.id });
    const trims = await tx.delete(trimsTable).where(stale(trimsTable.orderId, trimsTable.sourceEmailId)).returning({ id: trimsTable.id });
    const fabrics = await tx.delete(fabricsTable).where(stale(fabricsTable.orderId, fabricsTable.sourceEmailId)).returning({ id: fabricsTable.id });

    // A colour or line from a removed email goes too, unless something still hangs off it (e.g. sizes typed in by hand); then it is kept as hand-entered.
    let colours = 0;
    for (const c of await tx.select({ id: colourwaysTable.id }).from(colourwaysTable).where(stale(colourwaysTable.orderId, colourwaysTable.sourceEmailId))) {
      const inUse =
        (await tx.select({ id: sizeQuantitiesTable.id }).from(sizeQuantitiesTable).where(eq(sizeQuantitiesTable.colourwayId, c.id)).limit(1)).length +
        (await tx.select({ id: trimsTable.id }).from(trimsTable).where(eq(trimsTable.colourwayId, c.id)).limit(1)).length +
        (await tx.select({ id: fabricsTable.id }).from(fabricsTable).where(eq(fabricsTable.colourwayId, c.id)).limit(1)).length;
      if (inUse > 0) await tx.update(colourwaysTable).set({ sourceEmailId: null, sourceAttachmentId: null }).where(eq(colourwaysTable.id, c.id));
      else {
        await tx.delete(colourwaysTable).where(eq(colourwaysTable.id, c.id));
        colours++;
      }
    }
    let lines = 0;
    for (const l of await tx.select({ id: orderLinesTable.id }).from(orderLinesTable).where(stale(orderLinesTable.orderId, orderLinesTable.sourceEmailId))) {
      const [used] = await tx.select({ id: colourwaysTable.id }).from(colourwaysTable).where(eq(colourwaysTable.lineId, l.id)).limit(1);
      if (used) await tx.update(orderLinesTable).set({ sourceEmailId: null, sourceAttachmentId: null }).where(eq(orderLinesTable.id, l.id));
      else {
        await tx.delete(orderLinesTable).where(eq(orderLinesTable.id, l.id));
        lines++;
      }
    }
    const header = await tx
      .update(ordersTable)
      .set({ headerSourceEmailId: null })
      .where(and(eq(ordersTable.id, orderId), isNotNull(ordersTable.headerSourceEmailId), linked.length ? notInArray(ordersTable.headerSourceEmailId, linked) : sql`true`))
      .returning({ id: ordersTable.id });
    return { sizes: sizes.length, trims: trims.length, fabrics: fabrics.length, colours, lines, header: header.length > 0 };
  });
  const report = await reapplyOrderEmails(orderId, blobs, actor);
  return { ...report, cleared };
}
