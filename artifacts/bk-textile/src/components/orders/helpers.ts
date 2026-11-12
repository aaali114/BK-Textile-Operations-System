import type { QueryClient } from '@tanstack/react-query';
import {
  getGetDashboardSummaryQueryKey, getGetOrderActivityQueryKey, getGetOrderBreakdownQueryKey, getGetOrderEmailQueryKey,
  getGetOrderEmailsQueryKey, getGetOrderFabricsQueryKey, getGetOrderQueryKey, getGetOrdersQueryKey, getGetOrderTrimsQueryKey,
} from '@workspace/api-client-react';
import type { Order } from '@workspace/api-client-react';

/** Reads status + server message from an ApiError without depending on its class export. */
export function apiErrorInfo(error: unknown): { status: number | null; message: string } {
  const e = error as { status?: unknown; data?: unknown; message?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : null;
  let server: string | undefined;
  if (e?.data && typeof e.data === 'object') {
    const d = e.data as Record<string, unknown>;
    const v = d.error ?? d.message ?? d.detail;
    if (typeof v === 'string' && v.trim()) server = v.trim();
  } else if (typeof e?.data === 'string' && e.data.trim()) server = e.data.trim();
  const fallback = typeof e?.message === 'string' && e.message ? e.message : 'Something went wrong. Please try again.';
  return { status, message: server ?? fallback };
}

export function orderSaveErrorText(error: unknown) {
  const { status, message } = apiErrorInfo(error);
  if (status === 409) return `Duplicate PO (409): ${message}`;
  if (status === 400) return `Order not accepted (400): ${message}`;
  return message;
}

/** BK invoice label; legacy TEST- orders without an invoiceRef fall back to their reference. */
export function invoiceDisplay(order: Pick<Order, 'invoiceRef' | 'reference'>) {
  if (order.invoiceRef) return { value: order.invoiceRef, legacy: false };
  return { value: order.reference, legacy: true };
}

export function moneyText(value: number | null | undefined, currency?: string | null) {
  if (value == null) return null;
  return `${currency || ''} ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export function dateTimeText(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function humanize(value: string) { return value.replaceAll('_', ' '); }

/** Display a changed value without collapsing false / 0 / null into blanks. */
export function changeValueText(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'not set';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

export type FieldChange = { field: string; from: unknown; to: unknown };
export function readChanges(details: unknown): FieldChange[] {
  if (!details || typeof details !== 'object') return [];
  const raw = (details as Record<string, unknown>).changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ field: typeof c.field === 'string' ? c.field : 'field', from: c.from, to: c.to }));
}

export function validInvoiceInput(numberText: string, reason: string): string | null {
  const n = Number(numberText);
  if (!numberText.trim() || !Number.isInteger(n) || n < 1) return 'Enter a whole number of 1 or more.';
  const r = reason.trim();
  if (r.length < 3 || r.length > 500) return 'Give a reason between 3 and 500 characters.';
  return null;
}

export function refreshOrderCore(client: QueryClient, orderId: string) {
  void client.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
  void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  void client.invalidateQueries({ queryKey: getGetOrderActivityQueryKey(orderId) });
}

export function refreshAfterEmailReview(client: QueryClient, orderId: string, emailId: string) {
  refreshOrderCore(client, orderId);
  void client.invalidateQueries({ queryKey: getGetOrderEmailsQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getGetOrderEmailQueryKey(orderId, emailId) });
  void client.invalidateQueries({ queryKey: getGetOrderBreakdownQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getGetOrderFabricsQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getGetOrderTrimsQueryKey(orderId) });
}
