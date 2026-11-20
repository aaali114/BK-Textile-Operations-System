import { poKey } from "./text";

export type IntakeConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
  /** Emails about these POs are stored (compared with poKey). Empty when allPos is on. */
  poAllowlist: Set<string>;
  /** INTAKE_PO_ALLOWLIST="*": every PO is handled (go-live mode). Requires a start date. */
  allPos: boolean;
  /** INTAKE_START_DATE: mail that reached the mailbox before this moment is skipped. */
  startDate: Date | null;
};

export class IntakeConfigError extends Error {}

/** "2026-11-25" -> midnight at the start of that day in Pakistan time (UTC+5). */
export function parseStartDate(value: string): Date {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const utc = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  // reject dates that roll over (2026-02-30 is not a date)
  const date = utc && utc.toISOString().slice(0, 10) === value.trim() ? new Date(utc.getTime() - 5 * 3600_000) : null;
  if (!date) {
    throw new IntakeConfigError(`INTAKE_START_DATE must be a date like 2026-11-25, not "${value}".`);
  }
  return date;
}

export function readIntakeConfig(env = process.env): IntakeConfig {
  const missing = ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"].filter((k) => !env[k]);
  if (missing.length) throw new IntakeConfigError(`Missing secrets: ${missing.join(", ")}`);
  const raw = (env.INTAKE_PO_ALLOWLIST ?? "").trim();
  const allPos = raw === "*";
  const poAllowlist = allPos ? new Set<string>() : new Set(raw.split(",").map((s) => poKey(s)).filter(Boolean));
  if (!allPos && !poAllowlist.size) {
    throw new IntakeConfigError('INTAKE_PO_ALLOWLIST is not set: list the PO numbers the intake may store (e.g. 36572), or "*" for all POs.');
  }
  const startDate = env.INTAKE_START_DATE?.trim() ? parseStartDate(env.INTAKE_START_DATE) : null;
  if (allPos && !startDate) {
    throw new IntakeConfigError(
      'INTAKE_PO_ALLOWLIST is "*" (all POs) but INTAKE_START_DATE is not set. Set it (e.g. 2026-11-25) so older mail does not become orders.',
    );
  }
  return {
    host: env.IMAP_HOST!,
    port: Number(env.IMAP_PORT || 993),
    user: env.IMAP_USER!,
    password: env.IMAP_PASSWORD!,
    folder: env.INTAKE_FOLDER || "INBOX",
    poAllowlist,
    allPos,
    startDate,
  };
}
