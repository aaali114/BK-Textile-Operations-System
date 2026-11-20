import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { activityTable, dashboardsTable, db } from "@workspace/db";
import type { Access } from "./access";
import { canUseSource, resolveParams, sourceById, type Viz } from "./dashboardSources";

export const DEPARTMENTS = [
  "merchandising", "fabrication", "sampling", "accessories", "greige_warehouse", "dyed_warehouse", "cutting",
  "embellishment", "stitching", "washing", "finishing", "packing", "export", "accounts", "admin",
] as const;
export const EVERYONE = "*";
const MAX_WIDGETS = 30;
const MAX_DASHBOARDS = 10;
const GRID_COLUMNS = 12;

export class DashboardError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

export type Widget = { id: string; source: string; viz: Viz; title: string | null; params: Record<string, string | number>; x: number; y: number; w: number; h: number };
export type Layout = { widgets: Widget[] };

/** The starting layout when no department or organisation template exists. */
export const BUILTIN_LAYOUT: Layout = {
  widgets: [
    { id: "kpis", source: "orders.kpis", viz: "kpi", title: null, params: {}, x: 0, y: 0, w: 12, h: 2 },
    { id: "status", source: "orders.by_status", viz: "bar", title: null, params: {}, x: 0, y: 2, w: 6, h: 4 },
    { id: "ship", source: "orders.ship_schedule", viz: "bar", title: null, params: { months: 6 }, x: 6, y: 2, w: 6, h: 4 },
    { id: "work", source: "work.by_department", viz: "bar", title: null, params: { department: "all" }, x: 0, y: 6, w: 6, h: 4 },
    { id: "lots", source: "materials.by_status", viz: "pie", title: null, params: {}, x: 6, y: 6, w: 6, h: 4 },
    { id: "activity", source: "activity.recent", viz: "table", title: null, params: { limit: 10 }, x: 0, y: 10, w: 12, h: 4 },
  ],
};

/** Validates and normalises a layout. With a user, every source must be one they can read. */
export function validateLayout(input: unknown, user: Access | null): Layout {
  const widgets = (input as { widgets?: unknown })?.widgets;
  if (!Array.isArray(widgets)) throw new DashboardError(400, "The layout needs a list of widgets.");
  if (widgets.length > MAX_WIDGETS) throw new DashboardError(400, `A dashboard can hold at most ${MAX_WIDGETS} widgets.`);
  const ids = new Set<string>();
  return {
    widgets: widgets.map((raw, i) => {
      const w = raw as Record<string, unknown>;
      const where = `Widget ${i + 1}`;
      const id = typeof w.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(w.id) ? w.id : null;
      if (!id || ids.has(id)) throw new DashboardError(400, `${where}: needs a unique id (letters, digits, - or _).`);
      ids.add(id);
      const source = typeof w.source === "string" ? sourceById(w.source) : null;
      if (!source) throw new DashboardError(400, `${where}: unknown data source "${String(w.source)}".`);
      if (user && !canUseSource(user, source)) throw new DashboardError(403, `${where}: you do not have access to "${source.title}".`);
      if (!source.visualizations.includes(w.viz as Viz)) throw new DashboardError(400, `${where}: "${source.title}" can be shown as ${source.visualizations.join(", ")}.`);
      const params = resolveParams(source, (w.params ?? {}) as Record<string, unknown>);
      if (typeof params === "string") throw new DashboardError(400, `${where}: ${params}`);
      const n = (k: string, min: number, max: number) => {
        const v = w[k];
        if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new DashboardError(400, `${where}: ${k} must be a whole number from ${min} to ${max}.`);
        return v;
      };
      const x = n("x", 0, GRID_COLUMNS - 1), y = n("y", 0, 500), wd = n("w", 1, GRID_COLUMNS), h = n("h", 1, 20);
      if (x + wd > GRID_COLUMNS) throw new DashboardError(400, `${where}: does not fit the ${GRID_COLUMNS}-column grid (x + w > ${GRID_COLUMNS}).`);
      const title = typeof w.title === "string" && w.title.trim() ? w.title.trim().slice(0, 80) : null;
      return { id, source: source.id, viz: w.viz as Viz, title, params, x, y, w: wd, h };
    }),
  };
}

const view = (row: typeof dashboardsTable.$inferSelect, a: Access, scope: "user" | "department" | "builtin") => {
  const layout = row.layout as Layout;
  const widgets = layout.widgets.map((w) => {
    const s = sourceById(w.source);
    return { ...w, accessible: !!s && canUseSource(a, s) };
  });
  return {
    id: scope === "builtin" ? null : row.id,
    scope,
    name: row.name,
    department: row.department,
    isDefault: row.isDefault,
    // Templates only show what this person may see; their own dashboards keep revoked widgets, marked.
    layout: { widgets: scope === "user" ? widgets : widgets.filter((w) => w.accessible) },
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
};

async function templateFor(a: Access) {
  const rows = await db.select().from(dashboardsTable).where(isNotNull(dashboardsTable.department));
  return (a.department ? rows.find((r) => r.department === a.department) : undefined) ?? rows.find((r) => r.department === EVERYONE) ?? null;
}

/** The user's dashboards, and the template that applies to them (department, else organisation-wide, else built-in). */
export async function listDashboards(a: Access) {
  const mine = await db.select().from(dashboardsTable).where(eq(dashboardsTable.ownerUserId, a.userId)).orderBy(asc(dashboardsTable.createdAt));
  const t = await templateFor(a);
  const template = t
    ? view(t, a, "department")
    : view({ id: "", ownerUserId: null, department: null, name: "Standard dashboard", isDefault: false, layout: BUILTIN_LAYOUT, updatedBy: null, createdAt: new Date(0), updatedAt: new Date(0) }, a, "builtin");
  return { dashboards: mine.map((r) => view(r, a, "user")), template };
}

export async function createDashboard(a: Access, input: { name: string; layout: unknown; isDefault?: boolean }) {
  const layout = validateLayout(input.layout, a);
  const [{ value: existing }] = await db.select({ value: count() }).from(dashboardsTable).where(eq(dashboardsTable.ownerUserId, a.userId));
  if (existing >= MAX_DASHBOARDS) throw new DashboardError(409, `You can keep up to ${MAX_DASHBOARDS} dashboards; delete one first.`);
  const row = await db.transaction(async (tx) => {
    const makeDefault = input.isDefault || existing === 0;
    if (makeDefault) await tx.update(dashboardsTable).set({ isDefault: false }).where(eq(dashboardsTable.ownerUserId, a.userId));
    const [r] = await tx.insert(dashboardsTable).values({ ownerUserId: a.userId, name: input.name.trim().slice(0, 80), isDefault: makeDefault, layout, updatedBy: a.userId }).returning();
    return r!;
  });
  return view(row, a, "user");
}

async function own(a: Access, id: string) {
  const [r] = await db.select().from(dashboardsTable).where(and(eq(dashboardsTable.id, id), eq(dashboardsTable.ownerUserId, a.userId)));
  if (!r) throw new DashboardError(404, "Dashboard not found.");
  return r;
}

export async function updateDashboard(a: Access, id: string, input: { name?: string; layout?: unknown; isDefault?: boolean }) {
  await own(a, id);
  const layout = input.layout !== undefined ? validateLayout(input.layout, a) : undefined;
  const row = await db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(dashboardsTable).set({ isDefault: false }).where(eq(dashboardsTable.ownerUserId, a.userId));
    const [r] = await tx
      .update(dashboardsTable)
      .set({ ...(input.name ? { name: input.name.trim().slice(0, 80) } : {}), ...(layout ? { layout } : {}), ...(input.isDefault ? { isDefault: true } : {}), updatedBy: a.userId })
      .where(eq(dashboardsTable.id, id))
      .returning();
    return r!;
  });
  return view(row, a, "user");
}

export async function deleteDashboard(a: Access, id: string) {
  const r = await own(a, id);
  await db.delete(dashboardsTable).where(eq(dashboardsTable.id, id));
  if (r.isDefault) {
    const [next] = await db.select().from(dashboardsTable).where(eq(dashboardsTable.ownerUserId, a.userId)).orderBy(asc(dashboardsTable.createdAt)).limit(1);
    if (next) await db.update(dashboardsTable).set({ isDefault: true }).where(eq(dashboardsTable.id, next.id));
  }
}

// ---- department templates (administrators and deputies)

export async function listTemplates(a: Access) {
  const rows = await db.select().from(dashboardsTable).where(isNotNull(dashboardsTable.department)).orderBy(asc(dashboardsTable.department));
  return rows.map((r) => ({ ...view(r, { ...a, canManageUsers: true }, "department"), layout: { widgets: (r.layout as Layout).widgets.map((w) => ({ ...w, accessible: true })) } }));
}

function checkDepartment(d: string) {
  if (d !== EVERYONE && !(DEPARTMENTS as readonly string[]).includes(d)) throw new DashboardError(400, `Unknown department "${d}". Use one of ${DEPARTMENTS.join(", ")}, or * for everyone.`);
}

export async function saveTemplate(a: Access, department: string, input: { name: string; layout: unknown }) {
  checkDepartment(department);
  const layout = validateLayout(input.layout, null);
  const [r] = await db
    .insert(dashboardsTable)
    .values({ department, name: input.name.trim().slice(0, 80), layout, updatedBy: a.userId })
    .onConflictDoUpdate({ target: dashboardsTable.department, targetWhere: isNotNull(dashboardsTable.department), set: { name: input.name.trim().slice(0, 80), layout, updatedBy: a.userId, updatedAt: new Date() } })
    .returning();
  await db.insert(activityTable).values({
    actor: a.name || a.email || a.userId, actorId: a.userId, source: "staff", action: "dashboard.template_saved",
    description: `Dashboard template for ${department === EVERYONE ? "everyone" : department} saved (${layout.widgets.length} widgets)`,
    entityType: "dashboard", entityId: department, details: { department, widgets: layout.widgets.map((w) => w.source) },
  });
  return { ...view(r!, { ...a, canManageUsers: true }, "department"), layout: { widgets: layout.widgets.map((w) => ({ ...w, accessible: true })) } };
}

export async function deleteTemplate(a: Access, department: string) {
  checkDepartment(department);
  const deleted = await db.delete(dashboardsTable).where(eq(dashboardsTable.department, department)).returning({ id: dashboardsTable.id });
  if (!deleted.length) throw new DashboardError(404, "No template for that department.");
}
