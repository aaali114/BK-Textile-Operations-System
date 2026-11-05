import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetWorkItemsQueryParams,
  GetWorkItemsResponse,
  UpdateWorkItemBody,
  UpdateWorkItemParams,
  UpdateWorkItemResponse,
} from "@workspace/api-zod";
import { activityTable, db, ordersTable, workItemsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/work-items", async (req, res): Promise<void> => {
  const parsed = GetWorkItemsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.department) conditions.push(eq(workItemsTable.department, parsed.data.department));
  if (parsed.data.status) conditions.push(eq(workItemsTable.status, parsed.data.status));
  const rows = await db
    .select({
      id: workItemsTable.id,
      orderId: workItemsTable.orderId,
      orderReference: ordersTable.reference,
      title: workItemsTable.title,
      department: workItemsTable.department,
      assignee: workItemsTable.assignee,
      dueDate: workItemsTable.dueDate,
      status: workItemsTable.status,
      priority: workItemsTable.priority,
      updatedAt: workItemsTable.updatedAt,
    })
    .from(workItemsTable)
    .innerJoin(ordersTable, eq(workItemsTable.orderId, ordersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(workItemsTable.dueDate));
  res.json(GetWorkItemsResponse.parse(rows));
});

router.patch("/work-items/:workItemId", async (req, res): Promise<void> => {
  const params = UpdateWorkItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateWorkItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ["assignee", "status", "priority"] as const) {
    if (parsed.data[key] !== undefined) update[key] = parsed.data[key];
  }
  if (parsed.data.dueDate !== undefined) update.dueDate = parsed.data.dueDate.toISOString().slice(0, 10);

  const [row] = await db
    .update(workItemsTable)
    .set(update)
    .where(eq(workItemsTable.id, params.data.workItemId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  const [order] = await db.select({ reference: ordersTable.reference }).from(ordersTable).where(eq(ordersTable.id, row.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  await db.insert(activityTable).values({
    actor: "Staff member",
    description: `Updated ${row.title} for ${order.reference}`,
    entityType: "work_item",
    entityId: row.id,
  });
  res.json(UpdateWorkItemResponse.parse({ ...row, orderReference: order.reference }));
});

export default router;
