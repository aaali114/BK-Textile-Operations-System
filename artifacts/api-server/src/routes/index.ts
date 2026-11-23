import { Router, type IRouter } from "express";
import { accessGuard, type ProfileLookup } from "../lib/access";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import workRouter from "./work";
import materialsRouter from "./materials";
import orderFilesRouter from "./orderFiles";
import orderDetailRouter from "./orderDetail";
import orderEmailsRouter from "./orderEmails";
import adminRouter from "./admin";
import dashboardsRouter from "./dashboards";
import { createDocumentsRouter } from "./documents";
import { createArchiveRouter } from "./archive";
import type { BlobReader, BlobRemover, BlobStore } from "../intake/run";

/** The API, behind the access guard (default deny; see RULES in lib/access.ts). */
export function createApiRouter(opts: { getUserId?: (req: import("express").Request) => string | null; lookup?: ProfileLookup; blobs?: BlobStore & BlobReader & BlobRemover } = {}): IRouter {
  const router: IRouter = Router();
  router.use(accessGuard(opts));
  router.use(healthRouter);
  router.use(dashboardRouter);
  router.use(dashboardsRouter);
  router.use(ordersRouter);
  router.use(orderFilesRouter);
  router.use(orderDetailRouter);
  router.use(orderEmailsRouter);
  router.use(createDocumentsRouter(opts.blobs));
  router.use(createArchiveRouter(opts.blobs));
  router.use(adminRouter);
  router.use(workRouter);
  router.use(materialsRouter);
  return router;
}

export default createApiRouter();
