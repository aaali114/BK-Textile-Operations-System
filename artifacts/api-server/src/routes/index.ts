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

/** The API, behind the access guard (default deny; see RULES in lib/access.ts). */
export function createApiRouter(opts: { getUserId?: (req: import("express").Request) => string | null; lookup?: ProfileLookup } = {}): IRouter {
  const router: IRouter = Router();
  router.use(accessGuard(opts));
  router.use(healthRouter);
  router.use(dashboardRouter);
  router.use(ordersRouter);
  router.use(orderFilesRouter);
  router.use(orderDetailRouter);
  router.use(orderEmailsRouter);
  router.use(adminRouter);
  router.use(workRouter);
  router.use(materialsRouter);
  return router;
}

export default createApiRouter();
