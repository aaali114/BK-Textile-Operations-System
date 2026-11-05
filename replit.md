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

## Architecture decisions

- Build this as an independent implementation; do not port or replace the existing installation until its source/backend are available and reviewed.
- Keep preview records synthetic. Do not import or enter live company data until the user confirms the access, data-transfer, and rollout plan.
- Use the existing API contract and PostgreSQL database for the new app; authenticate staff through Replit-managed Clerk.

## Product

The business coordinates merchandising, sampling, outsourced yarn/knitting/dyeing, warehouses, cutting, embellishment, stitching, washing, finishing, packing, export, and accounts. The initial slice focuses on orders, department tasks, received material lots, and quality inspections. Expand additional departments in phases after the team reviews the workflows.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
