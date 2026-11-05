import { and, desc, eq, ilike } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateOrderBody,
  CreateOrderResponse,
  GetOrderActivityParams,
  GetOrderActivityResponse,
  GetOrderParams,
  GetOrderResponse,
  GetOrdersQueryParams,
  GetOrdersResponse,
  UpdateOrderBody,
  UpdateOrderParams,
  UpdateOrderResponse,
} from "@workspace/api-zod";
import { activityTable, db, ordersTable, workItemsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAuditActor } from "../lib/auditActor";

const router: IRouter = Router();

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5) || "BK";
}

function asDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

router.get("/orders", async (req, res): Promise<void> => {
  const parsed = GetOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const conditions = [];
  if (parsed.data.search) {
    const pattern = `%${parsed.data.search}%`;
    conditions.push(ilike(ordersTable.reference, pattern));
    conditions.push(ilike(ordersTable.buyer, pattern));
    conditions.push(ilike(ordersTable.agencyName, pattern));
    conditions.push(ilike(ordersTable.previousOrderReference, pattern));
    conditions.push(ilike(ordersTable.style, pattern));
    conditions.push(ilike(ordersTable.poNumber, pattern));
  }
  const where = [
    ...(parsed.data.status ? [eq(ordersTable.status, parsed.data.status)] : []),
    ...(conditions.length ? [conditions.reduce((left, right) => sql`(${left} OR ${right})`)] : []),
  ];
  const rows = await db
    .select()
    .from(ordersTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(ordersTable.createdAt));
  res.json(GetOrdersResponse.parse(rows));
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if ((input.orderValue !== undefined) !== (input.currencyCode !== undefined)) {
    res.status(400).json({ error: "Order value and currency must be provided together." });
    return;
  }

  const order = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(83439042)`);
    const year = new Date().getFullYear();
    const prefixPattern = new RegExp(`^(\\d+)\\/BK-[A-Z0-9]+\\/${year}$`);
    const references = await tx.select({ reference: ordersTable.reference }).from(ordersTable);
    const lastNumber = references.reduce((max, row) => {
      const match = row.reference.match(prefixPattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 4055);
    const reference = `${lastNumber + 1}/BK-${initials(input.buyer)}/${year}`;
    const [created] = await tx
      .insert(ordersTable)
      .values({
        reference,
        buyer: input.buyer.trim(),
        agencyName: input.agencyName?.trim() || null,
        previousOrderReference: input.previousOrderReference?.trim() || null,
        orderValue: input.orderValue ?? null,
        currencyCode: input.currencyCode?.trim().toUpperCase() || null,
        poNumber: input.poNumber?.trim() || null,
        style: input.style.trim(),
        description: input.description?.trim() || null,
        quantity: input.quantity,
        deliveryDate: asDateString(input.deliveryDate),
        priority: input.priority ?? "normal",
      })
      .returning();

    await tx.insert(workItemsTable).values([
      {
        orderId: created.id,
        title: "Confirm order details",
        department: "merchandising",
        dueDate: asDateString(input.deliveryDate),
        status: "not_started",
        priority: input.priority ?? "normal",
      },
      {
        orderId: created.id,
        title: "Prepare fabric plan",
        department: "fabrication",
        dueDate: asDateString(input.deliveryDate),
        status: "not_started",
        priority: input.priority ?? "normal",
      },
    ]);
    const actor = getAuditActor(req);
    await tx.insert(activityTable).values({
      actor: actor.label,
      actorId: actor.id,
      description: `Created order ${created.reference}`,
      entityType: "order",
      entityId: created.id,
    });
    return created;
  });

  req.log.info({ orderId: order.id }, "Order created");
  res.status(201).json(CreateOrderResponse.parse(order));
});

router.get("/orders/:orderId", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(GetOrderResponse.parse(order));
});

router.get("/orders/:orderId/activity", async (req, res): Promise<void> => {
  const params = GetOrderActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const rows = await db
    .select({
      id: activityTable.id,
      actor: activityTable.actor,
      actorId: activityTable.actorId,
      description: activityTable.description,
      occurredAt: activityTable.occurredAt,
    })
    .from(activityTable)
    .where(and(eq(activityTable.entityType, "order"), eq(activityTable.entityId, params.data.orderId)))
    .orderBy(desc(activityTable.occurredAt));
  res.json(GetOrderActivityResponse.parse(rows));
});

router.patch("/orders/:orderId", async (req, res): Promise<void> => {
  const params = UpdateOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  const hasAmount = data.orderValue !== undefined;
  const hasCurrency = data.currencyCode !== undefined;
  if (hasAmount !== hasCurrency || (hasAmount && ((data.orderValue === null) !== (data.currencyCode === null)))) {
    res.status(400).json({ error: "Order value and currency must be updated together." });
    return;
  }
  if (hasAmount) {
    update.currencyCode = data.currencyCode === null ? null : data.currencyCode?.trim().toUpperCase();
  }
  for (const key of [
    "buyer",
    "agencyName",
    "previousOrderReference",
    "orderValue",
    "currencyCode",
    "poNumber",
    "style",
    "description",
    "quantity",
    "status",
    "priority",
  ] as const) {
    if (data[key] !== undefined) update[key] = data[key];
  }
  if (typeof update.currencyCode === "string") update.currencyCode = update.currencyCode.trim().toUpperCase();
  if (typeof update.agencyName === "string") update.agencyName = update.agencyName.trim() || null;
  if (typeof update.previousOrderReference === "string") update.previousOrderReference = update.previousOrderReference.trim() || null;
  if (typeof update.poNumber === "string") update.poNumber = update.poNumber.trim() || null;
  if (typeof update.description === "string") update.description = update.description.trim() || null;
  if (data.deliveryDate !== undefined) update.deliveryDate = asDateString(data.deliveryDate);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
    if (!before) return null;
    const [order] = await tx
      .update(ordersTable)
      .set(update)
      .where(eq(ordersTable.id, params.data.orderId))
      .returning();
    const fields: Array<[string, string, string, string]> = [
      ["buyer", "Buyer", before.buyer, order.buyer],
      ["agencyName", "Agency", before.agencyName ?? "", order.agencyName ?? ""],
      ["previousOrderReference", "Previous order reference", before.previousOrderReference ?? "", order.previousOrderReference ?? ""],
      ["orderValue", "Order value", before.orderValue === null ? "" : `${before.orderValue} ${before.currencyCode ?? ""}`.trim(), order.orderValue === null ? "" : `${order.orderValue} ${order.currencyCode ?? ""}`.trim()],
      ["poNumber", "Buyer PO", before.poNumber ?? "", order.poNumber ?? ""],
      ["style", "Style", before.style, order.style],
      ["description", "Order notes", before.description ?? "", order.description ?? ""],
      ["quantity", "Quantity", String(before.quantity), String(order.quantity)],
      ["deliveryDate", "Delivery date", before.deliveryDate, order.deliveryDate],
      ["status", "Status", before.status, order.status],
      ["priority", "Priority", before.priority, order.priority],
    ];
    const changes = fields
      .filter(([field]) => field === "orderValue"
        ? Object.prototype.hasOwnProperty.call(data, "orderValue") || Object.prototype.hasOwnProperty.call(data, "currencyCode")
        : Object.prototype.hasOwnProperty.call(data, field))
      .filter(([, , previous, next]) => previous !== next)
      .map(([, label, previous, next]) => `${label}: ${previous || "—"} → ${next || "—"}`);
    if (changes.length) {
      const actor = getAuditActor(req);
      await tx.insert(activityTable).values({
        actor: actor.label,
        actorId: actor.id,
        description: `Updated ${order.reference} · ${changes.join("; ")}`,
        entityType: "order",
        entityId: order.id,
      });
    }
    return order;
  });
  if (!result) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const order = result;
  res.json(UpdateOrderResponse.parse(order));
});

export default router;
