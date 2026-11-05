import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CompleteOrderFileUploadParams,
  CompleteOrderFileUploadResponse,
  DownloadOrderFileParams,
  GetOrderFilesParams,
  GetOrderFilesResponse,
  PreviewOrderFileParams,
  RequestOrderFileUploadBody,
  RequestOrderFileUploadParams,
  RequestOrderFileUploadResponse,
} from "@workspace/api-zod";
import { db, orderFilesTable, ordersTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { getAuditActor } from "../lib/auditActor";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeOriginalName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function contentDisposition(mode: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\;]/g, "_") || "order-file";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function streamOrderFile(req: Request, res: Response, inline: boolean): Promise<void> {
  const paramsSchema = inline ? PreviewOrderFileParams : DownloadOrderFileParams;
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [fileRecord] = await db.select().from(orderFilesTable).where(and(
    eq(orderFilesTable.id, params.data.fileId),
    eq(orderFilesTable.orderId, params.data.orderId),
  ));
  if (!fileRecord?.uploadedAt) {
    res.status(404).json({ error: "Order file not found" });
    return;
  }

  if (inline && !IMAGE_TYPES.has(fileRecord.contentType) && fileRecord.contentType !== "application/pdf") {
    res.status(400).json({ error: "This file type can only be downloaded" });
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(fileRecord.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== fileRecord.sizeBytes || metadata.contentType !== fileRecord.contentType) {
      res.status(404).json({ error: "Order file content is unavailable" });
      return;
    }

    res.setHeader("Content-Type", fileRecord.contentType);
    res.setHeader("Content-Length", String(fileRecord.sizeBytes));
    res.setHeader("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", fileRecord.originalName));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (inline) res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");

    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error, orderId: fileRecord.orderId, fileId: fileRecord.id }, "Failed to stream order file");
      if (!res.headersSent) res.status(500).json({ error: "Failed to serve order file" });
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Order file content is unavailable" });
      return;
    }
    req.log.error({ err: error }, "Failed to access order file");
    res.status(500).json({ error: "Failed to serve order file" });
  }
}

router.get("/orders/:orderId/files", async (req, res): Promise<void> => {
  const params = GetOrderFilesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const rows = await db.select({
    id: orderFilesTable.id,
    orderId: orderFilesTable.orderId,
    fileType: orderFilesTable.fileType,
    originalName: orderFilesTable.originalName,
    contentType: orderFilesTable.contentType,
    sizeBytes: orderFilesTable.sizeBytes,
    uploadedBy: orderFilesTable.uploadedBy,
    uploadedByName: orderFilesTable.uploadedByName,
    uploadedAt: orderFilesTable.uploadedAt,
  }).from(orderFilesTable)
    .where(and(eq(orderFilesTable.orderId, params.data.orderId), isNotNull(orderFilesTable.uploadedAt)))
    .orderBy(desc(orderFilesTable.uploadedAt));
  res.json(GetOrderFilesResponse.parse(rows));
});

router.post("/orders/:orderId/files/upload-url", async (req, res): Promise<void> => {
  const params = RequestOrderFileUploadParams.safeParse(req.params);
  const parsed = RequestOrderFileUploadBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid order file upload request" });
    return;
  }
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const input = parsed.data;
  const originalName = safeOriginalName(input.name);
  if (!originalName || originalName.length > 255 || input.sizeBytes > MAX_FILE_SIZE) {
    res.status(400).json({ error: "File name or size is not allowed" });
    return;
  }
  const allowedTypes = input.fileType === "garment_image" ? IMAGE_TYPES : DOCUMENT_TYPES;
  if (!allowedTypes.has(input.contentType)) {
    res.status(400).json({ error: input.fileType === "garment_image"
      ? "Choose a JPEG, PNG, or WebP image"
      : "Choose a PDF, Word, Excel, or text document" });
    return;
  }

  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    const actor = getAuditActor(req);
    const [fileRecord] = await db.insert(orderFilesTable).values({
      orderId: params.data.orderId,
      fileType: input.fileType,
      originalName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      objectPath,
      uploadedBy: userId,
      uploadedByName: actor.label,
    }).returning({ id: orderFilesTable.id });
    res.json(RequestOrderFileUploadResponse.parse({ fileId: fileRecord.id, uploadURL }));
  } catch (error) {
    req.log.error({ err: error, orderId: params.data.orderId }, "Failed to prepare order file upload");
    res.status(500).json({ error: "Could not prepare secure file upload" });
  }
});

router.post("/orders/:orderId/files/:fileId/complete", async (req, res): Promise<void> => {
  const params = CompleteOrderFileUploadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db.select().from(orderFilesTable).where(and(
    eq(orderFilesTable.id, params.data.fileId),
    eq(orderFilesTable.orderId, params.data.orderId),
  ));
  if (!record) {
    res.status(404).json({ error: "Order file not found" });
    return;
  }
  if (record.uploadedAt) {
    res.json(CompleteOrderFileUploadResponse.parse(record));
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(record.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== record.sizeBytes || metadata.contentType !== record.contentType) {
      res.status(400).json({ error: "Uploaded file does not match its requested metadata" });
      return;
    }
    const [updated] = await db.update(orderFilesTable)
      .set({ uploadedAt: new Date() })
      .where(and(eq(orderFilesTable.id, record.id), isNull(orderFilesTable.uploadedAt)))
      .returning();
    const completed = updated ?? (await db.select().from(orderFilesTable).where(eq(orderFilesTable.id, record.id)))[0];
    if (!completed?.uploadedAt) {
      res.status(500).json({ error: "Could not finalize uploaded file" });
      return;
    }
    res.json(CompleteOrderFileUploadResponse.parse(completed));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Upload is not present in private storage yet" });
      return;
    }
    req.log.error({ err: error, orderId: record.orderId, fileId: record.id }, "Failed to finalize order file upload");
    res.status(500).json({ error: "Could not confirm uploaded file" });
  }
});

router.get("/orders/:orderId/files/:fileId/content", async (req, res): Promise<void> => {
  await streamOrderFile(req, res, false);
});

router.get("/orders/:orderId/files/:fileId/preview", async (req, res): Promise<void> => {
  await streamOrderFile(req, res, true);
});

export default router;
