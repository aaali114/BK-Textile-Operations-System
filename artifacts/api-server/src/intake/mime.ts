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

/** "-------- Forwarded Message --------" blocks: their Subject and Date lines (subject may wrap). */
export function forwardedBlocks(body: string): { subject: string; date: Date | null }[] {
  const out: { subject: string; date: Date | null }[] = [];
  const re = /-{2,}\s*Forwarded [Mm]essage\s*-{2,}([\s\S]{0,1500})/g;
  for (const m of body.matchAll(re)) {
    const block = m[1] ?? "";
    const subject = block.match(/Subject:\s*([\s\S]*?)\n\s*(?:Date|From|To|CC|Cc):/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const dateText = block.match(/Date:\s*([^\n]+)/)?.[1]?.trim();
    const date = dateText ? new Date(dateText) : null;
    out.push({ subject, date: date && !Number.isNaN(date.getTime()) ? date : null });
  }
  return out;
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
    effectiveDate: (isManualForward ? blocks[0]!.date : null) ?? m.date ?? null,
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
