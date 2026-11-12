import { readIntakeConfig } from "./config";
import { ImapMailSource } from "./imap";
import { runIntake, type BlobReader, type BlobStore } from "./run";
import { reapplyOrderEmails } from "./reapply";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const storage = new ObjectStorageService();
export const objectStorageBlobs: BlobStore & BlobReader = {
  put: (content, contentType) => storage.saveObjectEntity(content, contentType, "intake"),
  get: (objectPath) => storage.readObjectEntity(objectPath),
};

export function reapplyOrder(orderId: string, actor: { id: string; label: string }) {
  return reapplyOrderEmails(orderId, objectStorageBlobs, actor);
}

/** One run against the real mailbox using the Replit secrets. */
export async function runMailboxIntake(opts: { dryRun: boolean; rescanFromUid?: number }) {
  const config = readIntakeConfig();
  return runIntake({ source: new ImapMailSource(config), blobs: objectStorageBlobs, poAllowlist: config.poAllowlist, ...opts });
}

/** Optional schedule: set INTAKE_POLL_MINUTES (e.g. 15) to read the mailbox automatically. Off by default. */
export function startIntakeSchedule(): void {
  const minutes = Number(process.env.INTAKE_POLL_MINUTES || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const every = Math.max(5, minutes) * 60_000;
  logger.info({ minutes: every / 60_000 }, "Email intake schedule on");
  setInterval(() => {
    runMailboxIntake({ dryRun: false })
      .then((s) => logger.info({ scanned: s.scanned, stored: s.stored, skipped: s.skipped, errors: s.errors.length }, "Scheduled email intake run"))
      .catch((err) => logger.warn({ err: (err as Error).message }, "Scheduled email intake run failed"));
  }, every).unref();
}
