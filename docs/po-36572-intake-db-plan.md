# PO 36572 email intake: database plan

Status: **plan for review**. No schema code yet. After this plan is approved, the tables go into `lib/db/src/schema` as one PR with a generated migration.

Scope: hold everything the `orders@bktextile.com` IMAP intake pulls in for PO 36572 (BK Inv. 4040). Each value records where it came from, so staff can trace it back to the email or attachment it was read from.

## Conventions (same as the existing schema)

- `bk_` table prefix, `uuid` primary keys with `defaultRandom()`, `timestamptz` timestamps.
- Every child table carries `order_id → bk_orders.id` with `on delete cascade`.
- Extracted rows carry provenance: `source_email_id` and `source_attachment_id` (both nullable, `on delete set null`). A null source means a staff member entered the row by hand.
- Quantities of pieces are `integer`. Consumption and measurements are `numeric(12,4)`, never `doublePrecision`.
- Status/kind fields are `text` checked against Zod enums in the OpenAPI spec, matching how `status` and `priority` work today.

## Entity overview

```
bk_orders (existing)
 ├── bk_order_colourways
 │     └── bk_order_size_quantities   (one row per colourway × size)
 ├── bk_order_fabrics                 (optionally per colourway)
 ├── bk_order_trims                   (optionally per colourway / size)
 ├── bk_source_emails
 │     └── bk_source_email_attachments ──(promoted)──> bk_order_files (existing)
 └── bk_activity (existing, extended into the work log)
```

## Changes to existing tables

### `bk_orders`

**Decided in review:** BK Inv. 4040 is entered as a **new order** with real data, used to test the intake end to end.

- Add `bk_invoice_number` text, nullable, **unique**. BK invoice numbers are a sequential 4-digit series, and together with the buyer PO they are the keys the intake matches emails on, so they get their own indexed column instead of sharing `reference`.
- Add a unique index on `po_number` where it is not null, so one PO can't match two orders.
- New order row: `po_number = '36572'`, `bk_invoice_number = '4040'`. `reference` keeps its current meaning (internal order code) and can also be `4040` for this order.
- `quantity` stays as the header total. The API reports a mismatch when it differs from the sum of `bk_order_size_quantities`. It is not overwritten automatically.

### `bk_order_files`

- Add nullable `source_attachment_id → bk_source_email_attachments.id` (`set null`), so a file promoted from an email links back to it.
- `uploaded_by` / `uploaded_by_name` for promoted files: `system:email-intake` / `Email intake`.

### `bk_activity` → work log

**Decided in review:** the work log is only the record of who changed what (staff and the email intake). No hours or notes log for now.

Extend this table instead of adding a second audit table, so the dashboard feed and the order activity tab keep working unchanged. All new columns are nullable or defaulted, so existing rows and routes are unaffected.

| column | type | notes |
|---|---|---|
| `order_id` | uuid → bk_orders, `set null` | Today the order link is inferred from `entity_id`. Making it explicit lets one query return an order's full log. |
| `source` | text, default `'staff'` | `staff` \| `email_intake` \| `system` |
| `action` | text, nullable | machine-readable verb, e.g. `email.fetched`, `email.matched`, `colourway.created`, `size_qty.updated`, `attachment.promoted` |
| `details` | jsonb, nullable | before/after values, parser warnings, IMAP UID. Must never hold credentials. |
| `source_email_id` | uuid → bk_source_emails, `set null` | |

Index: `(order_id, occurred_at desc)`.

## New tables

### `bk_order_colourways`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `order_id` | uuid → bk_orders, cascade | |
| `code` | text not null | buyer's colour code |
| `name` | text not null | e.g. "Navy" |
| `buyer_reference` | text | Pantone / lab-dip reference if given |
| `sort_order` | integer not null default 0 | display order as on the PO |
| `source_email_id`, `source_attachment_id` | provenance | |
| `created_at`, `updated_at` | timestamptz | |

Unique: `(order_id, code)`.

### `bk_order_size_quantities`

One row per colourway × size, so PO grids with any size range need no schema change.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `order_id` | uuid → bk_orders, cascade | duplicated from the colourway so order totals need no join |
| `colourway_id` | uuid → bk_order_colourways, cascade | |
| `size_label` | text not null | as printed on the PO: `S`, `M`, `3-4Y`, `32/34`… |
| `size_sort` | integer not null | column order on the PO |
| `quantity` | integer not null, `check (quantity >= 0)` | |
| `source_email_id`, `source_attachment_id` | provenance | |
| `updated_at` | timestamptz | |

Unique: `(colourway_id, size_label)`. Index: `(order_id)`.

When a later email revises the quantities, the intake updates rows in place and records old → new values in `bk_activity.details`. It does not keep a history table. That keeps the grid simple, and the audit trail still holds every revision.

### `bk_order_fabrics`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `order_id` | uuid → bk_orders, cascade | |
| `colourway_id` | uuid → bk_order_colourways, cascade, **nullable** | null = applies to all colourways |
| `placement` | text not null | `body`, `rib`, `collar`, `lining`, `contrast`… |
| `description` | text not null | as written on the PO |
| `composition` | text | e.g. "95% cotton 5% elastane" |
| `construction` | text | jersey, fleece, pique… |
| `gsm` | integer | |
| `width_cm` | numeric(12,4) | |
| `colour` | text | if it differs from the colourway |
| `supplier` | text | |
| `consumption_per_piece` | numeric(12,4) | |
| `consumption_unit` | text | `kg`, `m` |
| `notes` | text not null default `''` | |
| `source_email_id`, `source_attachment_id` | provenance | |
| `created_at`, `updated_at` | timestamptz | |

A later step can link received fabric to this requirement by adding a nullable `fabric_id` to `bk_material_lots`. That is out of scope for this PR.

### `bk_order_trims`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `order_id` | uuid → bk_orders, cascade | |
| `colourway_id` | uuid → bk_order_colourways, cascade, nullable | null = all colourways |
| `size_label` | text, nullable | for size-specific trims such as size labels |
| `trim_type` | text not null | `main_label`, `care_label`, `size_label`, `hangtag`, `button`, `zip`, `thread`, `polybag`, `carton`, `other` |
| `description` | text not null | |
| `supplier` | text | |
| `quantity_per_piece` | numeric(12,4) | |
| `unit` | text | `pcs`, `m`, `cone` |
| `buyer_supplied` | boolean not null default false | nominated or supplied by the buyer |
| `notes` | text not null default `''` | |
| `source_email_id`, `source_attachment_id` | provenance | |
| `created_at`, `updated_at` | timestamptz | |

### `bk_source_emails`

One row per IMAP message that was persisted. During the PO 36572 phase, only matching messages are stored (see `replit.md` → Data rules).

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `order_id` | uuid → bk_orders, `set null`, nullable | null until matched |
| `mailbox` | text not null | `orders@bktextile.com` |
| `imap_folder` | text not null | e.g. `INBOX` |
| `imap_uidvalidity` | bigint not null | |
| `imap_uid` | bigint not null | |
| `message_id` | text not null | RFC 5322 `Message-ID` |
| `in_reply_to` | text | |
| `thread_key` | text | normalised subject / references root, used to group replies |
| `from_address` | text not null | |
| `from_name` | text | |
| `to_addresses` | text[] not null default `{}` | |
| `cc_addresses` | text[] not null default `{}` | |
| `subject` | text not null default `''` | |
| `sent_at` | timestamptz | `Date:` header |
| `received_at` | timestamptz not null | IMAP INTERNALDATE |
| `body_text` | text | plain-text body, used for search and parsing |
| `raw_object_path` | text not null unique | full `.eml` in object storage; HTML bodies are read from here |
| `match_status` | text not null default `'matched'` | `matched` \| `ignored` \| `needs_review` |
| `match_method` | text not null | `po_number` \| `bk_invoice_number` \| `both` \| `thread` \| `manual` (see Email matching) |
| `match_reason` | text | e.g. `subject: "PO 36572"`, `reply to <msg-id>` |
| `category` | text not null default `'unclassified'` | `order_details` \| `tech_pack` \| `trims_accessories` \| `sample_requirements` \| `packaging` \| `amendment` \| `other` \| `unclassified`. Staff can change it. |
| `parse_status` | text not null default `'pending'` | `pending` \| `parsed` \| `failed` \| `partial` |
| `parse_error` | text | |
| `fetched_at` | timestamptz not null default now() | |
| `processed_at` | timestamptz | |

Unique: `(mailbox, imap_folder, imap_uidvalidity, imap_uid)` makes re-fetching a no-op. `message_id` gets a separate unique index, which catches the same message copied into two folders.
Index: `(order_id, received_at desc)`.

### `bk_source_email_attachments`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `email_id` | uuid → bk_source_emails, cascade | |
| `filename` | text not null | |
| `content_type` | text not null | |
| `size_bytes` | integer not null | |
| `sha256` | text not null | spots the same PO sheet re-sent in several emails |
| `content_id` | text | inline images |
| `is_inline` | boolean not null default false | |
| `object_path` | text not null unique | same object storage and ACLs as `bk_order_files` |
| `order_file_id` | uuid → bk_order_files, `set null` | set when a staff member promotes the attachment into the order's files |
| `created_at` | timestamptz | |

Index: `(sha256)`.

## Email matching

From the review: each order involves several senders (order details, tech packs, trims and accessories, sample requirements, packaging, amendments), so matching **does not depend on the sender**. It looks for the order's two numbers.

The worker loads the known `(po_number, bk_invoice_number)` pairs from `bk_orders`. During this phase that is only PO 36572 / 4040. A message matches an order when any of these holds:

1. **PO number:** `36572` appears as a whole number in the subject, the plain-text body, or an attachment filename.
2. **BK invoice number:** `4040` appears with an invoice prefix, e.g. `BK Inv. 4040`, `Inv 4040`, `Invoice #4040`, `BK-4040`. A bare 4-digit number on its own is **not** enough, because quantities, prices, years and style codes are also 4 digits.
3. **Thread:** the message's `In-Reply-To` / `References` points at an email already matched to the order. This catches replies such as "approved, go ahead" that don't repeat the numbers.

The two numbers can point at different orders; for example, a PO for one order and an invoice number for another. In that case the message is stored as `needs_review` rather than guessed.

Messages that match nothing are not stored. To help find emails that were missed:

- Each run writes one `bk_activity` row (`action = 'intake.run'`) with counts: fetched, matched, skipped. Its `details` hold the skipped IMAP UIDs only, never subjects, senders or bodies, so other orders' data stays out of the database.
- A staff endpoint, `POST /source-emails/import`, takes an IMAP UID or `Message-ID` and attaches that email to a chosen order (`match_method = 'manual'`).
- If manual imports show a pattern (a sender's own reference format, numbers only inside PDFs), we add that rule. Reading text inside attachments is left for later.

## Migration approach

1. Add the schema files (`colourways.ts`, `fabrics.ts`, `trims.ts`, `sourceEmails.ts`), plus edits to `activity.ts` and `orderFiles.ts`, all exported from `schema/index.ts`.
2. Generate a reviewed SQL migration with `drizzle-kit generate` instead of using `push`. Every change is additive (new tables, nullable or defaulted columns), so existing data and frontend routes keep working.
3. Add the matching OpenAPI paths and regenerate `api-zod` / `api-client-react`:
   - `GET /orders/:id/colourways` (with nested size quantities)
   - `PUT /orders/:id/size-quantities`
   - `GET/POST /orders/:id/fabrics` and `/trims`
   - `GET /orders/:id/source-emails`
   - `POST /source-email-attachments/:id/promote`
4. Only after that, build the IMAP worker. Credentials come from secrets; it fetches read-only with `BODY.PEEK`.

## Not in this plan

- Per-size measurement specs, costing, and shipment splits.
- Automatic overwriting of the `bk_orders` header from emails. Header changes stay staff-confirmed.
- Any order other than PO 36572.
