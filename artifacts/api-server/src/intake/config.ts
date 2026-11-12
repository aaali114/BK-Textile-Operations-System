import { poKey } from "./text";

export type IntakeConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
  /** Only emails about these POs are stored (compared with poKey). Required: the trial is limited to approved POs. */
  poAllowlist: Set<string>;
};

export class IntakeConfigError extends Error {}

export function readIntakeConfig(env = process.env): IntakeConfig {
  const missing = ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"].filter((k) => !env[k]);
  if (missing.length) throw new IntakeConfigError(`Missing secrets: ${missing.join(", ")}`);
  const poAllowlist = new Set((env.INTAKE_PO_ALLOWLIST ?? "").split(",").map((s) => poKey(s)).filter(Boolean));
  if (!poAllowlist.size) {
    throw new IntakeConfigError("INTAKE_PO_ALLOWLIST is not set: list the PO numbers the intake may store (e.g. 36572).");
  }
  return {
    host: env.IMAP_HOST!,
    port: Number(env.IMAP_PORT || 993),
    user: env.IMAP_USER!,
    password: env.IMAP_PASSWORD!,
    folder: env.INTAKE_FOLDER || "INBOX",
    poAllowlist,
  };
}
