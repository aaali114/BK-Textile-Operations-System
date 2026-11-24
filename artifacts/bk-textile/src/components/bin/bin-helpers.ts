import type { BinItem, RebuildReportCleared } from '@workspace/api-client-react';

export const REASON_MAX = 500;
export const EML_MAX_BYTES = 25 * 1024 * 1024;
export const BIN_CONFIRM_TEXT = 'Move to the Bin? You can restore it from the Bin.';
export const EMAIL_REMOVE_TEXT = 'Remove this email from the order? Details that came only from this email (sizes, trims, prices\u2026) will be removed and the order rebuilt from its other emails. Values typed in by hand are kept.';
export const APPROVED_DOC_WARNING = 'This is an approved document. It will be removed from the order but kept in the Bin.';
export const EML_HELP_TEXT = 'Save the email from your mail program as .eml (Gmail: \u22ee \u2192 Download message; Outlook on the web/Thunderbird/Apple Mail: drag the email to your desktop or Save As). Or simply forward it to orders@bktextile.com.';

/** Body for archive calls: omit blank reasons, reject over-long ones. */
export function archiveBody(reason: string): { reason?: string } {
  const r = reason.trim();
  return r ? { reason: r } : {};
}
export function reasonProblem(reason: string): string | null {
  return reason.trim().length > REASON_MAX ? `Keep the reason to ${REASON_MAX} characters or fewer.` : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Short summary of what an email removal / rebuild cleared, e.g. "Removed 5 trims". */
export function clearedSummary(cleared: RebuildReportCleared | null | undefined): string {
  if (!cleared) return 'Nothing else needed clearing.';
  const parts: string[] = [];
  if (cleared.lines) parts.push(plural(cleared.lines, 'PO line', 'PO lines'));
  if (cleared.colours) parts.push(plural(cleared.colours, 'colour', 'colours'));
  if (cleared.sizes) parts.push(plural(cleared.sizes, 'size quantity', 'size quantities'));
  if (cleared.trims) parts.push(plural(cleared.trims, 'trim', 'trims'));
  if (cleared.fabrics) parts.push(plural(cleared.fabrics, 'fabric', 'fabrics'));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const head = list ? `Removed ${list}.` : '';
  const header = cleared.header ? ' Order header details from that email were cleared.' : '';
  return (head + header).trim() || 'Nothing else needed clearing.';
}

/** Client-side check before reading an .eml file; the API remains the final judge. */
export function emlFileProblem(name: string, size: number): string | null {
  if (!/\.eml$/i.test(name.trim())) return 'Choose an .eml file. Save the email from your mail program as .eml first.';
  if (size <= 0) return 'This file is empty.';
  if (size > EML_MAX_BYTES) return 'This email is larger than 25 MB and cannot be added.';
  return null;
}
/** Strip the "data:...;base64," prefix from a FileReader data URL. */
export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function archivedBannerText(order: { archivedAt?: string | null; archivedBy?: string | null; archiveReason?: string | null }, formatDate: (v: string) => string): string {
  const when = order.archivedAt ? formatDate(order.archivedAt) : 'an unknown date';
  const reason = order.archiveReason?.trim() ? `: ${order.archiveReason.trim()}` : '';
  return `This order is in the Bin \u2014 deleted by ${order.archivedBy || 'unknown'} on ${when}${reason}`;
}

export function isFinalDocument(status: string) { return status === 'approved' || status === 'superseded'; }
/** Drafts and in-progress documents: merchandising Write. Approved / superseded: administrators only. */
export function canDeleteDocument(status: string, writable: boolean, role: string | undefined) {
  if (!writable) return false;
  return isFinalDocument(status) ? role === 'admin' : true;
}

export function sortBinNewestFirst<T extends Pick<BinItem, 'archivedAt'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (Date.parse(b.archivedAt) || 0) - (Date.parse(a.archivedAt) || 0));
}
/** The text a person must type to permanently delete an item. */
export function purgeConfirmTarget(item: Pick<BinItem, 'kind' | 'orderRef' | 'title'>) {
  return item.kind === 'order' ? item.orderRef : item.title;
}
export function purgeConfirmMatches(item: Pick<BinItem, 'kind' | 'orderRef' | 'title'>, typed: string) {
  return typed.trim() !== '' && typed.trim() === purgeConfirmTarget(item).trim();
}
export const BIN_KIND_LABELS: Record<BinItem['kind'], string> = { order: 'Order', file: 'Image / file', email: 'Email', document: 'Document' };
