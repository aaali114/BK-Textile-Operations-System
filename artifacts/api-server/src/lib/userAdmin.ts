import { asc, eq } from "drizzle-orm";
import { activityTable, db, userAreaAccessTable, userPermissionsTable, usersTable } from "@workspace/db";
import { accessOf, AREAS, PERMISSIONS, type Access, type Area, type Level, type Permission } from "./access";

export class UserAdminError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Starting points by department; the administrator adjusts per person. Never applied automatically. */
export const ACCESS_TEMPLATES: { department: string; areas: Partial<Record<Area, "read" | "write">>; permissions: Permission[] }[] = [
  { department: "merchandising", areas: { dashboard: "read", merchandising: "write", department_work: "read", materials: "read", quality: "read" }, permissions: [] },
  { department: "sampling", areas: { dashboard: "read", department_work: "write", materials: "read" }, permissions: [] },
  { department: "fabrication", areas: { dashboard: "read", department_work: "write", materials: "write", quality: "read" }, permissions: [] },
  { department: "accessories", areas: { dashboard: "read", department_work: "write", materials: "write" }, permissions: [] },
  { department: "greige_warehouse", areas: { dashboard: "read", department_work: "write", materials: "write", quality: "write" }, permissions: [] },
  { department: "dyed_warehouse", areas: { dashboard: "read", department_work: "write", materials: "write", quality: "write" }, permissions: [] },
  ...["cutting", "embellishment", "stitching", "washing", "finishing", "packing"].map((department) => ({
    department,
    areas: { dashboard: "read", department_work: "write", materials: "read" } as Partial<Record<Area, "read" | "write">>,
    permissions: [] as Permission[],
  })),
  { department: "export", areas: { dashboard: "read", department_work: "write" }, permissions: [] },
  { department: "accounts", areas: { dashboard: "read", department_work: "read" }, permissions: [] },
  { department: "admin", areas: { dashboard: "read" }, permissions: [] },
];

export type UserAccount = Awaited<ReturnType<typeof toAccount>>;

async function toAccount(user: typeof usersTable.$inferSelect) {
  const a = await accessOf(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: a.status,
    role: a.role,
    department: user.department,
    areas: a.areas,
    permissions: [...a.permissions].sort(),
    approvedBy: user.approvedBy,
    approvedAt: user.approvedAt,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
  };
}

const label = (u: { name: string | null; email: string | null; id: string }) => u.name || u.email || u.id;

export async function listUsers(): Promise<UserAccount[]> {
  const users = await db.select().from(usersTable).orderBy(asc(usersTable.createdAt));
  // pending first, so approvals are easy to find
  const order = { pending: 0, active: 1, disabled: 2 } as Record<string, number>;
  users.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return Promise.all(users.map(toAccount));
}

async function getTarget(id: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) throw new UserAdminError(404, "User not found. They appear here after their first sign-in.");
  return u;
}

function guardEdit(actor: Access, target: typeof usersTable.$inferSelect) {
  if (!actor.canManageUsers) throw new UserAdminError(403, "Only the administrator or deputy can manage users.");
  if (target.id === actor.userId) throw new UserAdminError(403, "You cannot change your own access.");
  if (target.role === "admin") throw new UserAdminError(403, "The administrator's access cannot be changed. Transfer the administrator role first.");
  if (target.role === "deputy" && actor.role !== "admin") throw new UserAdminError(403, "Only the administrator can change the deputy.");
}

export type AccessUpdate = {
  status?: "active" | "disabled" | "pending";
  department?: string | null;
  areas?: Partial<Record<Area, Level>>;
  permissions?: Permission[];
};

/** Approve/disable a user, set department, and replace their area access and special permissions. Every change is logged. */
export async function updateUserAccess(actor: Access, targetId: string, input: AccessUpdate): Promise<UserAccount> {
  const target = await getTarget(targetId);
  guardEdit(actor, target);
  const before = await toAccount(target);
  const changes: { field: string; from: unknown; to: unknown }[] = [];

  await db.transaction(async (tx) => {
    const set: Partial<typeof usersTable.$inferInsert> = {};
    if (input.status && input.status !== target.status) {
      set.status = input.status;
      if (input.status === "active" && !target.approvedAt) {
        set.approvedBy = label({ name: actor.name, email: actor.email, id: actor.userId });
        set.approvedAt = new Date();
      }
      changes.push({ field: "status", from: target.status, to: input.status });
    }
    if (input.department !== undefined && input.department !== target.department) {
      set.department = input.department;
      changes.push({ field: "department", from: target.department, to: input.department });
    }
    if (Object.keys(set).length) await tx.update(usersTable).set(set).where(eq(usersTable.id, targetId));

    if (input.areas) {
      const current = await tx.select().from(userAreaAccessTable).where(eq(userAreaAccessTable.userId, targetId));
      const prev = Object.fromEntries(AREAS.map((a) => [a, (current.find((r) => r.area === a)?.level as Level) ?? "none"])) as Record<Area, Level>;
      const next = { ...prev };
      for (const area of AREAS) if (input.areas[area] !== undefined) next[area] = input.areas[area]!;
      for (const area of AREAS) if (next[area] !== prev[area]) changes.push({ field: `area.${area}`, from: prev[area], to: next[area] });
      await tx.delete(userAreaAccessTable).where(eq(userAreaAccessTable.userId, targetId));
      const rows = AREAS.filter((a) => next[a] !== "none").map((a) => ({ userId: targetId, area: a, level: next[a], grantedBy: actor.userId }));
      if (rows.length) await tx.insert(userAreaAccessTable).values(rows);
    }

    if (input.permissions) {
      const wanted = [...new Set(input.permissions)].filter((p) => (PERMISSIONS as readonly string[]).includes(p));
      const current = (await tx.select().from(userPermissionsTable).where(eq(userPermissionsTable.userId, targetId))).map((r) => r.permission);
      for (const p of wanted.filter((p) => !current.includes(p))) changes.push({ field: `permission.${p}`, from: "no", to: "granted" });
      for (const p of current.filter((p) => !wanted.includes(p as Permission))) changes.push({ field: `permission.${p}`, from: "granted", to: "no" });
      await tx.delete(userPermissionsTable).where(eq(userPermissionsTable.userId, targetId));
      if (wanted.length) await tx.insert(userPermissionsTable).values(wanted.map((permission) => ({ userId: targetId, permission, grantedBy: actor.userId })));
    }

    if (changes.length) await logUserChange(tx, actor, target, "user.access_changed", changes);
  });
  return toAccount(await getTarget(targetId));
}

/** The administrator appoints or removes the single deputy. */
export async function setUserRole(actor: Access, targetId: string, role: "deputy" | "user"): Promise<UserAccount> {
  if (actor.role !== "admin" || !actor.canManageUsers) throw new UserAdminError(403, "Only the administrator can appoint or remove the deputy.");
  const target = await getTarget(targetId);
  if (target.id === actor.userId) throw new UserAdminError(403, "You cannot change your own role.");
  if (target.role === "admin") throw new UserAdminError(403, "Use the administrator transfer instead.");
  if (target.role === role) return toAccount(target);
  if (role === "deputy") {
    if (target.status !== "active") throw new UserAdminError(409, "Approve the user before making them deputy.");
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.role, "deputy"));
    if (existing) throw new UserAdminError(409, `${label(existing)} is already the deputy. Remove them first.`);
  }
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ role }).where(eq(usersTable.id, targetId));
    await logUserChange(tx, actor, target, "user.role_changed", [{ field: "role", from: target.role, to: role }]);
  });
  return toAccount(await getTarget(targetId));
}

/**
 * Hands the administrator role to another approved user. The previous
 * administrator becomes deputy (the target's deputy seat, or a free one);
 * if the deputy seat is held by someone else, they become a regular user.
 */
export async function transferAdmin(actor: Access, targetId: string): Promise<UserAccount> {
  if (actor.role !== "admin" || !actor.canManageUsers) throw new UserAdminError(403, "Only the administrator can transfer the administrator role.");
  const target = await getTarget(targetId);
  if (target.id === actor.userId) throw new UserAdminError(400, "You are already the administrator.");
  if (target.status !== "active") throw new UserAdminError(409, "Approve the user before making them administrator.");
  await db.transaction(async (tx) => {
    const [deputy] = await tx.select().from(usersTable).where(eq(usersTable.role, "deputy"));
    const deputySeatFree = !deputy || deputy.id === targetId;
    // release the unique seats in a safe order
    await tx.update(usersTable).set({ role: "user" }).where(eq(usersTable.id, actor.userId));
    if (target.role !== "user") await tx.update(usersTable).set({ role: "user" }).where(eq(usersTable.id, targetId));
    await tx.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, targetId));
    await tx.update(usersTable).set({ role: deputySeatFree ? "deputy" : "user" }).where(eq(usersTable.id, actor.userId));
    await logUserChange(tx, actor, target, "user.admin_transferred", [
      { field: "role", from: target.role, to: "admin" },
      { field: `previous administrator ${actor.email ?? actor.userId}`, from: "admin", to: deputySeatFree ? "deputy" : "user" },
    ]);
  });
  return toAccount(await getTarget(targetId));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function logUserChange(tx: Tx, actor: Access, target: typeof usersTable.$inferSelect, action: string, changes: { field: string; from: unknown; to: unknown }[]) {
  await tx.insert(activityTable).values({
    actor: label({ name: actor.name, email: actor.email, id: actor.userId }),
    actorId: actor.userId,
    description: `${label(target)}: ${changes.map((c) => `${c.field} ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; ")}`,
    entityType: "user",
    entityId: target.id,
    source: "staff",
    action,
    details: { changes },
  });
}
