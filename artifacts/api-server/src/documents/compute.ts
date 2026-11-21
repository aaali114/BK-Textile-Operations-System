import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, fabricsTable, ordersTable, settingsTable } from "@workspace/db";
import { getOrderBreakdown } from "../lib/orderDetail";

export const DOCUMENT_TYPES = ["cutting_program", "packing_list"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const TEMPLATE_VERSION: Record<DocumentType, string> = { cutting_program: "cutting_program/1", packing_list: "packing_list/1" };
export const TYPE_TITLE: Record<DocumentType, string> = { cutting_program: "Cutting program", packing_list: "Packing list" };

export type CompanyProfile = { name: string; taglineLines: string[]; address: string };
export const DEFAULT_COMPANY: CompanyProfile = { name: "B.K. TEXTILE", taglineLines: [], address: "" };

/** Editable while the document is not approved. */
export type DocumentSettings = {
  allowancePct: number;
  pcsPerCarton: number | null;
  previousReference: string | null;
  remarks: string | null;
  /** Per priced line (finish): text overrides. */
  sections: Record<string, { description?: string | null; quality?: string | null }>;
};

export type CuttingRow = { style: string; colour: string; size: string; actual: number; plus: number; total: number };
export type PackingRow = { cartonFrom: number; cartonTo: number; po: string; style: string; colour: string; size: string; actualQty: number | null; cartons: number; perCarton: number; totalPcs: number };
export type Section = {
  lineId: string;
  finish: string;
  styleNumber: string;
  lineQty: number;
  descriptionLines: string[];
  quality: string | null;
  sizes: string[];
  cuttingRows: CuttingRow[];
  packingRows: PackingRow[];
  totals: { actual: number; plus: number; total: number; cartons: number; dozens: number };
};
export type DocumentData = {
  type: DocumentType;
  docNumber: string;
  company: CompanyProfile;
  order: { id: string; poNumber: string | null; buyer: string; style: string; invoiceRef: string | null };
  allowancePct: number;
  pcsPerCarton: number | null;
  previousReference: string | null;
  remarks: string | null;
  sections: Section[];
  /** Blocking problems: the document cannot be submitted while any exist. */
  problems: string[];
};

/**
 * quantity + pct%, rounded to whole pieces, halves up (170 + 5% = 178.5 -> 179),
 * in exact integer arithmetic (pct has at most 2 decimals), so floating-point
 * error can never turn 178.5 into 178.4999.
 */
export function withAllowance(quantity: number, pct: number): number {
  const basisPoints = Math.round((100 + pct) * 100); // 105% -> 10500
  return Math.floor((quantity * basisPoints + 5000) / 10000);
}

export async function companyProfile(): Promise<CompanyProfile> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "company_profile"));
  return { ...DEFAULT_COMPANY, ...((row?.value as Partial<CompanyProfile>) ?? {}) };
}

export async function defaultSettings(orderId: string): Promise<DocumentSettings> {
  const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return { allowancePct: 5, pcsPerCarton: o?.pcsPerCarton ?? null, previousReference: o?.previousOrderReference ?? null, remarks: null, sections: {} };
}

/** Builds the document from the order's current data. Pure arithmetic, no rounding surprises: totals are whole pieces. */
export async function computeDocument(orderId: string, type: DocumentType, settings: DocumentSettings): Promise<{ data: DocumentData; sourceHash: string }> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new Error("Order not found");
  const breakdown = (await getOrderBreakdown(orderId))!;
  const [fabric] = await db.select().from(fabricsTable).where(and(eq(fabricsTable.orderId, orderId), eq(fabricsTable.placement, "body"), isNull(fabricsTable.colourwayId)));
  const company = await companyProfile();
  const pct = settings.allowancePct;
  const perCarton = settings.pcsPerCarton ?? order.pcsPerCarton ?? null;
  const problems: string[] = [];
  if (!company.name.trim()) problems.push("Company name is empty (Company profile).");
  if (!breakdown.lines.length) problems.push("The order has no priced lines yet.");
  if (type === "packing_list" && !perCarton) problems.push("Pieces per carton is not set (from the PO, the order, or this draft).");

  const sections: Section[] = breakdown.lines.map((line) => {
    const over = settings.sections[line.id] ?? {};
    const defaultDescription =
      type === "cutting_program"
        ? [`${fabric?.description ?? "Fabric not recorded"} (${line.description})`]
        : [[fabric?.composition, fabric?.construction, line.description].filter(Boolean).join(" ").toUpperCase(), order.garmentDescription ?? ""].filter(Boolean);
    const sizes = breakdown.sizeLabels.filter((s) => line.colourways.some((c) => c.sizes.some((q) => q.sizeLabel === s)));
    const cuttingRows: CuttingRow[] = [];
    const packingRows: PackingRow[] = [];
    let carton = 1;
    for (const c of line.colourways) {
      for (const size of sizes) {
        const q = c.sizes.find((x) => x.sizeLabel === size);
        if (!q) continue;
        const total = withAllowance(q.quantity, pct);
        cuttingRows.push({ style: line.styleNumber, colour: c.name, size, actual: q.quantity, plus: total - q.quantity, total });
        if (perCarton) {
          const full = Math.floor(total / perCarton);
          const rest = total - full * perCarton;
          if (full > 0) {
            packingRows.push({ cartonFrom: carton, cartonTo: carton + full - 1, po: order.poNumber ?? "", style: line.styleNumber, colour: c.name, size, actualQty: q.quantity, cartons: full, perCarton, totalPcs: full * perCarton });
            carton += full;
          }
          if (rest > 0) {
            packingRows.push({ cartonFrom: carton, cartonTo: carton, po: order.poNumber ?? "", style: line.styleNumber, colour: c.name, size, actualQty: full > 0 ? null : q.quantity, cartons: 1, perCarton: rest, totalPcs: rest });
            carton += 1;
          }
        }
      }
    }
    const actual = cuttingRows.reduce((s, r) => s + r.actual, 0);
    const total = cuttingRows.reduce((s, r) => s + r.total, 0);
    const cartons = packingRows.reduce((s, r) => s + r.cartons, 0);
    return {
      lineId: line.id,
      finish: line.description,
      styleNumber: line.styleNumber,
      lineQty: line.quantity,
      descriptionLines: over.description ? over.description.split("\n").map((l) => l.trim()).filter(Boolean) : defaultDescription,
      quality: over.quality ?? (fabric?.gsm ? `${fabric.gsm} GSM${fabric.construction ? ` (${fabric.construction})` : ""}` : null),
      sizes,
      cuttingRows,
      packingRows: type === "packing_list" ? packingRows : [],
      totals: { actual, plus: total - actual, total, cartons: type === "packing_list" ? cartons : 0, dozens: Math.round((total / 12) * 100) / 100 },
    };
  });

  const data: DocumentData = {
    type,
    docNumber: order.invoiceRef ?? order.reference,
    company,
    order: { id: order.id, poNumber: order.poNumber, buyer: order.buyer, style: order.style, invoiceRef: order.invoiceRef },
    allowancePct: pct,
    pcsPerCarton: perCarton,
    previousReference: settings.previousReference,
    remarks: settings.remarks,
    sections,
    problems,
  };
  const sourceHash = createHash("sha256")
    .update(JSON.stringify({ type, order: { po: order.poNumber, buyer: order.buyer, inv: order.invoiceRef, ppc: order.pcsPerCarton, gd: order.garmentDescription }, breakdown: breakdown.lines, fabric: fabric ?? null, company, settings }))
    .digest("hex");
  return { data, sourceHash };
}
