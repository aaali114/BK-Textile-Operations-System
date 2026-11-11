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
import { activityTable, db, ordersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAuditActor } from "../lib/auditActor";
import { createOrderWithInvoice, OrderInputError } from "../lib/orderCreation";
import { getOrderActivity, orderExists } from "../lib/orderDetail";
import { isUniqueViolation } from "../lib/pgErrors";

const router: IRouter = Router();

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

  let order;
  try {
    order = await createOrderWithInvoice(
      {
        ...input,
        deliveryDate: asDateString(input.deliveryDate),
        poIssueDate: input.poIssueDate ? asDateString(input.poIssueDate) : undefined,
      },
      getAuditActor(req),
    );
  } catch (error) {
    if (error instanceof OrderInputError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

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
  if (!(await orderExists(params.data.orderId))) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const rows = await getOrderActivity(params.data.orderId);
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
    "endCustomer",
    "priceTerms",
    "paymentTerms",
    "shipVia",
    "countryOfOrigin",
    "overShipTolerancePct",
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
  for (const key of ["endCustomer", "priceTerms", "paymentTerms", "shipVia", "countryOfOrigin"] as const) {
    if (typeof update[key] === "string") update[key] = (update[key] as string).trim() || null;
  }
  if (data.poIssueDate !== undefined) update.poIssueDate = data.poIssueDate === null ? null : asDateString(data.poIssueDate);
  if (data.deliveryDate !== undefined) update.deliveryDate = asDateString(data.deliveryDate);
  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
      if (!before) return null;
      if (before.buyerId && data.buyer !== undefined && data.buyer.trim() !== before.buyer) {
        throw new OrderInputError(400, "The buyer of an invoiced order cannot be changed.");
      }
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
        ["poIssueDate", "PO issue date", before.poIssueDate ?? "", order.poIssueDate ?? ""],
        ["endCustomer", "End customer", before.endCustomer ?? "", order.endCustomer ?? ""],
        ["priceTerms", "Price terms", before.priceTerms ?? "", order.priceTerms ?? ""],
        ["paymentTerms", "Payment terms", before.paymentTerms ?? "", order.paymentTerms ?? ""],
        ["shipVia", "Ship via", before.shipVia ?? "", order.shipVia ?? ""],
        ["countryOfOrigin", "Country of origin", before.countryOfOrigin ?? "", order.countryOfOrigin ?? ""],
        ["overShipTolerancePct", "Over-shipment allowance %", before.overShipTolerancePct === null ? "" : String(before.overShipTolerancePct), order.overShipTolerancePct === null ? "" : String(order.overShipTolerancePct)],
        ["style", "Style", before.style, order.style],
        ["description", "Order notes", before.description ?? "", order.description ?? ""],
        ["quantity", "Quantity", String(before.quantity), String(order.quantity)],
        ["deliveryDate", "Delivery date", before.deliveryDate, order.deliveryDate],
        ["status", "Status", before.status, order.status],
        ["priority", "Priority", before.priority, order.priority],
      ];
      const changed = fields
        .filter(([field]) => field === "orderValue"
          ? Object.prototype.hasOwnProperty.call(data, "orderValue") || Object.prototype.hasOwnProperty.call(data, "currencyCode")
          : Object.prototype.hasOwnProperty.call(data, field))
        .filter(([, , previous, next]) => previous !== next);
      if (changed.length) {
        const actor = getAuditActor(req);
        await tx.insert(activityTable).values({
          actor: actor.label,
          actorId: actor.id,
          description: `Updated ${order.reference} · ${changed.map(([, label, previous, next]) => `${label}: ${previous || "—"} → ${next || "—"}`).join("; ")}`,
          entityType: "order",
          entityId: order.id,
          orderId: order.id,
          source: "staff",
          action: "order.updated",
          details: { changes: changed.map(([field, , previous, next]) => ({ field, from: previous || null, to: next || null })) },
        });
      }
      return order;
    });
  } catch (error) {
    if (error instanceof OrderInputError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (isUniqueViolation(error, "bk_orders_buyer_po_unique")) {
      res.status(409).json({ error: "That PO number already exists for this buyer." });
      return;
    }
    throw error;
  }
  if (!result) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const order = result;
  res.json(UpdateOrderResponse.parse(order));
});

export default router;
