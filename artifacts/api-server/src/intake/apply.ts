import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  activityTable,
  colourwaysTable,
  db,
  fabricsTable,
  orderLinesTable,
  ordersTable,
  sizeQuantitiesTable,
  sourceEmailOrdersTable,
  sourceEmailsTable,
  trimsTable,
} from "@workspace/db";
import { mergePoSheets, type PoSheetData } from "./poSheet";
import { trimLabel, trimType, type TrimRow } from "./trimsSheet";
import { norm, poKey } from "./text";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Change = { field: string; from: unknown; to: unknown };
export type ApplyContext = { orderId: string; emailId: string; attachmentId: string; emailDate: Date; currencyHint: string | null };
export type ApplyResult = { changes: Change[]; warnings: string[]; skipped: string | null };

/** Later email wins: true when `existingEmailId` is empty (staff/none) or not newer than this email. */
async function laterWins(tx: Tx, existingEmailId: string | null, ctx: ApplyContext, cache: Map<string, Date | null>): Promise<boolean> {
  if (!existingEmailId || existingEmailId === ctx.emailId) return true;
  if (!cache.has(existingEmailId)) {
    const [row] = await tx
      .select({ sentAt: sourceEmailsTable.sentAt, receivedAt: sourceEmailsTable.receivedAt })
      .from(sourceEmailsTable)
      .where(eq(sourceEmailsTable.id, existingEmailId));
    cache.set(existingEmailId, row ? (row.sentAt ?? row.receivedAt) : null);
  }
  const existing = cache.get(existingEmailId);
  return !existing || existing.getTime() <= ctx.emailDate.getTime();
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);

function diff(prefix: string, before: Record<string, unknown>, after: Record<string, unknown>, changes: Change[]) {
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    if (!same(before[k], v)) changes.push({ field: `${prefix}${k}`, from: before[k] ?? null, to: v });
  }
}

const source = (ctx: ApplyContext) => ({ sourceEmailId: ctx.emailId, sourceAttachmentId: ctx.attachmentId });

export async function applyPoSheet(tx: Tx, ctx: ApplyContext, po: PoSheetData): Promise<ApplyResult> {
  const changes: Change[] = [];
  const warnings = [...po.warnings];
  const cache = new Map<string, Date | null>();
  const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, ctx.orderId)).for("update");
  if (!order) return { changes, warnings, skipped: "order not found" };
  if (!order.poNumber || poKey(order.poNumber) !== poKey(po.poNumber)) {
    return { changes, warnings, skipped: `PO sheet is for PO ${po.poNumber}, not this order's PO ${order.poNumber}; not applied` };
  }

  // ---- header
  if (await laterWins(tx, order.headerSourceEmailId, ctx, cache)) {
    const quantity = po.grandTotalQty ?? po.colourways.reduce((s, c) => s + c.sizes.reduce((t, q) => t + q.quantity, 0), 0);
    const currency = order.currencyCode ?? ctx.currencyHint;
    const styles = [...new Set(po.lines.map((l) => l.styleNumber).filter(Boolean))].join(", ");
    const next: Record<string, unknown> = {
      poIssueDate: po.poIssueDate ?? undefined,
      deliveryDate: po.shipDate ?? undefined,
      priceTerms: po.priceTerms ?? undefined,
      paymentTerms: po.paymentTerms ?? undefined,
      shipVia: po.shipVia ?? undefined,
      countryOfOrigin: po.countryOfOrigin ?? undefined,
      overShipTolerancePct: po.overShipTolerancePct ?? undefined,
      pcsPerCarton: po.pcsPerCarton ?? undefined,
      quantity: quantity > 0 ? quantity : undefined,
      style: styles || undefined,
      orderValue: po.grandTotalAmount !== null && currency ? Math.round(po.grandTotalAmount * 100) / 100 : undefined,
      currencyCode: po.grandTotalAmount !== null && currency ? currency : undefined,
    };
    if (po.grandTotalAmount !== null && !currency) warnings.push("Order value not set: the currency is not stated in the PO or the email.");
    diff("order.", order as Record<string, unknown>, next, changes);
    const set = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    await tx.update(ordersTable).set({ ...set, headerSourceEmailId: ctx.emailId }).where(eq(ordersTable.id, ctx.orderId));
  } else {
    warnings.push("Header not updated: a newer email already set it.");
  }

  // ---- priced lines
  const existingLines = await tx.select().from(orderLinesTable).where(eq(orderLinesTable.orderId, ctx.orderId));
  // a line is its style + description: two styles can share a description ("BURNOUT WASH FLEECE CREW")
  const lineKey = (style: string | null, desc: string) => `${norm(style ?? "")}|${norm(desc)}`;
  const lineIdByKey = new Map<string, string>();
  const lineIdsByDesc = new Map<string, string[]>();
  const remember = (style: string, desc: string, id: string) => {
    lineIdByKey.set(lineKey(style, desc), id);
    lineIdsByDesc.set(norm(desc), [...(lineIdsByDesc.get(norm(desc)) ?? []), id]);
  };
  for (const [i, line] of po.lines.entries()) {
    const key = `${norm(line.styleNumber)}|${norm(line.description)}`;
    const found = existingLines.find((l) => `${norm(l.styleNumber)}|${norm(l.description)}` === key);
    const values = { unitPrice: line.unitPrice, quantity: line.quantity, sortOrder: i + 1 };
    if (found) {
      remember(line.styleNumber, line.description, found.id);
      if (!(await laterWins(tx, found.sourceEmailId, ctx, cache))) continue;
      diff(`line[${line.styleNumber} ${line.description}].`, found as Record<string, unknown>, values, changes);
      await tx.update(orderLinesTable).set({ ...values, ...source(ctx) }).where(eq(orderLinesTable.id, found.id));
    } else {
      const [created] = await tx
        .insert(orderLinesTable)
        .values({ orderId: ctx.orderId, styleNumber: line.styleNumber, description: line.description, ...values, ...source(ctx) })
        .returning({ id: orderLinesTable.id });
      remember(line.styleNumber, line.description, created!.id);
      changes.push({ field: `line[${line.styleNumber} ${line.description}]`, from: null, to: `${line.quantity} pcs @ ${line.unitPrice ?? "?"}` });
    }
  }
  for (const l of existingLines) {
    if (!po.lines.some((p) => norm(p.description) === norm(l.description) && norm(p.styleNumber) === norm(l.styleNumber))) {
      warnings.push(`Line "${l.styleNumber} ${l.description}" is not on this PO version; left unchanged.`);
    }
  }

  // ---- colours and sizes
  const existingColours = await tx.select().from(colourwaysTable).where(eq(colourwaysTable.orderId, ctx.orderId));
  for (const [i, cw] of po.colourways.entries()) {
    const byDesc = cw.lineDescription ? (lineIdsByDesc.get(norm(cw.lineDescription)) ?? []) : [];
    const lineId = cw.lineDescription ? (lineIdByKey.get(lineKey(cw.styleNumber, cw.lineDescription)) ?? (byDesc.length === 1 ? byDesc[0]! : null)) : null;
    const code = norm(cw.name).toUpperCase();
    const label = `${cw.lineDescription ?? ""} / ${cw.name}`;
    let colour = existingColours.find((c) => c.code === code && c.lineId === lineId);
    if (!colour) {
      [colour] = await tx
        .insert(colourwaysTable)
        .values({ orderId: ctx.orderId, lineId, code, name: cw.name, sortOrder: i + 1, ...source(ctx) })
        .returning();
      existingColours.push(colour!);
      changes.push({ field: `colour[${label}]`, from: null, to: cw.name });
    } else if (await laterWins(tx, colour.sourceEmailId, ctx, cache)) {
      await tx.update(colourwaysTable).set({ sortOrder: i + 1, ...source(ctx) }).where(eq(colourwaysTable.id, colour.id));
    }
    const existingSizes = await tx.select().from(sizeQuantitiesTable).where(eq(sizeQuantitiesTable.colourwayId, colour!.id));
    for (const s of cw.sizes) {
      const found = existingSizes.find((e) => e.sizeLabel === s.sizeLabel);
      if (!found) {
        await tx.insert(sizeQuantitiesTable).values({ orderId: ctx.orderId, colourwayId: colour!.id, ...s, ...source(ctx) });
        changes.push({ field: `size[${label} ${s.sizeLabel}]`, from: null, to: s.quantity });
      } else if (await laterWins(tx, found.sourceEmailId, ctx, cache)) {
        if (found.quantity !== s.quantity) changes.push({ field: `size[${label} ${s.sizeLabel}]`, from: found.quantity, to: s.quantity });
        await tx.update(sizeQuantitiesTable).set({ quantity: s.quantity, sizeSort: s.sizeSort, ...source(ctx) }).where(eq(sizeQuantitiesTable.id, found.id));
      }
    }
    const dropped = existingSizes.filter((e) => !cw.sizes.some((s) => s.sizeLabel === e.sizeLabel));
    for (const d of dropped) {
      if (!(await laterWins(tx, d.sourceEmailId, ctx, cache))) continue;
      await tx.delete(sizeQuantitiesTable).where(eq(sizeQuantitiesTable.id, d.id));
      changes.push({ field: `size[${label} ${d.sizeLabel}]`, from: d.quantity, to: null });
    }
  }

  // ---- body fabric
  if (po.fabric) {
    const [found] = await tx
      .select()
      .from(fabricsTable)
      .where(and(eq(fabricsTable.orderId, ctx.orderId), eq(fabricsTable.placement, "body"), isNull(fabricsTable.colourwayId)));
    const values = { description: po.fabric.description, construction: po.fabric.construction, composition: po.fabric.composition, gsm: po.fabric.gsm };
    if (!found) {
      await tx.insert(fabricsTable).values({ orderId: ctx.orderId, placement: "body", ...values, ...source(ctx) });
      changes.push({ field: "fabric[body]", from: null, to: po.fabric.description });
    } else if (await laterWins(tx, found.sourceEmailId, ctx, cache)) {
      diff("fabric[body].", found as Record<string, unknown>, values, changes);
      await tx.update(fabricsTable).set({ ...values, ...source(ctx) }).where(eq(fabricsTable.id, found.id));
    }
  }

  // ---- trims named on the PO
  for (const t of po.trims) {
    await upsertTrim(tx, ctx, cache, changes, {
      label: t.label,
      trimType: trimType(t.label),
      description: t.label.replace(/\b\w/g, (ch) => ch.toUpperCase()),
      supplier: null,
      required: t.required,
      notes: t.required ? t.value : `${t.value} (per PO)`,
    });
  }
  return { changes, warnings, skipped: null };
}

export async function applyTrimsSheet(tx: Tx, ctx: ApplyContext, rows: TrimRow[]): Promise<ApplyResult> {
  const changes: Change[] = [];
  const cache = new Map<string, Date | null>();
  for (const r of rows) {
    await upsertTrim(tx, ctx, cache, changes, {
      label: r.label,
      trimType: trimType(r.label),
      description: r.description,
      supplier: r.supplier,
      required: r.required,
      notes: r.layout ?? "",
    });
  }
  return { changes, warnings: [], skipped: null };
}

async function upsertTrim(
  tx: Tx,
  ctx: ApplyContext,
  cache: Map<string, Date | null>,
  changes: Change[],
  t: { label: string; trimType: string; description: string; supplier: string | null; required: boolean; notes: string },
) {
  const label = trimLabel(t.label);
  const [found] = await tx
    .select()
    .from(trimsTable)
    .where(and(eq(trimsTable.orderId, ctx.orderId), eq(trimsTable.sourceLabel, label), isNull(trimsTable.colourwayId), isNull(trimsTable.sizeLabel)));
  const values = { trimType: t.trimType, description: t.description, supplier: t.supplier, required: t.required, notes: t.notes };
  if (!found) {
    await tx.insert(trimsTable).values({ orderId: ctx.orderId, sourceLabel: label, ...values, ...source(ctx) });
    changes.push({ field: `trim[${label}]`, from: null, to: t.required ? `${t.description}${t.supplier ? ` (${t.supplier})` : ""}` : "not required" });
  } else if (await laterWins(tx, found.sourceEmailId, ctx, cache)) {
    diff(`trim[${label}].`, found as Record<string, unknown>, values, changes);
    await tx.update(trimsTable).set({ ...values, ...source(ctx) }).where(eq(trimsTable.id, found.id));
  }
}

export type AttachmentSheets = { filename: string; pos: PoSheetData[]; trims: TrimRow[] | null };
export type PoInEmail = { kind: "PO sheet"; key: string; po: PoSheetData; attachmentIndex: number; label: string };
export type TrimsInEmail = { kind: "trims sheet"; rows: TrimRow[]; attachmentIndex: number; label: string };
export type OrderSheet = PoInEmail | TrimsInEmail;
export type EmailSheets = { pos: Map<string, PoInEmail>; trims: TrimsInEmail[] };

/**
 * All sheets in one email, grouped by PO number: several attachments or tabs
 * carrying the same PO (e.g. one file per style) are merged into one PO. The
 * provenance points at the first attachment that carried it.
 */
export function collectEmailSheets(attachments: AttachmentSheets[]): EmailSheets {
  const parts = new Map<string, { sheets: PoSheetData[]; at: number[]; names: string[] }>();
  const trims: TrimsInEmail[] = [];
  attachments.forEach((a, i) => {
    for (const po of a.pos) {
      const key = poKey(po.poNumber);
      const p = parts.get(key) ?? { sheets: [], at: [], names: [] };
      p.sheets.push(po);
      p.at.push(i);
      p.names.push(a.pos.length > 1 ? `${a.filename} (PO ${po.poNumber})` : a.filename);
      parts.set(key, p);
    }
    if (!a.pos.length && a.trims) trims.push({ kind: "trims sheet", rows: a.trims, attachmentIndex: i, label: a.filename });
  });
  const pos = new Map<string, PoInEmail>();
  for (const [key, p] of parts) {
    pos.set(key, { kind: "PO sheet", key, po: mergePoSheets(p.sheets), attachmentIndex: p.at[0]!, label: p.names.length > 1 ? `${p.names.length} sheets for PO ${p.sheets[0]!.poNumber}` : p.names[0]! });
  }
  return { pos, trims };
}

/**
 * Which of an email's sheets apply to an order: the PO sheet with the order's
 * PO number (so an email carrying several POs updates each order with its own),
 * plus every trims sheet. When the email holds a single PO it is still offered
 * to every linked order, so a sheet for the wrong PO is reported ("PO sheet is
 * for PO X, not this order's PO") instead of silently ignored.
 */
export function sheetsForOrder(email: EmailSheets, orderPoNumber: string | null): OrderSheet[] {
  const own = orderPoNumber ? email.pos.get(poKey(orderPoNumber)) : undefined;
  const po = own ? [own] : email.pos.size === 1 ? [...email.pos.values()] : [];
  return [...po, ...email.trims];
}

export async function applySheet(tx: Tx, ctx: ApplyContext, sheet: OrderSheet): Promise<ApplyResult> {
  return sheet.kind === "PO sheet" ? applyPoSheet(tx, ctx, sheet.po) : applyTrimsSheet(tx, ctx, sheet.rows);
}

/** One change-log row per applied attachment, listing every old -> new value. */
export async function logApplied(tx: Tx, ctx: ApplyContext, kind: string, filename: string, subject: string, result: ApplyResult, reapplied = false) {
  if (!result.changes.length && !result.warnings.length && !result.skipped) return;
  const verb = reapplied ? "Re-applied" : "Applied";
  await tx.insert(activityTable).values({
    actor: "Email intake",
    description: result.skipped
      ? `Did not apply ${kind} "${filename}" from "${subject}": ${result.skipped}`
      : `${verb} ${kind} "${filename}" from "${subject}": ${result.changes.length} change(s)${result.warnings.length ? `, ${result.warnings.length} warning(s)` : ""}`,
    entityType: "order",
    entityId: ctx.orderId,
    orderId: ctx.orderId,
    sourceEmailId: ctx.emailId,
    source: "email_intake",
    action: result.skipped ? "intake.not_applied" : `intake.${kind.replace(/\s+/g, "_")}_applied`,
    details: { changes: result.changes, warnings: result.warnings, attachment: filename },
  });
}

export async function linkedOrderIdsForMessages(messageIds: string[]): Promise<string[]> {
  if (!messageIds.length) return [];
  const rows = await db
    .selectDistinct({ orderId: sourceEmailOrdersTable.orderId })
    .from(sourceEmailOrdersTable)
    .innerJoin(sourceEmailsTable, eq(sourceEmailsTable.id, sourceEmailOrdersTable.emailId))
    .where(and(inArray(sourceEmailsTable.messageId, messageIds), eq(sourceEmailOrdersTable.matchStatus, "matched")));
  return rows.map((r) => r.orderId);
}
