import { getAuth } from "@clerk/express";
import type { Request } from "express";

export function getAuditActor(req: Request): { id: string; label: string } {
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
