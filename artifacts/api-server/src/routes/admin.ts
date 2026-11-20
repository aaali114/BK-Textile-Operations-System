import { asc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetAccessTemplatesResponse,
  GetBuyersResponse,
  ListUsersResponse,
  SetUserRoleBody,
  SetUserRoleParams,
  SetUserRoleResponse,
  TransferAdminBody,
  TransferAdminParams,
  TransferAdminResponse,
  UpdateUserAccessBody,
  UpdateUserAccessParams,
  UpdateUserAccessResponse,
  GetCurrentUserResponse,
  GetInvoiceCounterResponse,
  ReapplyOrderEmailsParams,
  ReapplyOrderEmailsResponse,
  RunEmailIntakeBody,
  RunEmailIntakeResponse,
  SetInvoiceCounterBody,
  SetInvoiceCounterResponse,
  SetOrderInvoiceNumberBody,
  SetOrderInvoiceNumberParams,
  SetOrderInvoiceNumberResponse,
} from "@workspace/api-zod";
import { buyersTable, db } from "@workspace/db";
import { accessFrom } from "../lib/access";
import { ACCESS_TEMPLATES, listUsers, setUserRole, transferAdmin, updateUserAccess, UserAdminError } from "../lib/userAdmin";
import { getAuditActor } from "../lib/auditActor";
import { getInvoiceCounter, InvoiceAdminError, setInvoiceCounter, setOrderInvoiceNumber } from "../lib/invoiceAdmin";
import { IntakeConfigError } from "../intake/config";
import { reapplyOrder, runMailboxIntake } from "../intake/service";
import { orderExists } from "../lib/orderDetail";

const router: IRouter = Router();

router.get("/me", (_req, res): void => {
  const a = accessFrom(res)!;
  res.json(
    GetCurrentUserResponse.parse({
      userId: a.userId,
      email: a.email,
      name: a.name,
      status: a.status,
      role: a.role,
      department: a.department,
      isAdmin: a.canManageUsers,
      canManageUsers: a.canManageUsers,
      areas: a.areas,
      permissions: [...a.permissions].sort(),
    }),
  );
});

function userAdminError(res: import("express").Response, error: unknown): boolean {
  if (error instanceof UserAdminError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

router.get("/admin/users", async (_req, res): Promise<void> => {
  res.json(ListUsersResponse.parse(await listUsers()));
});

router.get("/admin/access-templates", (_req, res): void => {
  res.json(GetAccessTemplatesResponse.parse(ACCESS_TEMPLATES));
});

router.put("/admin/users/:userId/access", async (req, res): Promise<void> => {
  const params = UpdateUserAccessParams.safeParse(req.params);
  const body = UpdateUserAccessBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid access update" });
    return;
  }
  try {
    const user = await updateUserAccess(accessFrom(res)!, params.data.userId, body.data);
    req.log.info({ target: params.data.userId }, "User access updated");
    res.json(UpdateUserAccessResponse.parse(user));
  } catch (error) {
    if (!userAdminError(res, error)) throw error;
  }
});

router.put("/admin/users/:userId/role", async (req, res): Promise<void> => {
  const params = SetUserRoleParams.safeParse(req.params);
  const body = SetUserRoleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid role update" });
    return;
  }
  try {
    res.json(SetUserRoleResponse.parse(await setUserRole(accessFrom(res)!, params.data.userId, body.data.role)));
  } catch (error) {
    if (!userAdminError(res, error)) throw error;
  }
});

router.post("/admin/users/:userId/make-admin", async (req, res): Promise<void> => {
  const params = TransferAdminParams.safeParse(req.params);
  const body = TransferAdminBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.confirm !== true) {
    res.status(400).json({ error: 'Send {"confirm": true} to transfer the administrator role.' });
    return;
  }
  try {
    const user = await transferAdmin(accessFrom(res)!, params.data.userId);
    req.log.warn({ newAdmin: params.data.userId }, "User promoted to administrator");
    res.json(TransferAdminResponse.parse(user));
  } catch (error) {
    if (!userAdminError(res, error)) throw error;
  }
});

router.get("/buyers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(buyersTable).orderBy(asc(buyersTable.name));
  res.json(GetBuyersResponse.parse(rows));
});

router.get("/admin/invoice-counter", async (_req, res): Promise<void> => {
  res.json(GetInvoiceCounterResponse.parse(await getInvoiceCounter()));
});

router.put("/admin/invoice-counter", async (req, res): Promise<void> => {
  const body = SetInvoiceCounterBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const counter = await setInvoiceCounter(body.data.lastNumber, body.data.reason.trim(), getAuditActor(req));
    req.log.info({ lastNumber: body.data.lastNumber }, "Invoice counter set by admin");
    res.json(SetInvoiceCounterResponse.parse(counter));
  } catch (error) {
    if (error instanceof InvoiceAdminError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.put("/admin/orders/:orderId/invoice", async (req, res): Promise<void> => {
  const params = SetOrderInvoiceNumberParams.safeParse(req.params);
  const body = SetOrderInvoiceNumberBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid invoice update" });
    return;
  }
  try {
    const order = await setOrderInvoiceNumber(params.data.orderId, body.data.invoiceNumber, body.data.reason.trim(), getAuditActor(req));
    req.log.info({ orderId: order.id, invoiceRef: order.invoiceRef }, "Order invoice overridden by admin");
    res.json(SetOrderInvoiceNumberResponse.parse(order));
  } catch (error) {
    if (error instanceof InvoiceAdminError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/admin/intake/run", async (req, res): Promise<void> => {
  const body = RunEmailIntakeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const summary = await runMailboxIntake(body.data);
    req.log.info({ dryRun: summary.dryRun, scanned: summary.scanned, stored: summary.stored, errors: summary.errors.length }, "Email intake run");
    res.json(RunEmailIntakeResponse.parse(summary));
  } catch (error) {
    if (error instanceof IntakeConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if ((error as Error).message.startsWith("Another intake run")) {
      res.status(409).json({ error: (error as Error).message });
      return;
    }
    req.log.error({ err: (error as Error).message }, "Email intake run failed");
    res.status(502).json({ error: `Mailbox run failed: ${(error as Error).message}` });
  }
});

router.post("/admin/orders/:orderId/reapply-emails", async (req, res): Promise<void> => {
  const params = ReapplyOrderEmailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await orderExists(params.data.orderId))) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  try {
    const report = await reapplyOrder(params.data.orderId, getAuditActor(req));
    req.log.info({ orderId: params.data.orderId, emails: report.emails.length }, "Order emails re-applied");
    res.json(ReapplyOrderEmailsResponse.parse(report));
  } catch (error) {
    req.log.error({ err: (error as Error).message }, "Re-apply failed");
    res.status(502).json({ error: `Re-apply failed: ${(error as Error).message}` });
  }
});

export default router;
