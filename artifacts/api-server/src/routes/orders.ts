import { and, desc, eq, ilike } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateOrderBody,
  CreateOrderResponse,
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

  const order = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(83439042)`);
    const year = new Date().getFullYear();
    const prefixPattern = new RegExp(`^(\\d+)\\/BK-[A-Z0-9]+\\/${year}$`);
    const references = await tx.select({ reference: ordersTable.reference }).from(ordersTable);
    const lastNumber = references.reduce((max, row) => {
      const match = row.reference.match(prefixPattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 4055);
    const reference = `${lastNumber + 1}/BK-${initials(parsed.data.buyer)}/${year}`;
    const [created] = await tx
      .insert(ordersTable)
      .values({
        reference,
        buyer: parsed.data.buyer.trim(),
        poNumber: parsed.data.poNumber?.trim() || null,
        style: parsed.data.style.trim(),
        description: parsed.data.description?.trim() || null,
        quantity: parsed.data.quantity,
        deliveryDate: asDateString(parsed.data.deliveryDate),
        priority: parsed.data.priority ?? "normal",
      })
      .returning();

    await tx.insert(workItemsTable).values([
      {
        orderId: created.id,
        title: "Confirm order details",
        department: "merchandising",
        dueDate: asDateString(parsed.data.deliveryDate),
        status: "not_started",
        priority: parsed.data.priority ?? "normal",
      },
      {
        orderId: created.id,
        title: "Prepare fabric plan",
        department: "fabrication",
        dueDate: asDateString(parsed.data.deliveryDate),
        status: "not_started",
        priority: parsed.data.priority ?? "normal",
      },
    ]);
    await tx.insert(activityTable).values({
      actor: "Staff member",
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
  for (const key of ["buyer", "poNumber", "style", "description", "quantity", "status", "priority"] as const) {
    if (data[key] !== undefined) update[key] = data[key];
  }
  if (data.deliveryDate !== undefined) update.deliveryDate = asDateString(data.deliveryDate);
  const [order] = await db
    .update(ordersTable)
    .set(update)
    .where(eq(ordersTable.id, params.data.orderId))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  await db.insert(activityTable).values({
    actor: "Staff member",
    description: `Updated order ${order.reference}`,
    entityType: "order",
    entityId: order.id,
  });
  res.json(UpdateOrderResponse.parse(order));
});

export default router;
