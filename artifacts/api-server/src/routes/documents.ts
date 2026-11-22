import { Router, type IRouter, type Response } from "express";
import {
  ApproveOrderDocumentBody, ApproveOrderDocumentParams, ApproveOrderDocumentResponse,
  CreateOrderDocumentBody, CreateOrderDocumentParams, CreateOrderDocumentResponse,
  DownloadOrderDocumentFileParams,
  GetCompanyProfileResponse, GetOrderDocumentParams, GetOrderDocumentResponse,
  ListDocumentsAwaitingApprovalResponse, ListOrderDocumentsParams, ListOrderDocumentsResponse,
  RequestOrderDocumentChangesBody, RequestOrderDocumentChangesParams, RequestOrderDocumentChangesResponse,
  SaveCompanyProfileBody, SaveCompanyProfileResponse, SetOrderResponsibleBody, SetOrderResponsibleParams,
  SubmitOrderDocumentParams, SubmitOrderDocumentResponse, UpdateOrderDocumentBody, UpdateOrderDocumentParams, UpdateOrderDocumentResponse,
} from "@workspace/api-zod";
import { accessFrom } from "../lib/access";
import { objectStorageBlobs } from "../intake/service";
import {
  approveDocument, awaitingApproval, createDocument, documentFile, DocumentError, getCompanyProfile, getDocument,
  listDocuments, requestChanges, saveCompanyProfile, setResponsible, submitDocument, updateDocument,
} from "../documents/service";
import type { BlobReader, BlobStore } from "../intake/run";

/** Routes for generated documents. Blob storage is injectable for tests. */
export function createDocumentsRouter(blobs: BlobStore & BlobReader = objectStorageBlobs): IRouter {
  const router: IRouter = Router();
  const fail = (res: Response, e: unknown) => {
    if (e instanceof DocumentError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw e;
  };
  const bad = (res: Response) => res.status(400).json({ error: "Invalid request" });

  router.get("/orders/:orderId/documents", async (req, res) => {
    const p = ListOrderDocumentsParams.safeParse(req.params);
    if (!p.success) return void bad(res);
    try { res.json(ListOrderDocumentsResponse.parse(await listDocuments(accessFrom(res)!, p.data.orderId))); } catch (e) { fail(res, e); }
  });
  router.post("/orders/:orderId/documents", async (req, res) => {
    const p = CreateOrderDocumentParams.safeParse(req.params); const b = CreateOrderDocumentBody.safeParse(req.body);
    if (!p.success || !b.success) return void bad(res);
    try { res.status(201).json(CreateOrderDocumentResponse.parse(await createDocument(accessFrom(res)!, p.data.orderId, b.data.type))); } catch (e) { fail(res, e); }
  });
  router.get("/orders/:orderId/documents/:documentId", async (req, res) => {
    const p = GetOrderDocumentParams.safeParse(req.params);
    if (!p.success) return void bad(res);
    try { res.json(GetOrderDocumentResponse.parse(await getDocument(accessFrom(res)!, p.data.orderId, p.data.documentId))); } catch (e) { fail(res, e); }
  });
  router.patch("/orders/:orderId/documents/:documentId", async (req, res) => {
    const p = UpdateOrderDocumentParams.safeParse(req.params); const b = UpdateOrderDocumentBody.safeParse(req.body);
    if (!p.success || !b.success) return void bad(res);
    try { res.json(UpdateOrderDocumentResponse.parse(await updateDocument(accessFrom(res)!, p.data.orderId, p.data.documentId, b.data as never))); } catch (e) { fail(res, e); }
  });
  router.post("/orders/:orderId/documents/:documentId/submit", async (req, res) => {
    const p = SubmitOrderDocumentParams.safeParse(req.params);
    if (!p.success) return void bad(res);
    try { res.json(SubmitOrderDocumentResponse.parse(await submitDocument(accessFrom(res)!, p.data.orderId, p.data.documentId))); } catch (e) { fail(res, e); }
  });
  router.post("/orders/:orderId/documents/:documentId/request-changes", async (req, res) => {
    const p = RequestOrderDocumentChangesParams.safeParse(req.params); const b = RequestOrderDocumentChangesBody.safeParse(req.body);
    if (!p.success || !b.success) return void bad(res);
    try { res.json(RequestOrderDocumentChangesResponse.parse(await requestChanges(accessFrom(res)!, p.data.orderId, p.data.documentId, b.data.note))); } catch (e) { fail(res, e); }
  });
  router.post("/orders/:orderId/documents/:documentId/approve", async (req, res) => {
    const p = ApproveOrderDocumentParams.safeParse(req.params); const b = ApproveOrderDocumentBody.safeParse(req.body ?? {});
    if (!p.success || !b.success) return void bad(res);
    try {
      const doc = await approveDocument(accessFrom(res)!, p.data.orderId, p.data.documentId, b.data.note ?? null, blobs);
      req.log.info({ documentId: doc.id }, "Document approved");
      res.json(ApproveOrderDocumentResponse.parse(doc));
    } catch (e) { fail(res, e); }
  });
  router.get("/orders/:orderId/documents/:documentId/files/:format", async (req, res) => {
    const p = DownloadOrderDocumentFileParams.safeParse(req.params);
    if (!p.success) return void bad(res);
    const q = { data: { format: p.data.format } };
    try {
      const f = await documentFile(accessFrom(res)!, p.data.orderId, p.data.documentId, q.data.format, blobs);
      res.setHeader("Content-Type", q.data.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${f.filename.replace(/[^\x20-\x7e]|["\;]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(f.content);
    } catch (e) { fail(res, e); }
  });
  router.get("/documents/awaiting-approval", async (_req, res) => {
    res.json(ListDocumentsAwaitingApprovalResponse.parse(await awaitingApproval(accessFrom(res)!)));
  });
  router.put("/orders/:orderId/responsible", async (req, res) => {
    const p = SetOrderResponsibleParams.safeParse(req.params); const b = SetOrderResponsibleBody.safeParse(req.body);
    if (!p.success || !b.success) return void bad(res);
    try { await setResponsible(accessFrom(res)!, p.data.orderId, b.data.userId ?? null); res.status(204).end(); } catch (e) { fail(res, e); }
  });
  router.get("/admin/company-profile", async (_req, res) => {
    res.json(GetCompanyProfileResponse.parse(await getCompanyProfile()));
  });
  router.put("/admin/company-profile", async (req, res) => {
    const b = SaveCompanyProfileBody.safeParse(req.body);
    if (!b.success) return void bad(res);
    res.json(SaveCompanyProfileResponse.parse(await saveCompanyProfile(accessFrom(res)!, b.data)));
  });
  return router;
}

export default createDocumentsRouter;
