import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import {
  activityTable,
  db,
  inspectionsTable,
  materialLotsTable,
  ordersTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
  workItemsTable,
} from "@workspace/db";
import { canSeeActivity, hasArea, type Access, type Area } from "./access";

export type Viz = "kpi" | "table" | "bar" | "line" | "pie";
export type Param =
  | { name: string; label: string; type: "enum"; options: { value: string; label: string }[]; default: string }
  | { name: string; label: string; type: "integer"; min: number; max: number; default: number };
export type Column = { key: string; label: string; type: "string" | "number" | "date" | "money" };
export type DataResult = {
  columns: Column[];
  rows: Record<string, string | number | null>[];
  /** For charts: the column holding labels and the column(s) holding values. */
  labelKey: string | null;
  valueKeys: string[];
  note: string | null;
  generatedAt: string;
};
type Params = Record<string, string | number>;
export type Source = {
  id: string;
  title: string;
  description: string;
  area: Area;
  visualizations: Viz[];
  defaultVisualization: Viz;
  params: Param[];
  run: (access: Access, p: Params) => Promise<Omit<DataResult, "generatedAt">>;
};

const OPEN_STATUSES = ["draft", "development", "in_production", "ready_to_ship"];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const dept = (access: Access, choice: string) => (choice === "mine" ? access.department : null);
const statusParam: Param = { name: "scope", label: "Orders", type: "enum", options: [{ value: "open", label: "Open orders" }, { value: "all", label: "All orders" }], default: "open" };
const deptParam: Param = { name: "department", label: "Department", type: "enum", options: [{ value: "all", label: "All departments" }, { value: "mine", label: "My department" }], default: "all" };
const limitParam = (d: number): Param => ({ name: "limit", label: "Rows", type: "integer", min: 1, max: 100, default: d });
const scopeWhere = (p: Params) => (p.scope === "all" ? undefined : inArray(ordersTable.status, OPEN_STATUSES));

export const SOURCES: Source[] = [
  {
    id: "orders.kpis",
    title: "Order KPIs",
    description: "Open orders, pieces, value and orders shipping in the next 30 days.",
    area: "merchandising",
    visualizations: ["kpi", "table"],
    defaultVisualization: "kpi",
    params: [],
    async run() {
      const [r] = await db
        .select({
          open: sql<number>`count(*)::int`,
          pieces: sql<number>`coalesce(sum(${ordersTable.quantity}), 0)::int`,
          value: sql<number>`coalesce(sum(${ordersTable.orderValue}), 0)::float`,
          due30: sql<number>`count(*) filter (where ${ordersTable.deliveryDate} <= ${plusDays(30)})::int`,
        })
        .from(ordersTable)
        .where(inArray(ordersTable.status, OPEN_STATUSES));
      return {
        columns: [{ key: "metric", label: "Metric", type: "string" }, { key: "value", label: "Value", type: "number" }],
        rows: [
          { metric: "Open orders", value: r!.open },
          { metric: "Pieces on open orders", value: r!.pieces },
          { metric: "Value of open orders", value: Math.round(r!.value * 100) / 100 },
          { metric: "Shipping in 30 days", value: r!.due30 },
        ],
        labelKey: "metric",
        valueKeys: ["value"],
        note: "Order values are summed as entered; mixed currencies are not converted.",
      };
    },
  },
  {
    id: "orders.by_status",
    title: "Orders by status",
    description: "How many orders are in each stage.",
    area: "merchandising",
    visualizations: ["bar", "pie", "table"],
    defaultVisualization: "bar",
    params: [],
    async run() {
      const rows = await db.select({ status: ordersTable.status, orders: sql<number>`count(*)::int` }).from(ordersTable).groupBy(ordersTable.status).orderBy(ordersTable.status);
      return { columns: [{ key: "status", label: "Status", type: "string" }, { key: "orders", label: "Orders", type: "number" }], rows, labelKey: "status", valueKeys: ["orders"], note: null };
    },
  },
  {
    id: "orders.by_buyer",
    title: "Orders by buyer",
    description: "Orders, pieces and value per buyer.",
    area: "merchandising",
    visualizations: ["bar", "pie", "table"],
    defaultVisualization: "bar",
    params: [statusParam],
    async run(_a, p) {
      const rows = await db
        .select({ buyer: ordersTable.buyer, orders: sql<number>`count(*)::int`, pieces: sql<number>`coalesce(sum(${ordersTable.quantity}),0)::int`, value: sql<number>`coalesce(sum(${ordersTable.orderValue}),0)::float` })
        .from(ordersTable)
        .where(scopeWhere(p))
        .groupBy(ordersTable.buyer)
        .orderBy(desc(sql`count(*)`));
      return {
        columns: [{ key: "buyer", label: "Buyer", type: "string" }, { key: "orders", label: "Orders", type: "number" }, { key: "pieces", label: "Pieces", type: "number" }, { key: "value", label: "Value", type: "money" }],
        rows, labelKey: "buyer", valueKeys: ["orders", "pieces"], note: null,
      };
    },
  },
  {
    id: "orders.ship_schedule",
    title: "Shipping schedule",
    description: "Orders and pieces by ship month.",
    area: "merchandising",
    visualizations: ["bar", "line", "table"],
    defaultVisualization: "bar",
    params: [{ name: "months", label: "Months ahead", type: "integer", min: 1, max: 24, default: 6 }],
    async run(_a, p) {
      const until = new Date(); until.setUTCMonth(until.getUTCMonth() + Number(p.months)); 
      const month = sql<string>`to_char(${ordersTable.deliveryDate}, 'YYYY-MM')`;
      const rows = await db
        .select({ month, orders: sql<number>`count(*)::int`, pieces: sql<number>`coalesce(sum(${ordersTable.quantity}),0)::int` })
        .from(ordersTable)
        .where(and(inArray(ordersTable.status, OPEN_STATUSES), gte(ordersTable.deliveryDate, today().slice(0, 7) + "-01"), lte(ordersTable.deliveryDate, until.toISOString().slice(0, 10))))
        .groupBy(month)
        .orderBy(month);
      return { columns: [{ key: "month", label: "Ship month", type: "string" }, { key: "orders", label: "Orders", type: "number" }, { key: "pieces", label: "Pieces", type: "number" }], rows, labelKey: "month", valueKeys: ["pieces", "orders"], note: null };
    },
  },
  {
    id: "orders.due_soon",
    title: "Orders shipping soon",
    description: "Open orders with a ship date in the coming days, earliest first.",
    area: "merchandising",
    visualizations: ["table"],
    defaultVisualization: "table",
    params: [{ name: "days", label: "Within days", type: "integer", min: 1, max: 180, default: 30 }, limitParam(15)],
    async run(_a, p) {
      const rows = await db
        .select({ invoice: sql<string>`coalesce(${ordersTable.invoiceRef}, ${ordersTable.reference})`, buyer: ordersTable.buyer, po: ordersTable.poNumber, style: ordersTable.style, pieces: ordersTable.quantity, shipDate: ordersTable.deliveryDate, status: ordersTable.status, orderId: ordersTable.id })
        .from(ordersTable)
        .where(and(inArray(ordersTable.status, OPEN_STATUSES), lte(ordersTable.deliveryDate, plusDays(Number(p.days)))))
        .orderBy(ordersTable.deliveryDate)
        .limit(Number(p.limit));
      return {
        columns: [{ key: "invoice", label: "BK invoice", type: "string" }, { key: "buyer", label: "Buyer", type: "string" }, { key: "po", label: "Buyer PO", type: "string" }, { key: "style", label: "Style", type: "string" }, { key: "pieces", label: "Pieces", type: "number" }, { key: "shipDate", label: "Ship date", type: "date" }, { key: "status", label: "Status", type: "string" }],
        rows, labelKey: null, valueKeys: [], note: null,
      };
    },
  },
  {
    id: "work.by_department",
    title: "Open work by department",
    description: "Open and overdue department tasks.",
    area: "department_work",
    visualizations: ["bar", "table"],
    defaultVisualization: "bar",
    params: [deptParam],
    async run(a, p) {
      const d = dept(a, String(p.department));
      if (p.department === "mine" && !d) return noDepartment();
      const rows = await db
        .select({ department: workItemsTable.department, open: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${workItemsTable.dueDate} < ${today()})::int` })
        .from(workItemsTable)
        .where(and(ne(workItemsTable.status, "completed"), d ? eq(workItemsTable.department, d) : undefined))
        .groupBy(workItemsTable.department)
        .orderBy(workItemsTable.department);
      return { columns: [{ key: "department", label: "Department", type: "string" }, { key: "open", label: "Open", type: "number" }, { key: "overdue", label: "Overdue", type: "number" }], rows, labelKey: "department", valueKeys: ["open", "overdue"], note: null };
    },
  },
  {
    id: "work.overdue",
    title: "Overdue tasks",
    description: "Department tasks past their due date.",
    area: "department_work",
    visualizations: ["table", "kpi"],
    defaultVisualization: "table",
    params: [deptParam, limitParam(20)],
    async run(a, p) {
      const d = dept(a, String(p.department));
      if (p.department === "mine" && !d) return noDepartment();
      const rows = await db
        .select({ task: workItemsTable.title, department: workItemsTable.department, order: sql<string>`coalesce(${ordersTable.invoiceRef}, ${ordersTable.reference})`, dueDate: workItemsTable.dueDate, status: workItemsTable.status, assignee: workItemsTable.assignee })
        .from(workItemsTable)
        .leftJoin(ordersTable, eq(ordersTable.id, workItemsTable.orderId))
        .where(and(ne(workItemsTable.status, "completed"), lt(workItemsTable.dueDate, today()), d ? eq(workItemsTable.department, d) : undefined))
        .orderBy(workItemsTable.dueDate)
        .limit(Number(p.limit));
      return {
        columns: [{ key: "task", label: "Task", type: "string" }, { key: "department", label: "Department", type: "string" }, { key: "order", label: "Order", type: "string" }, { key: "dueDate", label: "Due", type: "date" }, { key: "status", label: "Status", type: "string" }, { key: "assignee", label: "Assignee", type: "string" }],
        rows, labelKey: null, valueKeys: [], note: null,
      };
    },
  },
  {
    id: "materials.by_status",
    title: "Material lots by status",
    description: "Received lots by QC status.",
    area: "materials",
    visualizations: ["pie", "bar", "table"],
    defaultVisualization: "pie",
    params: [],
    async run() {
      const rows = await db.select({ status: materialLotsTable.status, lots: sql<number>`count(*)::int` }).from(materialLotsTable).groupBy(materialLotsTable.status).orderBy(materialLotsTable.status);
      return { columns: [{ key: "status", label: "Status", type: "string" }, { key: "lots", label: "Lots", type: "number" }], rows, labelKey: "status", valueKeys: ["lots"], note: null };
    },
  },
  {
    id: "materials.attention",
    title: "Lots on hold or awaiting QC",
    description: "Material lots that need attention.",
    area: "materials",
    visualizations: ["table", "kpi"],
    defaultVisualization: "table",
    params: [limitParam(20)],
    async run(_a, p) {
      const rows = await db
        .select({ lot: materialLotsTable.lotReference, material: materialLotsTable.material, supplier: materialLotsTable.supplier, quantity: materialLotsTable.quantity, unit: materialLotsTable.unit, status: materialLotsTable.status, received: materialLotsTable.receivedAt })
        .from(materialLotsTable)
        .where(inArray(materialLotsTable.status, ["hold", "pending_qc"]))
        .orderBy(materialLotsTable.receivedAt)
        .limit(Number(p.limit));
      return {
        columns: [{ key: "lot", label: "Lot", type: "string" }, { key: "material", label: "Material", type: "string" }, { key: "supplier", label: "Supplier", type: "string" }, { key: "quantity", label: "Qty", type: "number" }, { key: "unit", label: "Unit", type: "string" }, { key: "status", label: "Status", type: "string" }, { key: "received", label: "Received", type: "date" }],
        rows, labelKey: null, valueKeys: [], note: null,
      };
    },
  },
  {
    id: "quality.by_result",
    title: "Inspections by result",
    description: "Accepted, held and rejected inspections in a period.",
    area: "quality",
    visualizations: ["pie", "bar", "table"],
    defaultVisualization: "pie",
    params: [{ name: "days", label: "Last days", type: "integer", min: 1, max: 730, default: 90 }],
    async run(_a, p) {
      const since = new Date(Date.now() - Number(p.days) * 86400_000);
      const rows = await db.select({ result: inspectionsTable.result, inspections: sql<number>`count(*)::int`, defects: sql<number>`coalesce(sum(${inspectionsTable.defectCount}),0)::int` }).from(inspectionsTable).where(gte(inspectionsTable.inspectedAt, since)).groupBy(inspectionsTable.result).orderBy(inspectionsTable.result);
      return { columns: [{ key: "result", label: "Result", type: "string" }, { key: "inspections", label: "Inspections", type: "number" }, { key: "defects", label: "Defects", type: "number" }], rows, labelKey: "result", valueKeys: ["inspections"], note: null };
    },
  },
  {
    id: "emails.recent",
    title: "Recent order emails",
    description: "Latest emails read from the orders mailbox, with their order.",
    area: "merchandising",
    visualizations: ["table"],
    defaultVisualization: "table",
    params: [limitParam(10)],
    async run(_a, p) {
      const rows = await db
        .select({ received: sourceEmailsTable.receivedAt, subject: sourceEmailsTable.subject, from: sourceEmailsTable.fromAddress, order: sql<string>`coalesce(${ordersTable.invoiceRef}, ${ordersTable.reference})`, category: sourceEmailsTable.category, match: sourceEmailOrdersTable.matchStatus })
        .from(sourceEmailOrdersTable)
        .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
        .innerJoin(ordersTable, eq(ordersTable.id, sourceEmailOrdersTable.orderId))
        .orderBy(desc(sourceEmailsTable.receivedAt))
        .limit(Number(p.limit));
      return {
        columns: [{ key: "received", label: "Received", type: "date" }, { key: "subject", label: "Subject", type: "string" }, { key: "from", label: "From", type: "string" }, { key: "order", label: "Order", type: "string" }, { key: "category", label: "Category", type: "string" }, { key: "match", label: "Match", type: "string" }],
        rows: rows.map((r) => ({ ...r, received: r.received.toISOString() })), labelKey: null, valueKeys: [], note: null,
      };
    },
  },
  {
    id: "activity.recent",
    title: "Recent activity",
    description: "Latest changes you are allowed to see.",
    area: "dashboard",
    visualizations: ["table"],
    defaultVisualization: "table",
    params: [limitParam(10)],
    async run(a, p) {
      const rows = await db.select().from(activityTable).orderBy(desc(activityTable.occurredAt)).limit(300);
      return {
        columns: [{ key: "when", label: "When", type: "date" }, { key: "who", label: "By", type: "string" }, { key: "what", label: "What", type: "string" }],
        rows: rows.filter((r) => canSeeActivity(a, r.entityType)).slice(0, Number(p.limit)).map((r) => ({ when: r.occurredAt.toISOString(), who: r.actor, what: r.description })),
        labelKey: null, valueKeys: [], note: null,
      };
    },
  },
];

function noDepartment(): Omit<DataResult, "generatedAt"> {
  return { columns: [], rows: [], labelKey: null, valueKeys: [], note: "No department is set on your account; ask an administrator, or choose All departments." };
}

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id) ?? null;
export const canUseSource = (a: Access, s: Source) => a.status === "active" && hasArea(a, s.area, "read");

/** Fills defaults and validates params against the source's definitions. Returns an error message or the params. */
export function resolveParams(s: Source, input: Record<string, unknown> = {}): Params | string {
  const out: Params = {};
  for (const p of s.params) {
    const v = input[p.name];
    if (v === undefined || v === null || v === "") {
      out[p.name] = p.default;
    } else if (p.type === "enum") {
      if (typeof v !== "string" || !p.options.some((o) => o.value === v)) return `${p.label}: choose one of ${p.options.map((o) => o.value).join(", ")}.`;
      out[p.name] = v;
    } else {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < p.min || n > p.max) return `${p.label}: a whole number from ${p.min} to ${p.max}.`;
      out[p.name] = n;
    }
  }
  const unknown = Object.keys(input).filter((k) => !s.params.some((p) => p.name === k));
  if (unknown.length) return `Unknown option(s): ${unknown.join(", ")}.`;
  return out;
}

export async function runSource(a: Access, s: Source, params: Params): Promise<DataResult> {
  return { ...(await s.run(a, params)), generatedAt: new Date().toISOString() };
}
