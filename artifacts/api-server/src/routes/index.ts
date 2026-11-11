import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import workRouter from "./work";
import materialsRouter from "./materials";
import orderFilesRouter from "./orderFiles";
import orderDetailRouter from "./orderDetail";
import orderEmailsRouter from "./orderEmails";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use((req, res, next) => {
  if (req.path === "/healthz") {
    next();
    return;
  }
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
});

router.use(healthRouter);
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(orderFilesRouter);
router.use(orderDetailRouter);
router.use(orderEmailsRouter);
router.use(adminRouter);
router.use(workRouter);
router.use(materialsRouter);

export default router;
