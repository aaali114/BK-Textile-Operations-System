import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  activityTable,
  colourwaysTable,
  db,
  fabricsTable,
  orderLinesTable,
  ordersTable,
  sizeQuantitiesTable,
  sourceEmailAttachmentsTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
  trimsTable,
} from "@workspace/db";

export async function orderExists(orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, orderId));
  return !!row;
}

/** Lines, colours under each line, and the colour x size grid, with totals. Null when the order does not exist. */
export async function getOrderBreakdown(orderId: string) {
  const [order] = await db
    .select({ quantity: ordersTable.quantity, currencyCode: ordersTable.currencyCode })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  if (!order) return null;
  const [lines, colourways, sizes] = await Promise.all([
    db.select().from(orderLinesTable).where(eq(orderLinesTable.orderId, orderId)).orderBy(asc(orderLinesTable.sortOrder), asc(orderLinesTable.createdAt)),
    db.select().from(colourwaysTable).where(eq(colourwaysTable.orderId, orderId)).orderBy(asc(colourwaysTable.sortOrder), asc(colourwaysTable.createdAt)),
    db.select().from(sizeQuantitiesTable).where(eq(sizeQuantitiesTable.orderId, orderId)).orderBy(asc(sizeQuantitiesTable.sizeSort)),
  ]);

  const sizeSortByLabel = new Map<string, number>();
  for (const s of sizes) {
    const current = sizeSortByLabel.get(s.sizeLabel);
    if (current === undefined || s.sizeSort < current) sizeSortByLabel.set(s.sizeLabel, s.sizeSort);
  }
  const sizeLabels = [...sizeSortByLabel.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);

  const shapeColourway = (c: typeof colourways[number]) => {
    const own = sizes.filter((s) => s.colourwayId === c.id);
    return {
      id: c.id,
      lineId: c.lineId,
      code: c.code,
      name: c.name,
      buyerReference: c.buyerReference,
      sortOrder: c.sortOrder,
      sourceEmailId: c.sourceEmailId,
      sizes: own.map((s) => ({ sizeLabel: s.sizeLabel, sizeSort: s.sizeSort, quantity: s.quantity })),
      total: own.reduce((sum, s) => sum + s.quantity, 0),
    };
  };
  const shapedLines = lines.map((line) => {
    const lineColourways = colourways.filter((c) => c.lineId === line.id).map(shapeColourway);
    return {
      id: line.id,
      styleNumber: line.styleNumber,
      description: line.description,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      sortOrder: line.sortOrder,
      sourceEmailId: line.sourceEmailId,
      colourways: lineColourways,
      gridTotal: lineColourways.reduce((sum, c) => sum + c.total, 0),
    };
  });
  const unassignedColourways = colourways.filter((c) => !c.lineId).map(shapeColourway);
  const gridTotal = sizes.reduce((sum, s) => sum + s.quantity, 0);
  return {
    orderId,
    currencyCode: order.currencyCode,
    sizeLabels,
    lines: shapedLines,
    unassignedColourways,
    gridTotal,
    orderQuantity: order.quantity,
    quantityMismatch: sizes.length > 0 && gridTotal !== order.quantity,
  };
}

export async function getOrderFabrics(orderId: string) {
  return db.select().from(fabricsTable).where(eq(fabricsTable.orderId, orderId)).orderBy(asc(fabricsTable.createdAt));
}

export async function getOrderTrims(orderId: string) {
  return db.select().from(trimsTable).where(eq(trimsTable.orderId, orderId)).orderBy(asc(trimsTable.trimType), asc(trimsTable.createdAt));
}

/** The order's change log: rows linked by order_id (intake, admin) and older rows linked by entity. */
export async function getOrderActivity(orderId: string) {
  return db
    .select({
      id: activityTable.id,
      actor: activityTable.actor,
      actorId: activityTable.actorId,
      description: activityTable.description,
      source: activityTable.source,
      action: activityTable.action,
      details: activityTable.details,
      sourceEmailId: activityTable.sourceEmailId,
      occurredAt: activityTable.occurredAt,
    })
    .from(activityTable)
    .where(or(eq(activityTable.orderId, orderId), and(eq(activityTable.entityType, "order"), eq(activityTable.entityId, orderId))))
    .orderBy(desc(activityTable.occurredAt));
}

const emailColumns = {
  id: sourceEmailsTable.id,
  subject: sourceEmailsTable.subject,
  fromAddress: sourceEmailsTable.fromAddress,
  fromName: sourceEmailsTable.fromName,
  sentAt: sourceEmailsTable.sentAt,
  receivedAt: sourceEmailsTable.receivedAt,
  category: sourceEmailsTable.category,
  parseStatus: sourceEmailsTable.parseStatus,
  matchStatus: sourceEmailOrdersTable.matchStatus,
  matchMethod: sourceEmailOrdersTable.matchMethod,
  matchReason: sourceEmailOrdersTable.matchReason,
  matchedAt: sourceEmailOrdersTable.matchedAt,
};

async function attachmentsFor(emailIds: string[]) {
  if (!emailIds.length) return new Map<string, never[]>();
  const rows = await db
    .select({
      id: sourceEmailAttachmentsTable.id,
      emailId: sourceEmailAttachmentsTable.emailId,
      filename: sourceEmailAttachmentsTable.filename,
      contentType: sourceEmailAttachmentsTable.contentType,
      sizeBytes: sourceEmailAttachmentsTable.sizeBytes,
      isInline: sourceEmailAttachmentsTable.isInline,
      extractStatus: sourceEmailAttachmentsTable.extractStatus,
      orderFileId: sourceEmailAttachmentsTable.orderFileId,
    })
    .from(sourceEmailAttachmentsTable)
    .where(inArray(sourceEmailAttachmentsTable.emailId, emailIds))
    .orderBy(asc(sourceEmailAttachmentsTable.createdAt));
  const byEmail = new Map<string, Omit<typeof rows[number], "emailId">[]>();
  for (const { emailId, ...rest } of rows) byEmail.set(emailId, [...(byEmail.get(emailId) ?? []), rest]);
  return byEmail;
}

export async function getOrderEmails(orderId: string) {
  const emails = await db
    .select(emailColumns)
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .where(eq(sourceEmailOrdersTable.orderId, orderId))
    .orderBy(desc(sourceEmailsTable.receivedAt));
  const attachments = await attachmentsFor(emails.map((e) => e.id));
  return emails.map((e) => ({ ...e, attachments: attachments.get(e.id) ?? [] }));
}

export async function getOrderEmail(orderId: string, emailId: string) {
  const [email] = await db
    .select({
      ...emailColumns,
      toAddresses: sourceEmailsTable.toAddresses,
      ccAddresses: sourceEmailsTable.ccAddresses,
      bodyText: sourceEmailsTable.bodyText,
      parseError: sourceEmailsTable.parseError,
    })
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .where(and(eq(sourceEmailOrdersTable.orderId, orderId), eq(sourceEmailOrdersTable.emailId, emailId)));
  if (!email) return null;
  const attachments = await attachmentsFor([email.id]);
  return { ...email, attachments: attachments.get(email.id) ?? [] };
}

/** Confirms/ignores a link or corrects the category; logs what changed. Null when not linked. */
export async function updateOrderEmail(
  orderId: string,
  emailId: string,
  input: { matchStatus?: "matched" | "ignored"; category?: string },
  actor: { id: string; label: string },
) {
  const updated = await db.transaction(async (tx) => {
    const [link] = await tx
      .select({ id: sourceEmailOrdersTable.id, matchStatus: sourceEmailOrdersTable.matchStatus, category: sourceEmailsTable.category, subject: sourceEmailsTable.subject })
      .from(sourceEmailOrdersTable)
      .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
      .where(and(eq(sourceEmailOrdersTable.orderId, orderId), eq(sourceEmailOrdersTable.emailId, emailId)))
      .for("update");
    if (!link) return false;
    const changes: { field: string; from: string; to: string }[] = [];
    if (input.matchStatus && input.matchStatus !== link.matchStatus) {
      await tx
        .update(sourceEmailOrdersTable)
        .set({ matchStatus: input.matchStatus, reviewedBy: actor.label, reviewedAt: new Date() })
        .where(eq(sourceEmailOrdersTable.id, link.id));
      changes.push({ field: "matchStatus", from: link.matchStatus, to: input.matchStatus });
    }
    if (input.category && input.category !== link.category) {
      await tx.update(sourceEmailsTable).set({ category: input.category }).where(eq(sourceEmailsTable.id, emailId));
      changes.push({ field: "category", from: link.category, to: input.category });
    }
    if (changes.length) {
      await tx.insert(activityTable).values({
        actor: actor.label,
        actorId: actor.id,
        description: `Email "${link.subject}": ${changes.map((c) => `${c.field} ${c.from} → ${c.to}`).join("; ")}`,
        entityType: "source_email",
        entityId: emailId,
        orderId,
        sourceEmailId: emailId,
        source: "staff",
        action: "email.link_updated",
        details: { changes },
      });
    }
    return true;
  });
  if (!updated) return null;
  const emails = await getOrderEmails(orderId);
  return emails.find((e) => e.id === emailId) ?? null;
}

/** The attachment's storage record, only when its email is linked to this order. */
export async function findOrderEmailAttachment(orderId: string, emailId: string, attachmentId: string) {
  const [row] = await db
    .select({
      filename: sourceEmailAttachmentsTable.filename,
      contentType: sourceEmailAttachmentsTable.contentType,
      sizeBytes: sourceEmailAttachmentsTable.sizeBytes,
      objectPath: sourceEmailAttachmentsTable.objectPath,
    })
    .from(sourceEmailAttachmentsTable)
    .innerJoin(sourceEmailOrdersTable, eq(sourceEmailOrdersTable.emailId, sourceEmailAttachmentsTable.emailId))
    .where(
      and(
        eq(sourceEmailAttachmentsTable.id, attachmentId),
        eq(sourceEmailAttachmentsTable.emailId, emailId),
        eq(sourceEmailOrdersTable.orderId, orderId),
      ),
    );
  return row ?? null;
}
