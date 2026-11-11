#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply reviewed SQL migrations from lib/db/migrations. Do not use `push` here:
# the database holds real PO 36572 data, and push can drop or rewrite columns.
pnpm --filter db run migrate
