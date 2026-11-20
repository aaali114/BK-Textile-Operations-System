import { eq, sql } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { db, userAreaAccessTable, userPermissionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

export const AREAS = ["dashboard", "merchandising", "department_work", "materials", "quality"] as const;
export const PERMISSIONS = ["invoice_override", "commercial_edit", "intake_run"] as const;
export type Area = (typeof AREAS)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type Level = "none" | "read" | "write";

export type Access = {
  userId: string;
  email: string | null;
  name: string | null;
  status: "pending" | "active" | "disabled";
  role: "admin" | "deputy" | "user";
  department: string | null;
  areas: Record<Area, Level>;
  permissions: Set<Permission>;
  /** Active administrator or deputy: approves users and grants access. */
  canManageUsers: boolean;
};

type Requirement =
  | { public: true }
  | { anyStatus: true }
  | { area: Area; level: "read" | "write"; permission?: Permission }
  | { permission: Permission }
  | { manageUsers: true };

/**
 * Every API route and what it needs. Anything not listed is refused
 * (default deny), so a new endpoint is never reachable by accident.
 */
export const RULES: [method: string, path: RegExp, need: Requirement][] = [
  ["GET", /^\/healthz$/, { public: true }],
  ["GET", /^\/me$/, { anyStatus: true }],
  // dashboard
  ["GET", /^\/dashboard\/summary$/, { area: "dashboard", level: "read" }],
  ["GET", /^\/activity$/, { area: "dashboard", level: "read" }],
  // customisable dashboards: personal ones need dashboard access; each data source also checks its own area
  ["GET", /^\/dashboard\/sources$/, { area: "dashboard", level: "read" }],
  ["POST", /^\/dashboard\/sources\/[^/]+\/data$/, { area: "dashboard", level: "read" }],
  ["GET", /^\/dashboards$/, { area: "dashboard", level: "read" }],
  ["POST", /^\/dashboards$/, { area: "dashboard", level: "read" }],
  ["PUT", /^\/dashboards\/[^/]+$/, { area: "dashboard", level: "read" }],
  ["DELETE", /^\/dashboards\/[^/]+$/, { area: "dashboard", level: "read" }],
  ["GET", /^\/admin\/dashboard-templates$/, { manageUsers: true }],
  ["PUT", /^\/admin\/dashboard-templates\/[^/]+$/, { manageUsers: true }],
  ["DELETE", /^\/admin\/dashboard-templates\/[^/]+$/, { manageUsers: true }],
  // merchandising: orders and everything under an order
  ["GET", /^\/buyers$/, { area: "merchandising", level: "read" }],
  ["GET", /^\/orders$/, { area: "merchandising", level: "read" }],
  ["POST", /^\/orders$/, { area: "merchandising", level: "write", permission: "commercial_edit" }],
  ["GET", /^\/orders\/[^/]+(\/(activity|breakdown|fabrics|trims|emails|files))?$/, { area: "merchandising", level: "read" }],
  ["GET", /^\/orders\/[^/]+\/emails\/[^/]+(\/attachments\/[^/]+\/content)?$/, { area: "merchandising", level: "read" }],
  ["GET", /^\/orders\/[^/]+\/files\/[^/]+\/(content|preview)$/, { area: "merchandising", level: "read" }],
  ["PATCH", /^\/orders\/[^/]+$/, { area: "merchandising", level: "write" }], // commercial fields also need commercial_edit (checked in the route)
  ["PATCH", /^\/orders\/[^/]+\/emails\/[^/]+$/, { area: "merchandising", level: "write" }],
  ["POST", /^\/orders\/[^/]+\/files\/(upload-url|[^/]+\/complete)$/, { area: "merchandising", level: "write" }],
  // departments, materials, quality
  ["GET", /^\/work-items$/, { area: "department_work", level: "read" }],
  ["PATCH", /^\/work-items\/[^/]+$/, { area: "department_work", level: "write" }],
  ["GET", /^\/materials$/, { area: "materials", level: "read" }],
  ["POST", /^\/materials$/, { area: "materials", level: "write" }],
  ["GET", /^\/inspections$/, { area: "quality", level: "read" }],
  ["POST", /^\/inspections$/, { area: "quality", level: "write" }],
  // special permissions
  ["GET", /^\/admin\/invoice-counter$/, { permission: "invoice_override" }],
  ["PUT", /^\/admin\/invoice-counter$/, { permission: "invoice_override" }],
  ["PUT", /^\/admin\/orders\/[^/]+\/invoice$/, { permission: "invoice_override" }],
  ["POST", /^\/admin\/intake\/run$/, { permission: "intake_run" }],
  ["POST", /^\/admin\/orders\/[^/]+\/reapply-emails$/, { permission: "intake_run" }],
  // user administration
  ["GET", /^\/admin\/users$/, { manageUsers: true }],
  ["GET", /^\/admin\/access-templates$/, { manageUsers: true }],
  ["PUT", /^\/admin\/users\/[^/]+\/(access|role)$/, { manageUsers: true }],
  ["POST", /^\/admin\/users\/[^/]+\/make-admin$/, { manageUsers: true }],
];

export function ruleFor(method: string, path: string): Requirement | null {
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return RULES.find(([rm, re]) => rm === m && re.test(path))?.[2] ?? null;
}

const LEVEL_RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };
export const hasArea = (a: Access, area: Area, level: "read" | "write") => LEVEL_RANK[a.areas[area]] >= LEVEL_RANK[level];
export const hasPermission = (a: Access, p: Permission) => a.permissions.has(p);

export function allows(a: Access, need: Requirement): boolean {
  if ("public" in need || "anyStatus" in need) return true;
  if (a.status !== "active") return false;
  if ("manageUsers" in need) return a.canManageUsers;
  if ("area" in need) return hasArea(a, need.area, need.level) && (!need.permission || hasPermission(a, need.permission));
  return hasPermission(a, need.permission);
}

export type ProfileLookup = (userId: string) => Promise<{ email: string | null; name: string | null }>;

export const clerkProfile: ProfileLookup = async (userId) => {
  const u = await clerkClient.users.getUser(userId);
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
  return { email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null, name };
};

/**
 * Loads (and on first sign-in, records) the user with their access. While no
 * administrator exists yet, a user listed in ADMIN_USER_IDS becomes the
 * administrator on sign-in (one-time setup); after that the database decides.
 */
export async function loadAccess(userId: string, lookup: ProfileLookup = clerkProfile): Promise<Access> {
  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.email) {
    const profile = await lookup(userId).catch((err) => {
      logger.warn({ err: (err as Error).message }, "Could not read the user's profile from Clerk");
      return { email: null, name: null };
    });
    [user] = await db
      .insert(usersTable)
      .values({ id: userId, email: profile.email, name: profile.name })
      .onConflictDoUpdate({ target: usersTable.id, set: { email: sql`coalesce(${usersTable.email}, excluded.email)`, name: sql`coalesce(${usersTable.name}, excluded.name)` } })
      .returning();
  }
  if (user!.role !== "admin" && bootstrapAdminIds().has(userId)) {
    const [anyAdmin] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    if (!anyAdmin) {
      [user] = await db
        .update(usersTable)
        .set({ role: "admin", status: "active", approvedBy: "setup (ADMIN_USER_IDS)", approvedAt: new Date() })
        .where(eq(usersTable.id, userId))
        .returning();
      logger.info({ userId }, "First administrator set up from ADMIN_USER_IDS");
    }
  }
  if (!user!.lastSeenAt || Date.now() - user!.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
  }
  return accessOf(user!);
}

export async function accessOf(user: typeof usersTable.$inferSelect): Promise<Access> {
  const active = user.status === "active";
  const managers = active && (user.role === "admin" || user.role === "deputy");
  const areas = Object.fromEntries(AREAS.map((a) => [a, "none"])) as Record<Area, Level>;
  const permissions = new Set<Permission>();
  if (managers) {
    for (const a of AREAS) areas[a] = "write";
    for (const p of PERMISSIONS) permissions.add(p);
  } else if (active) {
    const [rows, perms] = await Promise.all([
      db.select().from(userAreaAccessTable).where(eq(userAreaAccessTable.userId, user.id)),
      db.select().from(userPermissionsTable).where(eq(userPermissionsTable.userId, user.id)),
    ]);
    for (const r of rows) if ((AREAS as readonly string[]).includes(r.area)) areas[r.area as Area] = r.level as Level;
    for (const p of perms) if ((PERMISSIONS as readonly string[]).includes(p.permission)) permissions.add(p.permission as Permission);
  }
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    status: user.status as Access["status"],
    role: user.role as Access["role"],
    department: user.department,
    areas,
    permissions,
    canManageUsers: managers,
  };
}

function bootstrapAdminIds(): Set<string> {
  return new Set((process.env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export function accessFrom(res: Response): Access | undefined {
  return res.locals.access as Access | undefined;
}

/** The API's gatekeeper: signed in, recorded, approved, and allowed by RULES. */
export function accessGuard(opts: { getUserId?: (req: Request) => string | null; lookup?: ProfileLookup } = {}) {
  const getUserId = opts.getUserId ?? ((req: Request) => getAuth(req).userId ?? null);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const need = ruleFor(req.method, req.path);
    if (!need) {
      res.status(403).json({ error: "This action is not available." });
      return;
    }
    if ("public" in need) return next();
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    try {
      const access = await loadAccess(userId, opts.lookup);
      res.locals.access = access;
      if (allows(access, need)) return next();
      if (access.status === "pending") res.status(403).json({ error: "Your account is waiting for administrator approval.", code: "pending_approval" });
      else if (access.status === "disabled") res.status(403).json({ error: "Your account has been disabled. Contact the administrator.", code: "disabled" });
      else res.status(403).json({ error: "You do not have access to this. Ask the administrator.", code: "forbidden" });
    } catch (err) {
      next(err);
    }
  };
}

/** Which activity-feed entries a user may see, by what the entry is about. */
export function canSeeActivity(a: Access, entityType: string): boolean {
  if (a.canManageUsers) return true;
  switch (entityType) {
    case "order":
    case "source_email":
    case "intake":
      return hasArea(a, "merchandising", "read");
    case "invoice_counter":
      return hasPermission(a, "invoice_override");
    case "work_item":
      return hasArea(a, "department_work", "read");
    case "material":
      return hasArea(a, "materials", "read");
    case "inspection":
      return hasArea(a, "quality", "read");
    default:
      return false;
  }
}

