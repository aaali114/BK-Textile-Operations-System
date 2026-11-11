import { Router, type IRouter } from "express";
import {
  DownloadOrderEmailAttachmentParams,
  GetOrderEmailParams,
  GetOrderEmailResponse,
  GetOrderEmailsParams,
  GetOrderEmailsResponse,
  UpdateOrderEmailBody,
  UpdateOrderEmailParams,
  UpdateOrderEmailResponse,
} from "@workspace/api-zod";
import { getAuditActor } from "../lib/auditActor";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  findOrderEmailAttachment,
  getOrderEmail,
  getOrderEmails,
  orderExists,
  updateOrderEmail,
} from "../lib/orderDetail";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

router.get("/orders/:orderId/emails", async (req, res): Promise<void> => {
  const params = GetOrderEmailsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await orderExists(params.data.orderId))) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(GetOrderEmailsResponse.parse(await getOrderEmails(params.data.orderId)));
});

router.get("/orders/:orderId/emails/:emailId", async (req, res): Promise<void> => {
  const params = GetOrderEmailParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const email = await getOrderEmail(params.data.orderId, params.data.emailId);
  if (!email) {
    res.status(404).json({ error: "Email not linked to this order" });
    return;
  }
  res.json(GetOrderEmailResponse.parse(email));
});

router.patch("/orders/:orderId/emails/:emailId", async (req, res): Promise<void> => {
  const params = UpdateOrderEmailParams.safeParse(req.params);
  const body = UpdateOrderEmailBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid email update" });
    return;
  }
  const email = await updateOrderEmail(params.data.orderId, params.data.emailId, body.data, getAuditActor(req));
  if (!email) {
    res.status(404).json({ error: "Email not linked to this order" });
    return;
  }
  res.json(UpdateOrderEmailResponse.parse(email));
});

router.get("/orders/:orderId/emails/:emailId/attachments/:attachmentId/content", async (req, res): Promise<void> => {
  const params = DownloadOrderEmailAttachmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const attachment = await findOrderEmailAttachment(params.data.orderId, params.data.emailId, params.data.attachmentId);
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(attachment.objectPath);
    const fallback = attachment.filename.replace(/[^\x20-\x7e]|["\;]/g, "_") || "attachment";
    // Always a download: attachments come from outside senders and are never rendered inline.
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(attachment.sizeBytes));
    res.setHeader("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error, attachmentId: params.data.attachmentId }, "Failed to stream email attachment");
      if (!res.headersSent) res.status(500).json({ error: "Failed to serve attachment" });
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Attachment content is unavailable" });
      return;
    }
    req.log.error({ err: error }, "Failed to access email attachment");
    res.status(500).json({ error: "Failed to serve attachment" });
  }
});

export default router;
