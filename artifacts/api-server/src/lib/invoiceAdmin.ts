import { eq, max, sql } from "drizzle-orm";
import {
  activityTable,
  buyersTable,
  db,
  formatInvoiceRef,
  invoiceCounterTable,
  invoiceYear,
  ordersTable,
} from "@workspace/db";

export type Actor = { id: string; label: string };

export class InvoiceAdminError extends Error {
  constructor(
    public status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export async function getInvoiceCounter() {
  const [[counter], [used]] = await Promise.all([
    db.select({ lastNumber: invoiceCounterTable.lastNumber }).from(invoiceCounterTable).where(eq(invoiceCounterTable.id, 1)),
    db.select({ highest: max(ordersTable.invoiceNumber) }).from(ordersTable),
  ]);
  if (!counter) throw new Error("bk_invoice_counter is not initialised");
  return { lastNumber: counter.lastNumber, nextNumber: counter.lastNumber + 1, highestUsed: used?.highest ?? null };
}

/** Sets the last-used number; the next order gets lastNumber + 1. Never below a number already on an order. */
export async function setInvoiceCounter(lastNumber: number, reason: string, actor: Actor) {
  await db.transaction(async (tx) => {
    const [counter] = await tx
      .select({ lastNumber: invoiceCounterTable.lastNumber })
      .from(invoiceCounterTable)
      .where(eq(invoiceCounterTable.id, 1))
      .for("update");
    if (!counter) throw new Error("bk_invoice_counter is not initialised");
    const [used] = await tx.select({ highest: max(ordersTable.invoiceNumber) }).from(ordersTable);
    const highest = used?.highest ?? null;
    if (highest !== null && lastNumber < highest) {
      throw new InvoiceAdminError(
        409,
        `Invoice ${highest} is already on an order, so the counter cannot be set below ${highest}.`,
      );
    }
    await tx
      .update(invoiceCounterTable)
      .set({ lastNumber, updatedAt: new Date() })
      .where(eq(invoiceCounterTable.id, 1));
    await tx.insert(activityTable).values({
      actor: actor.label,
      actorId: actor.id,
      description: `Invoice counter set: last used ${counter.lastNumber} → ${lastNumber} (next new order gets ${lastNumber + 1}). Reason: ${reason}`,
      entityType: "invoice_counter",
      entityId: "1",
      source: "staff",
      action: "invoice.counter_set",
      details: { changes: [{ field: "lastNumber", from: counter.lastNumber, to: lastNumber }], reason },
    });
  });
  return getInvoiceCounter();
}

/** Overwrites one order's invoice number and rebuilds its reference. Does not move the counter. */
export async function setOrderInvoiceNumber(orderId: string, invoiceNumber: number, reason: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    if (!order) throw new InvoiceAdminError(404, "Order not found");
    if (!order.buyerId) throw new InvoiceAdminError(409, "This order has no buyer, so it cannot carry a BK invoice.");
    const [buyer] = await tx
      .select({ abbreviation: buyersTable.abbreviation })
      .from(buyersTable)
      .where(eq(buyersTable.id, order.buyerId));
    const [clash] = await tx
      .select({ id: ordersTable.id, invoiceRef: ordersTable.invoiceRef })
      .from(ordersTable)
      .where(sql`${ordersTable.invoiceNumber} = ${invoiceNumber} AND ${ordersTable.id} <> ${orderId}`);
    if (clash) throw new InvoiceAdminError(409, `Invoice ${invoiceNumber} is already used by ${clash.invoiceRef}.`);

    const invoiceRef = formatInvoiceRef(invoiceNumber, buyer!.abbreviation, invoiceYear(order.poReceivedAt ?? order.createdAt));
    const [updated] = await tx
      .update(ordersTable)
      .set({
        invoiceNumber,
        invoiceRef,
        // Orders created by the system use the invoice reference as their reference.
        ...(order.reference === order.invoiceRef ? { reference: invoiceRef } : {}),
      })
      .where(eq(ordersTable.id, orderId))
      .returning();
    await tx.insert(activityTable).values({
      actor: actor.label,
      actorId: actor.id,
      description: `BK invoice changed: ${order.invoiceRef ?? "none"} → ${invoiceRef}. Reason: ${reason}`,
      entityType: "order",
      entityId: orderId,
      orderId,
      source: "staff",
      action: "invoice.overridden",
      details: { changes: [{ field: "invoiceRef", from: order.invoiceRef, to: invoiceRef }], reason },
    });
    return updated!;
  });
}
