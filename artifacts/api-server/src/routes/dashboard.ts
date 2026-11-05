import { and, desc, eq, lt, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { activityTable, db, materialLotsTable, ordersTable, workItemsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [orders, workItems, materials, activity] = await Promise.all([
    db.select().from(ordersTable),
    db
      .select({
        id: workItemsTable.id,
        orderId: workItemsTable.orderId,
        title: workItemsTable.title,
        department: workItemsTable.department,
        dueDate: workItemsTable.dueDate,
        status: workItemsTable.status,
        priority: workItemsTable.priority,
      })
      .from(workItemsTable),
    db.select().from(materialLotsTable),
    db.select().from(activityTable).orderBy(desc(activityTable.occurredAt)).limit(6),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const activeOrders = orders.filter((order) => !["shipped"].includes(order.status));
  const openItems = workItems.filter((item) => item.status !== "completed");
  const overdueItems = openItems.filter((item) => item.dueDate < today);
  const departmentNames = [...new Set(workItems.map((item) => item.department))];
  const departmentPulse = departmentNames.map((department) => {
    const departmentItems = openItems.filter((item) => item.department === department);
    return {
      department,
      openTasks: departmentItems.length,
      overdueTasks: departmentItems.filter((item) => item.dueDate < today).length,
    };
  });
  const attentionItems = [
    ...overdueItems.slice(0, 5).map((item) => ({
      id: `task-${item.id}`,
      title: item.title,
      detail: `${item.department.replaceAll("_", " ")} task overdue since ${item.dueDate}`,
      severity: item.status === "blocked" ? "critical" as const : "warning" as const,
      orderReference: orders.find((order) => order.id === item.orderId)?.reference ?? null,
      createdAt: new Date(`${item.dueDate}T12:00:00.000Z`),
    })),
    ...materials
      .filter((lot) => lot.status === "hold" || lot.status === "pending_qc")
      .slice(0, 5)
      .map((lot) => ({
        id: `material-${lot.id}`,
        title: lot.status === "hold" ? "Material lot on hold" : "Material awaiting QC",
        detail: `${lot.material} · lot ${lot.lotReference}`,
        severity: lot.status === "hold" ? "critical" as const : "warning" as const,
        orderReference: orders.find((order) => order.id === lot.orderId)?.reference ?? null,
        createdAt: new Date(`${lot.receivedAt}T12:00:00.000Z`),
      })),
  ].slice(0, 6);
  const readyOrderIds = new Set(
    materials
      .filter((lot) => lot.type === "dyed_fabric" && lot.status === "available" && lot.orderId)
      .map((lot) => lot.orderId),
  );
  const summary = {
    activeOrders: activeOrders.length,
    dueThisMonth: activeOrders.filter((order) => order.deliveryDate.startsWith(currentMonth)).length,
    overdueWork: overdueItems.length,
    materialsOnHold: materials.filter((lot) => lot.status === "hold" || lot.status === "pending_qc").length,
    readyToCut: readyOrderIds.size,
    departmentPulse,
    attentionItems,
    recentActivity: activity,
  };
  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/activity", async (_req, res): Promise<void> => {
  const rows = await db.select().from(activityTable).orderBy(desc(activityTable.occurredAt)).limit(30);
  res.json(rows);
});

export default router;
