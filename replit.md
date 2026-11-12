# B.K. Textile Operations

A new B.K. Textile-owned web system for coordinating garment orders, department work, material receipts, inspections, and production handoffs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run migrate` — apply SQL migrations from `lib/db/migrations` (runs automatically in `scripts/post-merge.sh`)
- `pnpm --filter @workspace/db run generate -- --name <change>` — generate a new migration after a schema change (backend only)
- Database changes belong to the backend developer and arrive as reviewed migrations. Replit Agent must not run `push`, `push-force` or `generate`.
- Required env: `DATABASE_URL` — Postgres connection string
- Email intake env: `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` (secrets) and `INTAKE_PO_ALLOWLIST` (required, comma-separated PO numbers the intake may store, e.g. `36572`). Optional: `INTAKE_FOLDER` (default `INBOX`), `INTAKE_POLL_MINUTES` (automatic runs; unset = only manual runs).
- Optional env: `ADMIN_USER_IDS` — comma-separated Clerk user IDs allowed to use `/api/admin/*` (invoice overrides). A signed-in user sees their own ID at `/api/me`. Unset = nobody is an admin.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/bk-textile` — staff-facing web application and interface
- `artifacts/api-server` — authenticated API and operational routes
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema` — PostgreSQL schema
- `lib/api-client-react` and `lib/api-zod` — generated client hooks and request/response validation

## Ownership: who edits what

The owner approved this split: Replit Agent owns the staff-facing UI; Claude (Claude Code, via GitHub pull requests) owns the backend, database, email intake, and document generation. Separate ownership stops the two from overwriting each other's work.

- **UI-owned (Replit Agent):** `artifacts/bk-textile/**` and `artifacts/mockup-sandbox/**`, including UI-only dependencies in the web app's package file.
- **Backend-owned (Claude):** `artifacts/api-server/**`, `lib/db/**` (schema and migrations), `lib/api-spec/openapi.yaml`, the generated `lib/api-zod/**` and `lib/api-client-react/**`, `artifacts/email-intake/**`, `scripts/post-merge.sh`, and document generation. Do not edit these to unblock a UI feature.
- Request missing fields or operations in `docs/ui-api-requests.md` with the screen, the data needed, and an example. Use the generated API client hooks, never handwritten backend requests, and never hand-edit generated files.
- Backend changes arrive as pull requests that the owner merges on GitHub. They already include regenerated client code; running `pnpm --filter @workspace/api-spec run codegen` after a pull should change nothing.
- Until an endpoint exists, keep clearly labelled fictional mocks inside `artifacts/bk-textile/**` only and list them in `docs/ui-api-requests.md`. Mocks never use real data, including PO 36572 (see Data rules).
- **Git workflow for Replit:** run `git pull origin main` before starting work, and commit and `git push origin main` as soon as a task is done, so work never sits only in Replit. Never force push. If a pull conflicts in backend-owned files, keep the backend version and tell the owner; do not discard unrelated local work.
- Change shared root package/config files and `replit.md` only when necessary, and name such changes in the commit message.
- UI plan: `docs/frontend-plan.md`. A plan existing does not mean email extraction, review endpoints, or document generation is delivered.

## Architecture decisions

- Build this as an independent implementation; do not port or replace the existing installation until its source/backend are available and reviewed.
- Use the existing API contract and PostgreSQL database for the new app; authenticate staff through Replit-managed Clerk.

## Data rules

- **Real data is allowed for one order only: PO 36572 (BK invoice 4040/BK-SAS/2026).** Its real colourways, size×colour quantities, fabrics, trims, source emails, and attachments may be stored in the database and object storage.
- All other records stay synthetic until the user approves the next order or a wider rollout.
- The buyer list (names and abbreviations) and the invoice counter's starting number are reference data and live in migration `0004`.
- Real order data lives only in the database and object storage. Never commit it to git: no real emails, attachments, PO sheets, seed files, fixtures, or screenshots of them. Test fixtures must be synthetic.
- Do not copy real PO 36572 data into Replit chat prompts, mockups, or `mockup-sandbox`.

## Email intake

- Source mailbox: `orders@bktextile.com`, read over **IMAP** (this replaces the earlier POP plan). Folder: `INBOX` only.
- Server: `mail.bktextile.com`, port `993`, SSL/TLS, normal password.
- Secrets (Replit Secrets only, never in code, chat or logs): `IMAP_HOST=mail.bktextile.com`, `IMAP_PORT=993`, `IMAP_USER=orders@bktextile.com`, `IMAP_PASSWORD`.
- How mail gets there: cPanel filters on BK's two primary mailboxes forward the selected buyer/agent senders' mail to `orders@bktextile.com` automatically. Sender selection happens in cPanel, so the intake does not filter by sender. The same email can arrive twice (once via each primary mailbox); it is stored once, keyed on `Message-ID`.
- The intake is read-only on the mailbox: fetch with `BODY.PEEK` so messages are not marked as read, and never move, flag, or delete messages.
- During the PO 36572 phase, only messages that match PO 36572 are stored. Other messages are skipped and not persisted.
- **The buyer's PO number is the key** for matching, sorting and communication. POs have no fixed format (digits, letters and digits, dashes, any length) and are compared ignoring case, spaces and punctuation. A PO number in the subject decides the order. BK's own invoice reference (e.g. `4040/BK-SAS/2026`) in a reply also matches, and so does a reply in an already-matched thread. A different PO mentioned only in the body (customers often reference older POs for repeat specs) is flagged for review, never auto-linked. Full rules: `docs/po-36572-intake-db-plan.md` → Email matching.
- Many order details sit in attachments (PO sheets, tech packs, trim lists), so attachments are stored and their text extracted for parsing.
- **Running it:** an admin calls `POST /api/admin/intake/run` with `{"dryRun": true}` to preview, then `{"dryRun": false}` to store and apply. Only envelopes are read for screening; a full message is downloaded only when its subject names an allow-listed PO, a known BK invoice, or it replies to a stored/candidate email. A new allow-listed PO that arrives with its PO sheet creates the order (and its BK invoice) automatically. Code: `artifacts/api-server/src/intake/`.
- **Manual forwards** (old emails sent to `orders@` by hand) are understood from Thunderbird, Gmail, Outlook, Apple Mail and cPanel webmail: the buyer's original subject and date are read from inside the forward, and times without a zone are taken as Pakistan time. Forward with the attachments.
- **Re-apply:** `POST /api/admin/orders/:id/reapply-emails` (admin) re-reads an order's stored emails, corrects their original dates, and applies their sheets again oldest-first. Use it after a date problem or a reader fix. It overwrites staff edits to the same fields (logged) and never changes the BK invoice number.
- Extracted data goes **straight into the order** during the trial (no approval step). Every change is logged in `bk_activity` with old value, new value and source email. **The later email wins**: the PO sheet sets the starting values, and later emails (trims, accessories, hang tags) override them; PO placeholders like "TBA" never overwrite real details.

## Orders and BK invoices

- One order = one buyer PO = one BK invoice. PO numbers are unique per buyer. A revised PO with the same number updates the existing order; a new PO number is always a new order, whatever its style or delivery date. No sub-invoices.
- The BK invoice is assigned automatically when an order is first created: `{number}/BK-{buyer abbreviation}/{year PO received}`, e.g. `4040/BK-SAS/2026`. One sequence across all buyers and years (4051 on 31 Dec → 4052 on 1 Jan). Orders are created through `createOrderWithInvoice()` (api-server `lib/orderCreation.ts`), which resolves the buyer (ID, name or abbreviation), requires a PO, and calls `assignInvoiceNumber()` inside the same transaction, so numbers have no gaps or duplicates.
- **Restricted invoice overrides (admins only):** `PUT /api/admin/invoice-counter` sets the last-used number (never below a number already on an order); `PUT /api/admin/orders/:id/invoice` overwrites one order's number and rebuilds its reference. Both need a reason and are logged in the activity log.
- Orders created before invoice numbering are synthetic and were relabelled `TEST-…` by migration `0005`.
- Buyers and abbreviations: Spartan Apparel Sourcing (SAS), Rainbow Sourcing (RS), Metropolitan Manufacturing INC (MMI), God's Love Overcomes (LIF). Email domains to be added.
- A PO can have several priced lines (style + process), e.g. one style in two finishes at different prices; colours sit under their line.
- Fetches are idempotent: each message is keyed by mailbox + UIDVALIDITY + UID, plus `Message-ID`.

## Product

The business coordinates merchandising, sampling, outsourced yarn/knitting/dyeing, warehouses, cutting, embellishment, stitching, washing, finishing, packing, export, and accounts. The initial slice focuses on orders, department tasks, received material lots, and quality inspections. Expand additional departments in phases after the team reviews the workflows.

## User preferences

- Backend changes arrive as GitHub pull requests for the user to review; Replit stays frontend-only.

## Gotchas

- `artifacts/api-server/build.mjs` has an `external` list of packages left out of the server bundle. A package listed there must be a direct dependency of `@workspace/api-server`, or the server crashes on start (502 everywhere). After adding a library, build and start `dist/index.mjs` once to check.
- Never run `push` / `push-force` against the database: it holds real PO 36572 data. Schema changes go through `lib/db/migrations`, reviewed in a PR and applied by `migrate` after merge.
- `lib/db/migrations/0000_baseline.sql` is hand-edited to be idempotent (it matches the tables that `push` created before migrations existed). Do not regenerate or edit it.
- DB design for PO 36572 intake: `docs/po-36572-intake-db-plan.md`.

## Frontend requests

UI requests for backend fields and endpoints live in `docs/ui-api-requests.md`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
