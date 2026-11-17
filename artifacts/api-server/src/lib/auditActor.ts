import { getAuth } from "@clerk/express";
import type { Request } from "express";
import type { Access } from "./access";

/** Who is acting, for the change log: the user's name or email from bk_users, else Clerk's session. */
export function getAuditActor(req: Request): { id: string; label: string } {
  const access = req.res?.locals.access as Access | undefined;
  if (access) return { id: access.userId, label: access.name || access.email || access.userId };
  const auth = getAuth(req);
  const claims = auth.sessionClaims as Record<string, unknown> | null;
  const firstName = typeof claims?.first_name === "string" ? claims.first_name : "";
  const lastName = typeof claims?.last_name === "string" ? claims.last_name : "";
  const name = `${firstName} ${lastName}`.trim();
  const email = [claims?.email_address, claims?.email].find((value) => typeof value === "string");
  return {
    id: auth.userId ?? "unknown",
    label: name || (typeof email === "string" ? email : auth.userId ?? "Unknown user"),
  };
}
