import { ImapFlow } from "imapflow";
import type { IntakeConfig } from "./config";
import type { Envelope, MailSource } from "./run";

/**
 * Read-only IMAP source. The folder is opened with EXAMINE (read-only) and
 * messages are fetched with BODY.PEEK, so nothing is marked read, moved,
 * flagged or deleted. Only envelopes are fetched for screening; the full
 * message is downloaded only for candidates.
 */
export class ImapMailSource implements MailSource {
  readonly mailbox: string;
  readonly folder: string;
  private client: ImapFlow;
  private release: (() => void) | null = null;

  constructor(private config: IntakeConfig) {
    this.mailbox = config.user;
    this.folder = config.folder;
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.port === 993,
      auth: { user: config.user, pass: config.password },
      logger: false,
      emitLogs: false,
    });
  }

  async open(): Promise<{ uidValidity: number }> {
    await this.client.connect();
    const lock = await this.client.getMailboxLock(this.folder, { readOnly: true });
    this.release = () => lock.release();
    const mailbox = this.client.mailbox;
    if (!mailbox || typeof mailbox === "boolean") throw new Error(`Could not open ${this.folder}`);
    return { uidValidity: Number(mailbox.uidValidity) };
  }

  async listAfter(afterUid: number): Promise<Envelope[]> {
    const out: Envelope[] = [];
    for await (const msg of this.client.fetch(`${afterUid + 1}:*`, { uid: true, envelope: true, headers: ["references"] }, { uid: true })) {
      if (msg.uid <= afterUid) continue; // "N:*" returns the last message even when it is older than N
      const refs = msg.headers?.toString("utf8").match(/<[^>]+>/g) ?? [];
      out.push({
        uid: msg.uid,
        subject: msg.envelope?.subject ?? "",
        messageId: msg.envelope?.messageId ?? null,
        inReplyTo: msg.envelope?.inReplyTo ?? null,
        references: refs,
        fromAddress: (msg.envelope?.from?.[0]?.address ?? "").toLowerCase(),
        internalDate: msg.internalDate ? new Date(msg.internalDate) : null,
      });
    }
    return out;
  }

  async fetchRaw(uid: number): Promise<Buffer> {
    const msg = await this.client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) throw new Error(`Message UID ${uid} could not be downloaded`);
    return msg.source;
  }

  async close(): Promise<void> {
    this.release?.();
    await this.client.logout().catch(() => this.client.close());
  }
}
