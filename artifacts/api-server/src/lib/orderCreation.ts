import { eq, sql } from "drizzle-orm";
import { activityTable, assignInvoiceNumber, buyersTable, db, ordersTable, workItemsTable } from "@workspace/db";
import type { Actor } from "./invoiceAdmin";
import { isUniqueViolation } from "./pgErrors";

export class OrderInputError extends Error {
  constructor(
    public status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

type BuyerRow = typeof buyersTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Finds the buyer by ID, or by a name or abbreviation typed into the order form (case-insensitive). */
export async function resolveBuyer(tx: Tx, input: { buyerId?: string; buyer: string }): Promise<BuyerRow> {
  if (input.buyerId) {
    const [byId] = await tx.select().from(buyersTable).where(eq(buyersTable.id, input.buyerId));
    if (!byId) throw new OrderInputError(400, "Unknown buyer.");
    return byId;
  }
  const typed = input.buyer.trim();
  const [byText] = await tx
    .select()
    .from(buyersTable)
    .where(sql`lower(${buyersTable.name}) = lower(${typed}) OR upper(${buyersTable.abbreviation}) = upper(${typed})`);
  if (byText) return byText;
  const known = await tx.select({ name: buyersTable.name, abbreviation: buyersTable.abbreviation }).from(buyersTable);
  throw new OrderInputError(
    400,
    `Unknown buyer "${typed}". Use one of: ${known.map((b) => `${b.name} (${b.abbreviation})`).join(", ")}.`,
  );
}

export type NewOrder = {
  buyerId?: string;
  buyer: string;
  poNumber?: string;
  poReceivedAt?: Date;
  poIssueDate?: string;
  endCustomer?: string;
  priceTerms?: string;
  paymentTerms?: string;
  shipVia?: string;
  countryOfOrigin?: string;
  overShipTolerancePct?: number;
  agencyName?: string;
  previousOrderReference?: string;
  orderValue?: number;
  currencyCode?: string;
  style: string;
  description?: string;
  quantity: number;
  deliveryDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
};

const trimOrNull = (v?: string) => v?.trim() || null;

/**
 * Creates an order for a buyer PO and assigns its BK invoice in the same
 * transaction, so a failed creation gives the number back.
 */
export async function createOrderWithInvoice(input: NewOrder, actor: Actor, source: "staff" | "email_intake" = "staff") {
  const poNumber = input.poNumber?.trim();
  if (!poNumber) throw new OrderInputError(400, "A buyer PO number is required: every order is one PO.");
  const poReceivedAt = input.poReceivedAt ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const buyer = await resolveBuyer(tx, input);
      const [existing] = await tx
        .select({ invoiceRef: ordersTable.invoiceRef, reference: ordersTable.reference })
        .from(ordersTable)
        // Same PO ignoring case, spaces and punctuation ("AC-PO-9812" = "acpo9812").
        .where(sql`${ordersTable.buyerId} = ${buyer.id} AND upper(regexp_replace(${ordersTable.poNumber}, '[^A-Za-z0-9]', '', 'g')) = ${poNumber.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);
      if (existing) {
        throw new OrderInputError(409, `PO ${poNumber} for ${buyer.name} already exists as ${existing.invoiceRef ?? existing.reference}.`);
      }
      const invoice = await assignInvoiceNumber(tx, buyer.id, poReceivedAt);
      const [created] = await tx
        .insert(ordersTable)
        .values({
          reference: invoice.invoiceRef,
          invoiceNumber: invoice.invoiceNumber,
          invoiceRef: invoice.invoiceRef,
          buyerId: buyer.id,
          buyer: buyer.name,
          poNumber,
          poReceivedAt,
          poIssueDate: input.poIssueDate ?? null,
          endCustomer: trimOrNull(input.endCustomer),
          priceTerms: trimOrNull(input.priceTerms),
          paymentTerms: trimOrNull(input.paymentTerms),
          shipVia: trimOrNull(input.shipVia),
          countryOfOrigin: trimOrNull(input.countryOfOrigin),
          overShipTolerancePct: input.overShipTolerancePct ?? null,
          agencyName: trimOrNull(input.agencyName),
          previousOrderReference: trimOrNull(input.previousOrderReference),
          orderValue: input.orderValue ?? null,
          currencyCode: input.currencyCode?.trim().toUpperCase() || null,
          style: input.style.trim(),
          description: trimOrNull(input.description),
          quantity: input.quantity,
          deliveryDate: input.deliveryDate,
          priority: input.priority ?? "normal",
        })
        .returning();
      await tx.insert(workItemsTable).values(
        [
          ["Confirm order details", "merchandising"],
          ["Prepare fabric plan", "fabrication"],
        ].map(([title, department]) => ({
          orderId: created!.id,
          title: title!,
          department: department!,
          dueDate: input.deliveryDate,
          status: "not_started",
          priority: input.priority ?? "normal",
        })),
      );
      await tx.insert(activityTable).values({
        actor: actor.label,
        actorId: actor.id,
        description: `Created order ${invoice.invoiceRef} for PO ${poNumber}`,
        entityType: "order",
        entityId: created!.id,
        orderId: created!.id,
        source,
        action: "order.created",
        details: { invoiceRef: invoice.invoiceRef, poNumber },
      });
      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error, "bk_orders_buyer_po_unique")) throw new OrderInputError(409, `PO ${poNumber} already exists for this buyer.`);
    throw error;
  }
}
