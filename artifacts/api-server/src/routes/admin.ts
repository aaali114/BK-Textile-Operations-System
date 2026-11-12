import { asc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  GetBuyersResponse,
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
import { isAdmin, requireAdmin } from "../lib/admin";
import { getAuditActor } from "../lib/auditActor";
import { getInvoiceCounter, InvoiceAdminError, setInvoiceCounter, setOrderInvoiceNumber } from "../lib/invoiceAdmin";
import { IntakeConfigError } from "../intake/config";
import { reapplyOrder, runMailboxIntake } from "../intake/service";
import { orderExists } from "../lib/orderDetail";

const router: IRouter = Router();

router.get("/me", (req, res): void => {
  res.json(GetCurrentUserResponse.parse({ userId: getAuth(req).userId, isAdmin: isAdmin(req) }));
});

router.get("/buyers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(buyersTable).orderBy(asc(buyersTable.name));
  res.json(GetBuyersResponse.parse(rows));
});

router.get("/admin/invoice-counter", requireAdmin, async (_req, res): Promise<void> => {
  res.json(GetInvoiceCounterResponse.parse(await getInvoiceCounter()));
});

router.put("/admin/invoice-counter", requireAdmin, async (req, res): Promise<void> => {
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

router.put("/admin/orders/:orderId/invoice", requireAdmin, async (req, res): Promise<void> => {
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

router.post("/admin/intake/run", requireAdmin, async (req, res): Promise<void> => {
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

router.post("/admin/orders/:orderId/reapply-emails", requireAdmin, async (req, res): Promise<void> => {
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
