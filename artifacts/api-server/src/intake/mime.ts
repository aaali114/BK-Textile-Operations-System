import { simpleParser, type AddressObject } from "mailparser";

export type ParsedAttachment = { filename: string; contentType: string; content: Buffer; contentId: string | null; isInline: boolean };
export type ParsedEmail = {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: Date | null;
  /** Date used for "later email wins": the original sender's date when this is a manual forward. */
  effectiveDate: Date | null;
  /** Subjects of messages quoted as forwarded inside the body (manual "Fwd:" copies). */
  forwardedSubjects: string[];
  bodyText: string;
  forwardedVia: string | null;
  attachments: ParsedAttachment[];
};

const addresses = (a: AddressObject | AddressObject[] | undefined): string[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((o) => o.value.map((v) => v.address ?? "").filter(Boolean));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Dates as email programs print them in forwards:
 *   "Tue, 1 Sep 2026 17:43:11 +0500"            (Thunderbird, RFC 2822)
 *   "Tue, Sep 1, 2026 at 5:43 PM"               (Gmail)
 *   "Tuesday, September 1, 2026 5:43 PM"        (Outlook "Sent:")
 *   "1 September 2026 at 17:43:11 GMT+5"        (Apple Mail)
 *   "2026-09-01 17:43"                          (cPanel webmail)
 *   "01/09/2026 17:43"                          (day first, as used in Pakistan)
 * Times printed without a zone are taken as Pakistan time.
 */
export function parseLooseDate(text: string): Date | null {
  const parsed = parseLooseDateRaw(text);
  // Forwards from Gmail/Outlook print BK's local time with no zone: read it as Pakistan time (UTC+5, no DST).
  if (parsed && !/(?:[+-]\d{2}:?\d{2}\b|\bGMT\b|\bUTC\b|\b[A-Z]{3,4}T\b|Z$)/.test(text.trim())) return new Date(parsed.getTime() - 5 * 3600_000);
  return parsed;
}

function parseLooseDateRaw(text: string): Date | null {
  let t = text.replace(/\s+/g, " ").replace(/\bat\b/gi, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\bGMT\s*([+-])(\d{1,2})(?::?(\d{2}))?\b/i, (_m, sign, h, m) => `${sign}${String(h).padStart(2, "0")}${m ?? "00"}`);
  const numeric = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (numeric) {
    const [, d, mo, y, hh, mm, ss, ap] = numeric;
    let hour = Number(hh ?? 0);
    if (ap && /pm/i.test(ap) && hour < 12) hour += 12;
    if (ap && /am/i.test(ap) && hour === 12) hour = 0;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mm ?? 0), Number(ss ?? 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const direct = new Date(t);
  if (!Number.isNaN(direct.getTime())) return direct;
  // "1 September 2026 17:43:11 +0500" style that the built-in parser rejects
  const words = t.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*([+-]\d{4})?/i);
  if (words) {
    const [, d, mon, y, hh, mm, ss, ap, tz] = words;
    const mi = MONTHS.indexOf(mon!.slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    let hour = Number(hh);
    if (ap && /pm/i.test(ap) && hour < 12) hour += 12;
    if (ap && /am/i.test(ap) && hour === 12) hour = 0;
    const utc = Date.UTC(Number(y), mi, Number(d), hour, Number(mm), Number(ss ?? 0));
    const offset = tz ? (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) : 0;
    return new Date(utc - offset * 60000);
  }
  return null;
}

const MARKER = /^[ \t>]*(?:-{2,}\s*(?:Forwarded|Original)\s+[Mm]essage\s*-{2,}|Begin forwarded message:?|_{10,})\s*$/;
const HEADER = /^[ \t>]*\*{0,2}(From|Sent|Date|Subject|To|Cc|CC)\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/;

/**
 * Header blocks of messages forwarded inside the body, in the layouts of
 * Thunderbird, Gmail, Outlook, Apple Mail and cPanel webmail. Wrapped header
 * lines (a long subject) are joined. Returns the original subject and date.
 */
export function forwardedBlocks(body: string): { subject: string; date: Date | null }[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: { subject: string; date: Date | null }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const startsBlock = MARKER.test(lines[i]!);
    // Outlook may forward with no marker line: a From: header followed closely by Sent:
    const bareOutlook = !startsBlock && /^\s*\*{0,2}From\*{0,2}:/i.test(lines[i]!) && lines.slice(i + 1, i + 4).some((l) => /^\s*\*{0,2}Sent\*{0,2}:/i.test(l));
    if (!startsBlock && !bareOutlook) continue;
    const headers: Record<string, string> = {};
    let last: string | null = null;
    let j = startsBlock ? i + 1 : i;
    for (; j < Math.min(lines.length, i + 25); j++) {
      const line = lines[j]!;
      const h = line.match(HEADER);
      if (h) {
        last = h[1]!.toLowerCase();
        headers[last] = h[2]!.replace(/\*+$/, "").trim();
      } else if (!line.trim()) {
        if (Object.keys(headers).length >= 2) break;
      } else if (last && Object.keys(headers).length) {
        headers[last] += ` ${line.trim()}`; // wrapped header line
      }
    }
    if (headers.subject || headers.date || headers.sent) {
      out.push({ subject: (headers.subject ?? "").replace(/\s+/g, " ").trim(), date: parseLooseDate(headers.date ?? headers.sent ?? "") });
      i = j;
    }
  }
  return out;
}

/** The forwarded original's date, if it is plausible (not after the forward, not years before it). */
function originalDate(inner: Date | null, outer: Date | null): Date | null {
  if (!inner) return outer;
  if (!outer) return inner;
  const diff = outer.getTime() - inner.getTime();
  return diff >= -36 * 3600_000 && diff <= 3 * 365 * 86400_000 ? inner : outer;
}

export async function parseEml(raw: Buffer): Promise<ParsedEmail> {
  const m = await simpleParser(raw, { skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true });
  const from = m.from?.value[0];
  const refs = Array.isArray(m.references) ? m.references : m.references ? [m.references] : [];
  const bodyText = (m.text ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const blocks = forwardedBlocks(bodyText);
  const isManualForward = /^\s*(fwd?|fw):/i.test(m.subject ?? "") && blocks.length > 0;
  const deliveredTo = m.headers.get("x-forwarded-to") ?? m.headers.get("delivered-to");
  return {
    messageId: m.messageId ?? `<no-id-${Date.now()}@bk-intake>`,
    inReplyTo: m.inReplyTo ?? null,
    references: refs,
    fromAddress: (from?.address ?? "").toLowerCase(),
    fromName: from?.name || null,
    to: addresses(m.to),
    cc: addresses(m.cc),
    subject: (m.subject ?? "").trim(),
    sentAt: m.date ?? null,
    effectiveDate: originalDate(isManualForward ? blocks[0]!.date : null, m.date ?? null),
    forwardedSubjects: blocks.map((b) => b.subject).filter(Boolean),
    bodyText,
    forwardedVia: typeof deliveredTo === "string" ? deliveredTo : null,
    attachments: m.attachments.map((a) => ({
      filename: a.filename ?? "attachment",
      contentType: (a.contentType ?? "application/octet-stream").toLowerCase(),
      content: a.content,
      contentId: a.contentId ?? null,
      isInline: a.contentDisposition === "inline" && !!a.contentId,
    })),
  };
}
