import type {
  Dashboard, DashboardDataColumnsItemType, DashboardList, DashboardSource, DashboardSourceParam, DashboardWidget, Visualization,
} from '@workspace/api-client-react';

/** Pure dashboard helpers: no React, no network. Safe to unit test directly. */

export const GRID_COLS = 12;
export const MAX_WIDGETS = 30;
export const MAX_DASHBOARDS = 10;
export const MAX_H = 20;
export const TITLE_MAX = 80;
export const POLL_MS = 180_000;
export const TEMPLATE_KEY = '__template__';
export const EVERYONE = '*';

export const DEPARTMENTS = [
  'merchandising', 'fabrication', 'sampling', 'accessories', 'greige_warehouse', 'dyed_warehouse', 'cutting',
  'embellishment', 'stitching', 'washing', 'finishing', 'packing', 'export', 'accounts', 'admin',
] as const;

export const VIZ_LABEL: Record<Visualization, string> = {
  kpi: 'Key figures', table: 'Table', bar: 'Bar chart', line: 'Line chart', pie: 'Pie chart',
};

export function departmentLabel(department: string | null | undefined): string {
  if (!department || department === EVERYONE) return 'Everyone';
  const text = department.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function newWidgetId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Order-independent params signature, used to remount widget data when params change. */
export function stableParams(params?: Record<string, unknown> | null): string {
  if (!params) return '[]';
  return JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
}

export function widgetDataKey(w: Pick<DashboardWidget, 'source' | 'params' | 'accessible'>): string {
  return `${w.source}|${stableParams(w.params)}|${w.accessible === false ? 'denied' : 'ok'}`;
}

/** What a widget body should show before any data call. */
export type WidgetAccess = 'denied' | 'unknown-source' | 'fetch';
export function widgetAccess(w: Pick<DashboardWidget, 'source' | 'accessible'>, sources: DashboardSource[] | undefined): WidgetAccess {
  if (w.accessible === false) return 'denied';
  if (sources && !sources.some((s) => s.id === w.source)) return 'unknown-source';
  return 'fetch';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Strips server-only fields (accessible), trims/limits titles, and clamps geometry to the 12-column grid. */
export function sanitizeWidgets(widgets: readonly DashboardWidget[]): DashboardWidget[] {
  return widgets.slice(0, MAX_WIDGETS).map((w) => {
    const width = clampInt(w.w, 1, GRID_COLS, 4);
    const out: DashboardWidget = {
      id: w.id, source: w.source, viz: w.viz,
      x: clampInt(w.x, 0, GRID_COLS - width, 0),
      y: clampInt(w.y, 0, 10_000, 0),
      w: width,
      h: clampInt(w.h, 1, MAX_H, 6),
    };
    const title = typeof w.title === 'string' ? w.title.trim().slice(0, TITLE_MAX) : '';
    if (title) out.title = title;
    if (w.params && Object.keys(w.params).length) out.params = { ...w.params };
    return out;
  });
}

export function layoutSignature(name: string, widgets: readonly DashboardWidget[]): string {
  return JSON.stringify([name.trim(), sanitizeWidgets(widgets)]);
}

export function defaultSize(viz: Visualization): { w: number; h: number } {
  if (viz === 'kpi') return { w: 3, h: 4 };
  if (viz === 'table') return { w: 6, h: 8 };
  if (viz === 'pie') return { w: 4, h: 7 };
  return { w: 6, h: 7 };
}

export function nextRow(widgets: readonly DashboardWidget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

/** Selection: explicit key if it still exists, else the user's default, else the applicable template. */
export function resolveSelection(list: DashboardList | undefined, selected: string | null): string {
  const dashboards = list?.dashboards ?? [];
  if (selected === TEMPLATE_KEY) return TEMPLATE_KEY;
  if (selected && dashboards.some((d) => d.id === selected)) return selected;
  return dashboards.find((d) => d.isDefault)?.id ?? TEMPLATE_KEY;
}

export function findTemplate(templates: readonly Dashboard[] | undefined, department: string): Dashboard | undefined {
  return templates?.find((t) => (department === EVERYONE ? t.department === EVERYONE || t.department === null : t.department === department));
}

export function copyName(name: string): string {
  return `Copy of ${name}`.slice(0, TITLE_MAX);
}

/* ---------- values & formatting ---------- */

/** Strict numeric read: missing, blank and non-numeric values become null, never 0. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatCell(value: unknown, type: DashboardDataColumnsItemType, row?: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') {
    const n = toNumber(value);
    if (n === null) return String(value);
    const currency = typeof row?.currency === 'string' ? `${row.currency} ` : '';
    return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (type === 'number') {
    const n = toNumber(value);
    return n === null ? String(value) : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (type === 'date') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (typeof value === 'object') { try { return JSON.stringify(value); } catch { return String(value); } }
  return String(value);
}

/* ---------- params ---------- */

export function initialParamText(source: DashboardSource, existing?: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of source.params) {
    const v = existing?.[p.name];
    out[p.name] = v === undefined || v === null ? String(p.default) : String(v);
  }
  return out;
}

export function paramError(p: DashboardSourceParam, text: string): string | null {
  if (p.type === 'integer') {
    const n = Number(text);
    if (text.trim() === '' || !Number.isInteger(n)) return 'Enter a whole number.';
    if (p.min != null && n < p.min) return `Must be ${p.min} or more.`;
    if (p.max != null && n > p.max) return `Must be ${p.max} or less.`;
    return null;
  }
  return p.options?.some((o) => o.value === text) ? null : 'Choose one of the options.';
}

export function paramsFromText(source: DashboardSource, text: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of source.params) out[p.name] = p.type === 'integer' ? Number(text[p.name]) : text[p.name];
  return out;
}
