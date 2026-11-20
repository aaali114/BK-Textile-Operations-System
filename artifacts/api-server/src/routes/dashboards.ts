import { Router, type IRouter, type Response } from "express";
import {
  CreateDashboardBody,
  CreateDashboardResponse,
  DeleteDashboardParams,
  DeleteDashboardTemplateParams,
  GetDashboardSourceDataBody,
  GetDashboardSourceDataParams,
  GetDashboardSourceDataResponse,
  ListDashboardSourcesResponse,
  ListDashboardsResponse,
  ListDashboardTemplatesResponse,
  SaveDashboardTemplateBody,
  SaveDashboardTemplateParams,
  SaveDashboardTemplateResponse,
  UpdateDashboardBody,
  UpdateDashboardParams,
  UpdateDashboardResponse,
} from "@workspace/api-zod";
import { accessFrom } from "../lib/access";
import { canUseSource, resolveParams, runSource, sourceById, SOURCES } from "../lib/dashboardSources";
import {
  createDashboard,
  DashboardError,
  deleteDashboard,
  deleteTemplate,
  listDashboards,
  listTemplates,
  saveTemplate,
  updateDashboard,
} from "../lib/dashboards";

const router: IRouter = Router();

function fail(res: Response, error: unknown): void {
  if (error instanceof DashboardError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

router.get("/dashboard/sources", (_req, res): void => {
  const a = accessFrom(res)!;
  const list = SOURCES.filter((s) => canUseSource(a, s)).map(({ run: _run, ...s }) => s);
  res.json(ListDashboardSourcesResponse.parse(list));
});

router.post("/dashboard/sources/:sourceId/data", async (req, res): Promise<void> => {
  const params = GetDashboardSourceDataParams.safeParse(req.params);
  const body = GetDashboardSourceDataBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid data request" });
    return;
  }
  const source = sourceById(params.data.sourceId);
  if (!source) {
    res.status(404).json({ error: "Unknown data source" });
    return;
  }
  const a = accessFrom(res)!;
  if (!canUseSource(a, source)) {
    res.status(403).json({ error: `You do not have access to "${source.title}".`, code: "forbidden" });
    return;
  }
  const resolved = resolveParams(source, (body.data.params ?? {}) as Record<string, unknown>);
  if (typeof resolved === "string") {
    res.status(400).json({ error: resolved });
    return;
  }
  res.json(GetDashboardSourceDataResponse.parse(await runSource(a, source, resolved)));
});

router.get("/dashboards", async (_req, res): Promise<void> => {
  res.json(ListDashboardsResponse.parse(await listDashboards(accessFrom(res)!)));
});

router.post("/dashboards", async (req, res): Promise<void> => {
  const body = CreateDashboardBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A dashboard needs a name and a layout." });
    return;
  }
  try {
    res.status(201).json(CreateDashboardResponse.parse(await createDashboard(accessFrom(res)!, body.data)));
  } catch (e) {
    fail(res, e);
  }
});

router.put("/dashboards/:dashboardId", async (req, res): Promise<void> => {
  const params = UpdateDashboardParams.safeParse(req.params);
  const body = UpdateDashboardBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid dashboard update" });
    return;
  }
  try {
    res.json(UpdateDashboardResponse.parse(await updateDashboard(accessFrom(res)!, params.data.dashboardId, body.data)));
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/dashboards/:dashboardId", async (req, res): Promise<void> => {
  const params = DeleteDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid dashboard id" });
    return;
  }
  try {
    await deleteDashboard(accessFrom(res)!, params.data.dashboardId);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

router.get("/admin/dashboard-templates", async (_req, res): Promise<void> => {
  res.json(ListDashboardTemplatesResponse.parse(await listTemplates(accessFrom(res)!)));
});

router.put("/admin/dashboard-templates/:department", async (req, res): Promise<void> => {
  const params = SaveDashboardTemplateParams.safeParse(req.params);
  const body = SaveDashboardTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A template needs a name and a layout." });
    return;
  }
  try {
    res.json(SaveDashboardTemplateResponse.parse(await saveTemplate(accessFrom(res)!, params.data.department, body.data)));
  } catch (e) {
    fail(res, e);
  }
});

router.delete("/admin/dashboard-templates/:department", async (req, res): Promise<void> => {
  const params = DeleteDashboardTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid department" });
    return;
  }
  try {
    await deleteTemplate(accessFrom(res)!, params.data.department);
    res.status(204).end();
  } catch (e) {
    fail(res, e);
  }
});

export default router;
