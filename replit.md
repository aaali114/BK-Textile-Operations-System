# B.K. Textile Operations

A new B.K. Textile-owned web system for coordinating garment orders, department work, material receipts, inspections, and production handoffs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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

- **Backend is owned outside Replit** (Claude Code, via pull requests on GitHub). This covers `artifacts/api-server`, `lib/db`, `lib/api-spec`, and the generated packages `lib/api-zod` and `lib/api-client-react`.
- **Replit Agent is frontend-only.** It may edit `artifacts/bk-textile` and `artifacts/mockup-sandbox`. It must not edit backend files, the DB schema, or the OpenAPI spec, and must not run `pnpm --filter @workspace/db run push`.
- If the frontend needs a new field or endpoint, write the request down (in this file under "Frontend requests" or in a GitHub issue) instead of changing the backend. Consume the API only through the generated `@workspace/api-client-react` hooks.

## Architecture decisions

- Build this as an independent implementation; do not port or replace the existing installation until its source/backend are available and reviewed.
- Use the existing API contract and PostgreSQL database for the new app; authenticate staff through Replit-managed Clerk.

## Data rules

- **Real data is allowed for one order only: PO 36572 (BK Inv. 4040).** Its real colourways, size×colour quantities, fabrics, trims, source emails, and attachments may be stored in the database and object storage.
- All other records stay synthetic until the user approves the next order or a wider rollout.
- Real data lives only in the database and object storage. Never commit it to git: no real emails, attachments, PO sheets, seed files, fixtures, or screenshots of them. Test fixtures must be synthetic.
- Do not copy real PO 36572 data into Replit chat prompts, mockups, or `mockup-sandbox`.

## Email intake

- Source mailbox: `orders@bktextile.com`, read over **IMAP** (this replaces the earlier POP plan).
- Credentials come from secrets only: `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`. Never hard-code or log them.
- The mailbox is shared and read-only to the intake: fetch with `BODY.PEEK` so messages are not marked as read, and never move, flag, or delete messages.
- During the PO 36572 phase, only messages that match PO 36572 / BK Inv. 4040 are stored. Other messages in the mailbox are skipped and not persisted.
- Matching is by the buyer PO number and the BK invoice number (4-digit, sequential), not by sender, because many senders write about one order. A bare 4-digit number only counts with an invoice prefix (`BK Inv.`, `Inv`, `Invoice`). Replies in a matched thread also match. Full rules: `docs/po-36572-intake-db-plan.md` → Email matching.
- Fetches are idempotent: each message is keyed by mailbox + UIDVALIDITY + UID, plus `Message-ID`.

## Product

The business coordinates merchandising, sampling, outsourced yarn/knitting/dyeing, warehouses, cutting, embellishment, stitching, washing, finishing, packing, export, and accounts. The initial slice focuses on orders, department tasks, received material lots, and quality inspections. Expand additional departments in phases after the team reviews the workflows.

## User preferences

- Backend changes arrive as GitHub pull requests for the user to review; Replit stays frontend-only.

## Gotchas

- `drizzle-kit push` is dev-only. Once real PO 36572 data is in the database, schema changes go through generated migrations reviewed in a PR, not `push`/`push-force`.
- DB schema plan for PO 36572 intake: `docs/po-36572-intake-db-plan.md`.

## Frontend requests

_Replit Agent: list backend fields/endpoints the UI needs here._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
