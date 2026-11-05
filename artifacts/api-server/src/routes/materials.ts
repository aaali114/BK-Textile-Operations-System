import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateInspectionBody,
  CreateInspectionResponse,
  CreateMaterialLotBody,
  CreateMaterialLotResponse,
  GetInspectionsResponse,
  GetMaterialsResponse,
} from "@workspace/api-zod";
import { activityTable, db, inspectionsTable, materialLotsTable, ordersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/materials", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: materialLotsTable.id,
      orderId: materialLotsTable.orderId,
      orderReference: ordersTable.reference,
      material: materialLotsTable.material,
      type: materialLotsTable.type,
      supplier: materialLotsTable.supplier,
      lotReference: materialLotsTable.lotReference,
      quantity: materialLotsTable.quantity,
      unit: materialLotsTable.unit,
      status: materialLotsTable.status,
      receivedAt: materialLotsTable.receivedAt,
    })
    .from(materialLotsTable)
    .leftJoin(ordersTable, eq(materialLotsTable.orderId, ordersTable.id))
    .orderBy(asc(materialLotsTable.receivedAt));
  res.json(GetMaterialsResponse.parse(rows));
});

router.post("/materials", async (req, res): Promise<void> => {
  const parsed = CreateMaterialLotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const value = parsed.data;
  const [lot] = await db
    .insert(materialLotsTable)
    .values({
      orderId: value.orderId ?? null,
      material: value.material.trim(),
      type: value.type,
      supplier: value.supplier.trim(),
      lotReference: value.lotReference.trim(),
      quantity: value.quantity,
      unit: value.unit.trim(),
      receivedAt: value.receivedAt.toISOString().slice(0, 10),
    })
    .returning();
  const [order] = lot.orderId
    ? await db.select({ reference: ordersTable.reference }).from(ordersTable).where(eq(ordersTable.id, lot.orderId))
    : [undefined];
  await db.insert(activityTable).values({
    actor: "Staff member",
    description: `Recorded material receipt ${lot.lotReference}`,
    entityType: "material",
    entityId: lot.id,
  });
  res.status(201).json(CreateMaterialLotResponse.parse({ ...lot, orderReference: order?.reference ?? null }));
});

router.get("/inspections", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: inspectionsTable.id,
      materialId: inspectionsTable.materialId,
      lotReference: materialLotsTable.lotReference,
      inspectionType: inspectionsTable.inspectionType,
      result: inspectionsTable.result,
      defectCount: inspectionsTable.defectCount,
      notes: inspectionsTable.notes,
      inspectedAt: inspectionsTable.inspectedAt,
    })
    .from(inspectionsTable)
    .innerJoin(materialLotsTable, eq(inspectionsTable.materialId, materialLotsTable.id))
    .orderBy(asc(inspectionsTable.inspectedAt));
  res.json(GetInspectionsResponse.parse(rows));
});

router.post("/inspections", async (req, res): Promise<void> => {
  const parsed = CreateInspectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(materialLotsTable)
      .where(eq(materialLotsTable.id, input.materialId));
    if (!lot) return null;
    const [inspection] = await tx
      .insert(inspectionsTable)
      .values({
        materialId: lot.id,
        inspectionType: input.inspectionType,
        result: input.result,
        defectCount: input.defectCount,
        notes: input.notes ?? "",
      })
      .returning();
    const nextStatus = input.result === "accepted" ? "available" : input.result === "rejected" ? "rejected" : "hold";
    await tx.update(materialLotsTable).set({ status: nextStatus }).where(eq(materialLotsTable.id, lot.id));
    await tx.insert(activityTable).values({
      actor: "Staff member",
      description: `Inspection ${input.result} for lot ${lot.lotReference}`,
      entityType: "inspection",
      entityId: inspection.id,
    });
    return { inspection, lotReference: lot.lotReference };
  });
  if (!result) {
    res.status(404).json({ error: "Material lot not found" });
    return;
  }
  res.status(201).json(CreateInspectionResponse.parse({
    ...result.inspection,
    lotReference: result.lotReference,
  }));
});

export default router;
