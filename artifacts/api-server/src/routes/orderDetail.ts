import { Router, type IRouter } from "express";
import {
  GetOrderBreakdownParams,
  GetOrderBreakdownResponse,
  GetOrderFabricsParams,
  GetOrderFabricsResponse,
  GetOrderTrimsParams,
  GetOrderTrimsResponse,
} from "@workspace/api-zod";
import { getOrderBreakdown, getOrderFabrics, getOrderTrims, orderExists } from "../lib/orderDetail";

const router: IRouter = Router();

router.get("/orders/:orderId/breakdown", async (req, res): Promise<void> => {
  const params = GetOrderBreakdownParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const breakdown = await getOrderBreakdown(params.data.orderId);
  if (!breakdown) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(GetOrderBreakdownResponse.parse(breakdown));
});

router.get("/orders/:orderId/fabrics", async (req, res): Promise<void> => {
  const params = GetOrderFabricsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await orderExists(params.data.orderId))) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(GetOrderFabricsResponse.parse(await getOrderFabrics(params.data.orderId)));
});

router.get("/orders/:orderId/trims", async (req, res): Promise<void> => {
  const params = GetOrderTrimsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await orderExists(params.data.orderId))) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(GetOrderTrimsResponse.parse(await getOrderTrims(params.data.orderId)));
});

export default router;
