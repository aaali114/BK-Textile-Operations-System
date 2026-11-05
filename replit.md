# B.K. Textile Operations

A new B.K. Textile-owned web system for coordinating garment orders, department work, material receipts, inspections, and production handoffs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Database changes belong to the backend developer and arrive as migrations; the UI agent must not run `db push`.
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

## Architecture decisions

- Build this as an independent implementation; do not port or replace the existing installation until its source/backend are available and reviewed.
- Keep preview records synthetic. Do not import or enter live company data until the user confirms the access, data-transfer, and rollout plan.
- Use the existing API contract and PostgreSQL database for the new app; authenticate staff through Replit-managed Clerk.

## Collaboration ownership

The owner approved the frontend-only handoff: Replit Agent owns the staff-facing
UI; Claude owns the backend, database, email intake, and document generator.

**Why:** Separate ownership prevents the two developers from overwriting each
other's work.

- UI-owned: `artifacts/bk-textile/**` and `artifacts/mockup-sandbox/**`, including
  UI-only dependencies in the web app's package file.
- Backend-owned: `artifacts/api-server/**`, `lib/db/**`,
  `lib/api-spec/openapi.yaml`, generated `lib/api-zod/**` and
  `lib/api-client-react/**`, `artifacts/email-intake/**`, and document generation.
  Do not edit these folders to unblock a UI feature.
- Request missing fields/operations in `docs/ui-api-requests.md` with the screen,
  required data, and an example. Use generated API client hooks, not handwritten
  backend requests. Never hand-edit generated files.
- After pulling backend contract updates, run
  `pnpm --filter @workspace/api-spec run codegen`. Do not change the schema or
  run `db push`; backend changes arrive as migrations.
- Until endpoints are available, keep clearly labelled fictional mocks inside
  `artifacts/bk-textile/**` only and list them in `docs/ui-api-requests.md`.
  No live company data without the owner's approval.
- Pull from `aaali114/BK-Textile-Operations-System` before starting work; commit
  and push completed changes with clear messages. Never force push. Backend
  changes arrive as pull requests that the owner merges before the UI pulls them.
- If pulling conflicts in backend-owned folders, retain the backend developer's
  version and tell the owner. Do not discard unrelated local work.
- Change shared root package/config files and `replit.md` only when necessary,
  and name such changes in the commit message.

The four-screen Merchandising plan is in `docs/frontend-plan.md`. Planning does
not mean email extraction, review endpoints, or template generation is delivered.

## Product

The business coordinates merchandising, sampling, outsourced yarn/knitting/dyeing, warehouses, cutting, embellishment, stitching, washing, finishing, packing, export, and accounts. The initial slice focuses on orders, department tasks, received material lots, and quality inspections. Expand additional departments in phases after the team reviews the workflows.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
