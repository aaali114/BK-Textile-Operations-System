import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

/**
 * Admins are listed by Clerk user ID in the ADMIN_USER_IDS environment
 * variable (comma-separated). A signed-in user can see their own ID at
 * GET /api/me. With the variable unset, nobody is an admin.
 */
export function adminUserIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function isAdmin(req: Request): boolean {
  const userId = getAuth(req).userId;
  return !!userId && adminUserIds().has(userId);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Only administrators can do this." });
    return;
  }
  next();
}
