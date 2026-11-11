---
name: Order intake requirements
description: The requested mailbox-based intake workflow for B.K. Textile buyer orders.
---

Buyer orders are extracted from email in the `orders@bktextile.com` mailbox over IMAP, then shown under their respective orders in the register. The first real order is PO 36572 (BK Inv. 4040); real data is allowed for that order only.

The backend (API, DB schema, OpenAPI spec) is owned outside Replit and changed through GitHub pull requests. Replit Agent works on the frontend only.

**Why:** On 2026-11-11 the user switched the protocol back from POP to IMAP, named `orders@bktextile.com` as the mailbox, approved real data for PO 36572, and moved backend ownership out of Replit. This supersedes the earlier POP / shared-mailbox note.

**Update 2026-11-11 (later):** PO number is the key (unique per buyer); one PO = one order = one BK invoice `{n}/BK-{ABBR}/{year}`, sequential across years; no sub-invoices; later email wins; extracted data goes straight into the order during the trial.

**How to apply:** Follow the "Ownership", "Data rules" and "Email intake" sections of `replit.md`. Read IMAP read-only (`BODY.PEEK`, no moves or deletes). Store only PO 36572 messages for now. Keep real data out of git. See `docs/po-36572-intake-db-plan.md` for the planned tables.
