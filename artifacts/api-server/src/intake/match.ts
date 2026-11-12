import { poKey } from "./text";

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
  /** Extra PO keys to look for without a "PO" marker (e.g. the allowlist). Known orders' POs are always included. */
  watchPoKeys?: string[];
};
export type OrderLink = { orderId: string; matchStatus: "matched" | "needs_review"; matchMethod: "po_subject" | "invoice_ref" | "thread"; matchReason: string };
export type MatchResult = { links: OrderLink[]; poNumbersInSubject: string[] };

/**
 * PO numbers after a PO marker ("PO", "PO#", "P.O.", "PO No.", "Purchase Order #"),
 * in any format: "36572", "SR0912ABC", "AC-PO-9812", "4500123456789". The value
 * must contain a digit, so "PO for style" or "PO Box" never count. Returns
 * comparison keys (see poKey); "1234/1235" also yields each part.
 */
export function poNumbersIn(text: string): string[] {
  const found = new Set<string>();
  const re = /(?:^|[^A-Za-z0-9])(?:p\.?\s?o\.?|purchase\s+order)\s*(?:no\.?|num(?:ber)?\.?|#)?\s*[:#.\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/_.]{1,39})/gi;
  for (const m of text.matchAll(re)) {
    const token = m[1]!.replace(/[.\-_/]+$/, "");
    if (!/\d/.test(token)) continue;
    const key = poKey(token);
    if (key.length < 3) continue;
    found.add(key);
    if (token.includes("/")) for (const part of token.split("/")) if (/\d/.test(part) && poKey(part).length >= 3) found.add(poKey(part));
  }
  return [...found];
}

/**
 * A known PO written anywhere, with any spacing or punctuation and no "PO"
 * marker needed ("AC-PO-9812 trims", "ac po 9812"). Only for POs with letters
 * or at least 7 digits: a short all-digit PO without a marker could be a
 * quantity or a price.
 */
export function mentionsPo(text: string, key: string): boolean {
  if (key.length < 3 || (!/[A-Z]/.test(key) && key.length < 7)) return false;
  const pattern = key.split("").map((ch) => ch.replace(/[^A-Z0-9]/g, "\\$&")).join("[\\s\\-_./]*");
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "i").test(text);
}

/** PO keys in the text: marked ones in any format, plus watched POs mentioned without a marker. */
export function findPoKeys(text: string, watchKeys: Iterable<string> = []): string[] {
  const found = new Set(poNumbersIn(text));
  const watched = [...watchKeys].filter((key) => mentionsPo(text, key) || found.has(key));
  for (const key of watched) found.add(key);
  // Drop fragments of a watched PO ("-PO-9812" inside "AC-PO-9812" is not its own PO).
  return [...found].filter((k) => !watched.some((w) => w !== k && w.includes(k)));
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
  const watch = [...orders.map((o) => (o.poNumber ? poKey(o.poNumber) : "")).filter(Boolean), ...(input.watchPoKeys ?? [])];
  const pos = findPoKeys(subjects, watch);
  const invoices = invoiceNumbersIn(subjects);
  const senderDomain = input.fromAddress.split("@")[1] ?? "";
  const links = new Map<string, OrderLink>();

  for (const po of pos) {
    const candidates = orders.filter((o) => o.poNumber !== null && poKey(o.poNumber) === po);
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
