import express, { Router, type IRouter, type Request, type Response } from "express";
import {
  ArchiveOrderBody,
  ArchiveOrderDocumentParams,
  ArchiveOrderEmailParams,
  ArchiveOrderEmailResponse,
  ArchiveOrderFileParams,
  ArchiveOrderParams,
  ArchiveOrderResponse,
  ListBinResponse,
  PurgeBinItemParams,
  RestoreOrderDocumentParams,
  RestoreOrderEmailParams,
  RestoreOrderEmailResponse,
  RestoreOrderFileParams,
  RestoreOrderParams,
  RestoreOrderResponse,
  UploadOrderEmailBody,
  UploadOrderEmailParams,
  UploadOrderEmailResponse,
} from "@workspace/api-zod";
import { accessFrom } from "../lib/access";
import {
  ArchiveError,
  archiveDocument,
  archiveFile,
  archiveOrder,
  listBin,
  purgeFromBin,
  restoreDocument,
  restoreFile,
  restoreOrder,
  setEmailLink,
  uploadEmail,
  type Blobs,
} from "../lib/archive";
import { objectStorageBlobs } from "../intake/service";

/** Delete (move to the Bin), restore, purge, and adding emails by upload. Access rules are in lib/access.ts. */
export function createArchiveRouter(blobs: Blobs = objectStorageBlobs): IRouter {
  const router: IRouter = Router();

  const run = (handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof ArchiveError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  };
  const reasonOf = (req: Request) => {
    const body = ArchiveOrderBody.safeParse(req.body ?? {});
    return body.success ? (body.data.reason ?? null) : null;
  };
  const bad = (res: Response, message: string) => void res.status(400).json({ error: message });

  // ---- orders
  router.post("/orders/:orderId/archive", run(async (req, res) => {
    const p = ArchiveOrderParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    res.json(ArchiveOrderResponse.parse(await archiveOrder(accessFrom(res)!, p.data.orderId, reasonOf(req))));
  }));
  router.post("/orders/:orderId/restore", run(async (req, res) => {
    const p = RestoreOrderParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    res.json(RestoreOrderResponse.parse(await restoreOrder(accessFrom(res)!, p.data.orderId)));
  }));

  // ---- images and files
  router.post("/orders/:orderId/files/:fileId/archive", run(async (req, res) => {
    const p = ArchiveOrderFileParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    await archiveFile(accessFrom(res)!, p.data.orderId, p.data.fileId, reasonOf(req));
    res.status(204).end();
  }));
  router.post("/orders/:orderId/files/:fileId/restore", run(async (req, res) => {
    const p = RestoreOrderFileParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    await restoreFile(accessFrom(res)!, p.data.orderId, p.data.fileId);
    res.status(204).end();
  }));

  // ---- documents
  router.post("/orders/:orderId/documents/:documentId/archive", run(async (req, res) => {
    const p = ArchiveOrderDocumentParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    await archiveDocument(accessFrom(res)!, p.data.orderId, p.data.documentId, reasonOf(req));
    res.status(204).end();
  }));
  router.post("/orders/:orderId/documents/:documentId/restore", run(async (req, res) => {
    const p = RestoreOrderDocumentParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    await restoreDocument(accessFrom(res)!, p.data.orderId, p.data.documentId);
    res.status(204).end();
  }));

  // ---- emails: upload (.eml), remove, restore; each rebuilds the order's email data
  router.post("/orders/:orderId/emails", express.json({ limit: "36mb" }), run(async (req, res) => {
    const p = UploadOrderEmailParams.safeParse(req.params);
    const body = UploadOrderEmailBody.safeParse(req.body);
    if (!p.success || !body.success) return bad(res, "Choose an .eml file to upload.");
    const result = await uploadEmail(accessFrom(res)!, p.data.orderId, body.data, blobs);
    res.json(UploadOrderEmailResponse.parse(result));
  }));
  router.post("/orders/:orderId/emails/:emailId/archive", run(async (req, res) => {
    const p = ArchiveOrderEmailParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    const report = await setEmailLink(accessFrom(res)!, p.data.orderId, p.data.emailId, "ignored", reasonOf(req), blobs);
    if (!report) throw new ArchiveError(409, "The email is already removed from this order.");
    res.json(ArchiveOrderEmailResponse.parse(report));
  }));
  router.post("/orders/:orderId/emails/:emailId/restore", run(async (req, res) => {
    const p = RestoreOrderEmailParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    const report = await setEmailLink(accessFrom(res)!, p.data.orderId, p.data.emailId, "matched", null, blobs);
    if (!report) throw new ArchiveError(409, "The email is already on this order.");
    res.json(RestoreOrderEmailResponse.parse(report));
  }));

  // ---- the Bin
  router.get("/bin", run(async (_req, res) => {
    res.json(ListBinResponse.parse(await listBin(accessFrom(res)!)));
  }));
  router.delete("/admin/bin/:kind/:orderId/:itemId", run(async (req, res) => {
    const p = PurgeBinItemParams.safeParse(req.params);
    if (!p.success) return bad(res, p.error.message);
    await purgeFromBin(accessFrom(res)!, p.data.kind, p.data.orderId, p.data.itemId, blobs);
    res.status(204).end();
  }));

  return router;
}
