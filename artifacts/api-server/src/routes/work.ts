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
import { getAuditActor } from "../lib/auditActor";

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

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(workItemsTable).where(eq(workItemsTable.id, params.data.workItemId));
    if (!before) return null;
    const [row] = await tx
      .update(workItemsTable)
      .set(update)
      .where(eq(workItemsTable.id, params.data.workItemId))
      .returning();
    const [order] = await tx.select({ reference: ordersTable.reference }).from(ordersTable).where(eq(ordersTable.id, row.orderId));
    if (!order) return null;
    const changes = [
      ...(parsed.data.assignee !== undefined && before.assignee !== row.assignee ? [`Assignee: ${before.assignee || "—"} → ${row.assignee || "—"}`] : []),
      ...(parsed.data.status !== undefined && before.status !== row.status ? [`Status: ${before.status} → ${row.status}`] : []),
      ...(parsed.data.priority !== undefined && before.priority !== row.priority ? [`Priority: ${before.priority} → ${row.priority}`] : []),
      ...(parsed.data.dueDate !== undefined && before.dueDate !== row.dueDate ? [`Due date: ${before.dueDate} → ${row.dueDate}`] : []),
    ];
    if (changes.length) {
      const actor = getAuditActor(req);
      await tx.insert(activityTable).values({
        actor: actor.label,
        actorId: actor.id,
        description: `Updated ${row.title} for ${order.reference} · ${changes.join("; ")}`,
        entityType: "order",
        entityId: row.orderId,
      });
    }
    return { row, order };
  });
  if (!result) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  res.json(UpdateWorkItemResponse.parse({ ...result.row, orderReference: result.order.reference }));
});

export default router;
