/**
 * Matching rules (docs/po-36572-intake-db-plan.md -> Email matching):
 *  - a known PO number in the subject                 -> matched   (po_subject)
 *  - a BK invoice reference in the subject             -> matched   (invoice_ref)
 *  - a reply in a thread already matched to the order  -> matched   (thread)
 *  - the subject names two different orders            -> needs_review on each
 *  - a PO shared by several buyers                     -> needs_review unless the sender's domain picks one
 * Only the subject (and forwarded subjects) and thread headers are used: a PO
 * mentioned only in the body is often an older order cited for repeat specs.
 */

export type KnownOrder = { id: string; poNumber: string | null; invoiceNumber: number | null; buyerDomains: string[] };
export type MatchInput = {
  subject: string;
  forwardedSubjects: string[];
  fromAddress: string;
  /** Order IDs already linked to any message this one replies to or references. */
  threadOrderIds: string[];
};
export type OrderLink = { orderId: string; matchStatus: "matched" | "needs_review"; matchMethod: "po_subject" | "invoice_ref" | "thread"; matchReason: string };
export type MatchResult = { links: OrderLink[]; poNumbersInSubject: string[] };

/** PO numbers written as "PO# 36572", "PO 36572", "P.O. #36572", "purchase order # 36572". */
export function poNumbersIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:p\.?\s?o\.?|purchase\s+order)\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d{4,8})\b/gi)) found.add(m[1]!);
  return [...found];
}

/** BK invoice references: "4040/BK-SAS/2026", "BK Inv 4040", "Inv# 4040", "Invoice 4040". */
export function invoiceNumbersIn(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\b(\d{4,6})\s*\/\s*BK-[A-Z]{2,5}\s*\/\s*\d{4}\b/gi)) found.add(Number(m[1]));
  for (const m of text.matchAll(/\b(?:BK[\s-]*)?inv(?:oice)?\.?\s*(?:no\.?|#)?\s*[:#]?\s*(\d{4,6})\b/gi)) found.add(Number(m[1]));
  return [...found];
}

export function matchEmail(input: MatchInput, orders: KnownOrder[]): MatchResult {
  const subjects = [input.subject, ...input.forwardedSubjects].join(" \n ");
  const pos = poNumbersIn(subjects);
  const invoices = invoiceNumbersIn(subjects);
  const senderDomain = input.fromAddress.split("@")[1] ?? "";
  const links = new Map<string, OrderLink>();

  for (const po of pos) {
    const candidates = orders.filter((o) => o.poNumber === po);
    const byDomain = candidates.filter((o) => o.buyerDomains.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`)));
    const chosen = candidates.length > 1 && byDomain.length === 1 ? byDomain : candidates;
    for (const o of chosen) {
      links.set(o.id, {
        orderId: o.id,
        matchStatus: chosen.length > 1 ? "needs_review" : "matched",
        matchMethod: "po_subject",
        matchReason: chosen.length > 1 ? `subject: PO ${po} (PO shared by ${chosen.length} buyers)` : `subject: PO ${po}`,
      });
    }
  }
  for (const inv of invoices) {
    for (const o of orders.filter((x) => x.invoiceNumber === inv)) {
      if (!links.has(o.id)) links.set(o.id, { orderId: o.id, matchStatus: "matched", matchMethod: "invoice_ref", matchReason: `subject: BK invoice ${inv}` });
    }
  }
  for (const id of input.threadOrderIds) {
    if (!links.has(id)) links.set(id, { orderId: id, matchStatus: "matched", matchMethod: "thread", matchReason: "reply in a thread already linked to this order" });
  }
  const result = [...links.values()];
  if (result.filter((l) => l.matchMethod !== "thread").length > 1) {
    for (const l of result) {
      l.matchStatus = "needs_review";
      l.matchReason += "; the subject names more than one order";
    }
  }
  return { links: result, poNumbersInSubject: pos };
}
