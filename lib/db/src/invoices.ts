import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import { buyersTable, invoiceCounterTable } from "./schema";

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/** Formats a BK invoice reference: 4040/BK-SAS/2026. */
export function formatInvoiceRef(invoiceNumber: number, buyerAbbreviation: string, year: number): string {
  return `${invoiceNumber}/BK-${buyerAbbreviation}/${year}`;
}

/**
 * Takes the next BK invoice number and builds its reference. Must be called
 * inside the transaction that creates the order: the UPDATE locks the counter
 * row until that transaction ends, so concurrent orders queue, and a rolled
 * back order gives its number back. Numbers therefore never skip or repeat.
 * The year is the year the PO was received (in Pakistan time).
 */
export async function assignInvoiceNumber(
  tx: Tx,
  buyerId: string,
  poReceivedAt: Date,
): Promise<{ invoiceNumber: number; invoiceRef: string }> {
  const [buyer] = await tx
    .select({ abbreviation: buyersTable.abbreviation })
    .from(buyersTable)
    .where(eq(buyersTable.id, buyerId));
  if (!buyer) throw new Error(`Unknown buyer ${buyerId}`);

  const [counter] = await tx
    .update(invoiceCounterTable)
    .set({ lastNumber: sql`${invoiceCounterTable.lastNumber} + 1`, updatedAt: new Date() })
    .where(eq(invoiceCounterTable.id, 1))
    .returning({ lastNumber: invoiceCounterTable.lastNumber });
  if (!counter) throw new Error("bk_invoice_counter is not initialised");

  const year = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric" }).format(poReceivedAt),
  );
  return {
    invoiceNumber: counter.lastNumber,
    invoiceRef: formatInvoiceRef(counter.lastNumber, buyer.abbreviation, year),
  };
}
