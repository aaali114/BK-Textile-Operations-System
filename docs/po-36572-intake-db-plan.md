# PO 36572 email intake: database design

Status: **schema implemented** in `lib/db/src/schema` with migrations in `lib/db/migrations`. The API endpoints and the IMAP worker come in later PRs.

Scope: hold everything the `orders@bktextile.com` IMAP intake pulls in for PO 36572 (BK Inv. 4040) and its sub-invoices. Each value records where it came from, so staff can trace it back to the email or attachment it was read from.

## Decisions from review

- BK Inv. 4040 is entered as a **new order** with real data, used to test the intake end to end.
- The work log is only the record of who changed what, by staff or by the email intake. There is no hours or notes log.
- Emails are matched on the BK invoice number **and** the buyer PO together, from the subject or the body.
- An invoice can have sub-invoices created by BK Team (`4040-A`), each with its own style and/or PO. Sub-invoices are named in the subject. One email can cover an invoice and its sub-invoice.
- Mail reaches `orders@bktextile.com` through cPanel filters and forwarders on BK's two primary mailboxes. Senders are chosen in cPanel, not by the intake.
- Many order details are in attachments, not the email body.

## Conventions

- `bk_` table prefix, `uuid` primary keys, `timestamptz` timestamps.
- Every child table carries `order_id → bk_orders.id` with `on delete cascade`.
- Extracted rows carry provenance: `source_email_id` and `source_attachment_id` (both nullable, `on delete set null`). A null source means a staff member entered the row by hand.
- Piece quantities are `integer`. Consumption and measurements are `numeric(12,4)`.
- Status/kind fields are `text`, validated by Zod enums in the API, the same way `status` and `priority` work today.

## Entity overview

```
bk_orders (existing; + bk_invoice_number, parent_order_id)
 ├── bk_orders (sub-invoices: 4040-A → parent 4040)
 ├── bk_order_colourways
 │     └── bk_order_size_quantities     (one row per colourway × size)
 ├── bk_order_fabrics                   (optionally per colourway)
 ├── bk_order_trims                     (optionally per colourway / size)
 ├── bk_source_email_orders ── bk_source_emails    (many-to-many)
 │                                 └── bk_source_email_attachments ──(promoted)──> bk_order_files
 └── bk_activity (existing; extended into the work log)
```

## Changes to existing tables

### `bk_orders`

| column | type | notes |
|---|---|---|
| `bk_invoice_number` | text, **unique**, nullable | `4040`, `4040-A`. Check constraint: `^[0-9]{4}(-[A-Z])?$`. A sub-invoice suffix is always one letter. |
| `parent_order_id` | uuid → bk_orders, `set null` | a sub-invoice points at its parent invoice's order |

- `po_number` stays **not unique**, because sub-invoices can share a PO. It gets an index for matching.
- Each sub-invoice is its own order row, with its own style, quantities, colourways, fabrics and trims.
- `quantity` stays as the header total. The API reports a mismatch when it differs from the sum of `bk_order_size_quantities`. It is not overwritten automatically.
- First real rows: `4040` (PO 36572). Sub-invoices are created when they appear.

### `bk_activity` → work log

All new columns are nullable or defaulted. Existing rows become `source = 'staff'`.

| column | type | notes |
|---|---|---|
| `order_id` | uuid → bk_orders, `set null` | explicit order link |
| `source` | text, default `'staff'` | `staff` \| `email_intake` \| `system` |
| `action` | text | e.g. `intake.run`, `email.matched`, `size_qty.updated`, `attachment.promoted` |
| `details` | jsonb | before/after values, parser warnings, skipped IMAP UIDs. Never credentials, never content of emails that matched no order. |
| `source_email_id` | uuid → bk_source_emails, `set null` | |

Index: `(order_id, occurred_at desc)`.

## New tables

### `bk_order_colourways`

`order_id`, `code`, `name`, `buyer_reference`, `sort_order`, provenance, timestamps. Unique `(order_id, code)`.

### `bk_order_size_quantities`

One row per colourway × size, so any size range fits.

`order_id`, `colourway_id`, `size_label` (as printed: `S`, `3-4Y`, `32/34`), `size_sort`, `quantity` (check `>= 0`), provenance, `updated_at`. Unique `(colourway_id, size_label)`.

When an amendment email revises the quantities, the row is updated in place and the old → new values go into `bk_activity.details`.

### `bk_order_fabrics`

`order_id`, `colourway_id` (null = all colourways), `placement`, `description`, `composition`, `construction`, `gsm`, `width_cm`, `colour`, `supplier`, `consumption_per_piece`, `consumption_unit`, `notes`, provenance, timestamps.

### `bk_order_trims`

`order_id`, `colourway_id` (null = all), `size_label` (size-specific trims), `trim_type` (`main_label`, `care_label`, `size_label`, `hangtag`, `button`, `zip`, `thread`, `polybag`, `carton`, `other`), `description`, `supplier`, `quantity_per_piece`, `unit`, `buyer_supplied`, `notes`, provenance, timestamps.

### `bk_source_emails`

One row per stored message.

| column | notes |
|---|---|
| `mailbox`, `imap_folder`, `imap_uidvalidity`, `imap_uid` | unique together, so re-fetching is a no-op |
| `message_id` | **unique**: the same email forwarded from both primary mailboxes is stored once |
| `in_reply_to`, `references_header`, `thread_key` | used for thread matching |
| `from_address`, `from_name`, `to_addresses[]`, `cc_addresses[]` | original sender, kept by the cPanel forwarder |
| `forwarded_via` | which primary BK mailbox forwarded it, when headers say |
| `subject`, `sent_at`, `received_at`, `body_text` | |
| `raw_object_path` | full `.eml` in object storage |
| `category` | `order_details`, `tech_pack`, `trims_accessories`, `sample_requirements`, `packaging`, `amendment`, `other`, `unclassified`. Staff can change it. |
| `parse_status`, `parse_error`, `fetched_at`, `processed_at` | |

### `bk_source_email_orders`

Links emails to orders. An email can concern more than one order, such as 4040 and 4040-A.

`email_id`, `order_id` (unique together), `match_status` (`matched` \| `needs_review` \| `ignored`), `match_method` (`invoice_and_po` \| `invoice_only` \| `po_only` \| `thread` \| `manual`), `match_reason` (the evidence, e.g. `subject: "BK Inv 4040-A"; body: "PO 36572"`), `matched_at`, `reviewed_by`, `reviewed_at`.

### `bk_source_email_attachments`

`email_id`, `filename`, `content_type`, `size_bytes`, `sha256` (finds re-sent files), `content_id`, `is_inline`, `object_path`, `extract_status` (`pending` \| `extracted` \| `failed` \| `not_applicable`), `extracted_text`, `extract_error`, `order_file_id` (set when promoted into the order's files), `created_at`.

## Email matching

The worker loads the known orders' `(bk_invoice_number, po_number)` pairs. During this phase that means 4040 and its sub-invoices. It then scans the subject and plain-text body of each new message.

**Invoice references.** These count: `BK Inv XXXX`, `Inv XXXX`, and close variants such as `BK Inv. XXXX`, `BK-Inv XXXX`, `Inv# XXXX`, `Inv No. XXXX`, `Invoice XXXX`. Matching is case-insensitive, and each can have a sub-invoice suffix of exactly one letter: `4040-A`, `4040 A`, `4040A`, all normalised to `4040-A`. A bare 4-digit number is not enough, because quantities, prices and years are 4 digits too.

**PO references.** A known PO number appears as a whole number, with or without a `PO` / `P.O.` / `PO#` prefix.

For each order, the outcome is:

| found in subject + body | result |
|---|---|
| order's invoice **and** its PO | `matched` (`invoice_and_po`) |
| only the invoice, or only the PO | `needs_review` (`invoice_only` / `po_only`) |
| a reply in a thread already matched to the order | `matched` (`thread`) |
| invoice and PO belong to different orders | `needs_review` on both |

**Sub-invoices:**

- A sub-invoice named in the **subject** decides which order the email belongs to. For example, `BK Inv 4040-A` together with `PO 36572` links to order 4040-A, not to 4040.
- If the body also covers the parent invoice with its PO (a redirect within the same email), the email is linked to both orders.
- A sub-invoice that has no order yet, e.g. a new `4040-B` in the subject, is linked to the parent order 4040 as `needs_review`, with the reason `new sub-invoice 4040-B`, so staff can create the order.

Messages that match nothing are not stored. To find emails that were missed:

- Each run writes one `bk_activity` row (`action = 'intake.run'`) with counts and the skipped IMAP UIDs only. It never stores subjects, senders or bodies.
- A staff endpoint, `POST /source-emails/import`, attaches a missed email by IMAP UID or `Message-ID` (`match_method = 'manual'`).
- When manual imports show a pattern, such as a new invoice spelling or numbers that only appear inside attachments, a matching rule is added.

## Migrations

- `0000_baseline.sql` holds the tables that existed before migrations, created with `push`. It is hand-edited to be idempotent: it does nothing on the existing Replit database and builds everything on an empty one.
- `0001_po_36572_intake.sql` adds the new tables and columns. It only adds things, so existing rows and routes keep working.
- `scripts/post-merge.sh` now runs `migrate` instead of `push`.
- Both migrations were tested on Postgres 16 in two cases:
  - a database built with `push` from the previous schema, with sample rows: the rows were kept and a second migrate run did nothing
  - an empty database
- Constraint checks were also tested: invoice format, duplicate invoice, negative quantity, a duplicate `Message-ID`, and one email linked to both 4040 and 4040-A.

## Next

1. OpenAPI endpoints and codegen:
   - `GET /orders/:id/colourways` (with size quantities)
   - `PUT /orders/:id/size-quantities`
   - fabrics and trims
   - `GET /orders/:id/source-emails`
   - `POST /source-emails/import`
   - `POST /source-email-attachments/:id/promote`
   - confirm or override a `needs_review` link
2. IMAP worker: the matching above, storing `.eml` files and attachments, and extracting attachment text (PDF / XLSX).
3. Field extraction into colourways, size quantities, fabrics and trims. This needs sample emails and attachments.

## Not in scope

- Per-size measurement specs, costing, and shipment splits.
- Automatic overwriting of the `bk_orders` header from emails. Header changes stay staff-confirmed.
- Any order other than PO 36572 / BK Inv. 4040 and its sub-invoices.
