# PO 36572 email intake: database design

Status: **schema implemented** in `lib/db/src/schema` with migrations in `lib/db/migrations`. The API endpoints and the IMAP worker come in later PRs.

Scope: hold everything the `orders@bktextile.com` IMAP intake pulls in for PO 36572 (BK invoice 4040/BK-SAS/2026). Each value records where it came from, so staff can trace it back to the email or attachment it was read from.

## Decisions from review

- PO 36572 is entered as a **new order** with real data, used to test the intake end to end. It gets BK invoice **4040/BK-SAS/2026**.
- The work log is only the record of who changed what, by staff or by the email intake. There is no hours or notes log.
- **The buyer's PO number is the key** (unique per buyer). One PO = one order = one BK invoice. A revised PO with the same number updates the order; a new PO number is always a new order. **No sub-invoices.**
- BK invoices are assigned by the system: `{number}/BK-{buyer abbreviation}/{year PO received}`, one sequence across all buyers and years, with no gaps.
- Customers often reference **older POs** for repeat specs, so a PO mentioned only in the body never decides the order.
- During the trial, extracted data goes **straight into the order**, and **the later email wins**. Agents send a mostly generic PO with the essentials changed (PO#, style, quantities, prices); accessories and trims come in later emails and override the PO's placeholders.
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
bk_buyers ── bk_orders (existing; + buyer_id, invoice, PO terms)      bk_invoice_counter (single row)
 ├── bk_order_lines                     (style + process + price + qty)
 │     └── bk_order_colourways
 │           └── bk_order_size_quantities   (one row per colourway × size)
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
| `buyer_id` | uuid → bk_buyers, `restrict` | null only on old synthetic preview orders |
| `po_number` | text | **unique together with `buyer_id`**; also indexed alone for matching |
| `invoice_number` | integer, unique | e.g. 4040 |
| `invoice_ref` | text, unique | `4040/BK-SAS/2026`; format check `^[0-9]+/BK-[A-Z]{2,5}/[0-9]{4}$`; set together with `invoice_number` |
| `po_received_at` | timestamptz | when the PO first reached BK; its year (Pakistan time) goes into `invoice_ref` |
| `po_issue_date` | date | from the PO sheet |
| `end_customer` | text | the brand behind a sourcing agent, when the PO names one |
| `price_terms`, `payment_terms`, `ship_via`, `country_of_origin` | text | as written on the PO, e.g. FOB, D/P, sea freight |
| `over_ship_tolerance_pct` | numeric(5,2) | e.g. 3.00 for "3% over PO quantity allowed" |

- `delivery_date` holds the PO ship date. `quantity` stays as the header total; the API reports a mismatch when it differs from the size grid. It is not overwritten automatically.
- `bk_invoice_number` and `parent_order_id` (sub-invoices) were removed in migration `0003`.

### `bk_buyers` and `bk_invoice_counter`

- `bk_buyers`: `name` (unique), `abbreviation` (unique, 2–5 capitals), `email_domains[]`. Seeded with SAS, RS, MMI, LIF; domains to follow.
- `bk_invoice_counter`: a single row holding the last number used, seeded at 4039 so PO 36572 gets 4040.
- `assignInvoiceNumber(tx, buyerId, poReceivedAt)` in `lib/db/src/invoices.ts` increments the counter inside the order-creating transaction. The row lock makes concurrent orders queue, and a failed order gives its number back. Tested: 10 simultaneous creations with one failure produced 4040–4048 with no gaps; 31 Dec 21:00 UTC (1 Jan in Karachi) gets `/2027`.

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

### `bk_order_lines`

`order_id`, `style_number`, `description` (the process/finish as written on the PO, e.g. `GARMENT DYED CREW`), `unit_price` numeric(12,4), `quantity` (check `>= 0`), `sort_order`, provenance, timestamps. Unique `(order_id, style_number, description)`.

### `bk_order_colourways`

`order_id`, `line_id` (→ bk_order_lines; the same colour can appear under two lines), `code`, `name`, `buyer_reference`, `sort_order`, provenance, timestamps. Unique `(order_id, line_id, code)` with `NULLS NOT DISTINCT`.

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

Links emails to orders. Normally one order per email; a link table keeps room for an email that genuinely covers two POs.

`email_id`, `order_id` (unique together), `match_status` (`matched` \| `needs_review` \| `ignored`), `match_method` (`po_subject` \| `invoice_ref` \| `thread` \| `po_body_only` \| `manual`), `match_reason` (the evidence, e.g. `subject: "PO# 36572"`), `matched_at`, `reviewed_by`, `reviewed_at`.

### `bk_source_email_attachments`

`email_id`, `filename`, `content_type`, `size_bytes`, `sha256` (finds re-sent files), `content_id`, `is_inline`, `object_path`, `extract_status` (`pending` \| `extracted` \| `failed` \| `not_applicable`), `extracted_text`, `extract_error`, `order_file_id` (set when promoted into the order's files), `created_at`.

## Email matching

The worker loads the known orders' `(buyer, po_number, invoice_ref)` values. During this phase that is only PO 36572. For each new message:

| evidence | result |
|---|---|
| a known PO number in the **subject** (`PO# 36572`, `PO: AC-PO-9812`, `P.O. #SR0912ABC`, `purchase order # 36572`) | `matched` (`po_subject`) |
| BK's invoice reference (`4040/BK-SAS/2026`, or `Inv 4040` / `BK Inv 4040` written by BK) in the subject or body | `matched` (`invoice_ref`) |
| a reply in a thread already matched to the order (`In-Reply-To` / `References`) | `matched` (`thread`) |
| a known PO number **only in the body** | `needs_review` (`po_body_only`): customers often cite older POs for repeat specs, so this never decides the order on its own |
| the subject names two different known POs | `needs_review` on both |

- **PO numbers have no fixed format** (digits only, letters and digits, dashes, 9+ characters, per buyer). After a PO marker (`PO`, `PO#`, `P.O.`, `PO No.`, `Purchase Order #`) any value containing a digit counts, so "PO Box" or "PO for style" never do. `1234/1235` also yields each part.
- **POs are compared ignoring case, spaces and punctuation**: `AC-PO-9812` = `ac po 9812` = `ACPO9812`. The order keeps the PO exactly as written on the PO sheet.
- **A known or allow-listed PO is also found without a marker** ("AC-PO-9812 trims update"), but only if it contains letters or has at least 7 digits; a short all-digit PO needs a marker so quantities and prices are not mistaken for it. A PO is never matched inside a longer code (`ACPO98123` is not `ACPO9812`).
- When two buyers could share a PO number, the sender's email domain (`bk_buyers.email_domains`) picks the buyer. Until domains are filled in, an ambiguous PO goes to `needs_review`.
- **Never** take the PO number from artwork or label attachments: label layouts are often reused from earlier orders and still show the old PO number.

Messages that match nothing are not stored. To find missed emails:

- Each run writes one `bk_activity` row (`action = 'intake.run'`) with counts and the skipped IMAP UIDs only, never subjects, senders or bodies.
- A staff endpoint, `POST /source-emails/import`, attaches a missed email by IMAP UID or `Message-ID` (`match_method = 'manual'`).

## Applying extracted data

- **The PO sheet** (buyer's purchase-order spreadsheet) sets the starting values: header terms and dates, priced lines, colours and the size grid, fabric description and processes, packing and quality notes. A revised PO for the same number updates these in place; tables are found by their headings (`Style#`, `COLORS`, size labels), never by fixed rows, because revisions shift rows.
- **Later emails win.** Trims sheets, accessory details and hang-tag artwork sent after the PO override the PO's values. The PO's placeholders (`TBA`, blank) never overwrite a real value. Example: a PO says "Hang Tag: Not Required" and a later trims email lists a hang tag and its supplier, so the hang tag is recorded.
- Size labels are normalised: `2X` = `2XL` = `XXL`, `3X` = `3XL` = `XXXL`.
- Every write is logged in `bk_activity` with old value, new value and source email, so a wrong reading can be seen and reversed.

## Migrations

- `0000_baseline.sql` holds the tables that existed before migrations, created with `push`. It is hand-edited to be idempotent: it does nothing on the existing Replit database and builds everything on an empty one.
- `0001_po_36572_intake.sql` adds the new tables and columns. It only adds things, so existing rows and routes keep working.
- `0002` restricted sub-invoice suffixes; `0003` removes sub-invoices entirely (`bk_invoice_number`, `parent_order_id`).
- `0004` adds buyers, the invoice counter, order lines, PO terms on orders, and links colourways to lines. It seeds the four buyers and sets the counter to 4039.
- `0005` relabels pre-invoice synthetic orders `TEST-…`; `0006` adds `bk_intake_cursor`, trim `source_label` / `required`, and `bk_orders.header_source_email_id`.
- `scripts/post-merge.sh` now runs `migrate` instead of `push`.
- Both migrations were tested on Postgres 16 in two cases:
  - a database built with `push` from the previous schema, with sample rows: the rows were kept and a second migrate run did nothing
  - an empty database
- Constraint checks were also tested: invoice format, duplicate invoice, negative quantity, a duplicate `Message-ID`, and one email linked to two orders. Migration `0004` was tested on a database at the `0002` state with data in it: existing orders and colourways were kept.

## Mailbox reader (implemented)

Code: `artifacts/api-server/src/intake/`. Triggered by an admin (`POST /api/admin/intake/run`, with a dry-run option) or on a schedule when `INTAKE_POLL_MINUTES` is set.

1. **Screen envelopes only.** The folder is opened read-only and only envelopes (subject, Message-ID, In-Reply-To, References) are fetched. A message is a candidate when its subject names an allow-listed PO (`INTAKE_PO_ALLOWLIST`) or a known BK invoice, or it replies to a stored or candidate email. Nothing else is downloaded or stored; skipped messages are logged by UID only.
2. **Download and parse candidates**, then process them **oldest first** (by the original sender's date; for manual "Fwd:" copies, the date inside the forwarded block).
3. **Match** per "Email matching" above, using the subject, forwarded subjects and thread headers.
4. **Create the order** when an allow-listed PO is new and the email carries its PO sheet: the buyer is found by sender domain or by the PO sheet's buyer name (e.g. "…SOURCE, LLC" matches "…Sourcing"), and the BK invoice is assigned.
5. **Store** the raw `.eml` and every attachment in private object storage, with text extracted from spreadsheets (PDFs/images are stored as-is).
6. **Apply** PO sheets and trims sheets to orders the email is *matched* to (not `needs_review`), with later-email-wins on every row, and write one change-log entry per attachment listing each old → new value.
7. **Move the cursor** to the last UID scanned (per mailbox folder and UIDVALIDITY) and log the run.

Readers:

- **PO sheet:** recognised by a PO number label plus a colour × size grid. Reads buyer, PO number, PO issue date, ship date, price/payment terms, ship via, country of origin, over-shipment %, the priced table (Style# / Description / Price / Qty / Amount), the colour × size grid (line headings are the rows without numbers), the fabric row (the one stating GSM), and trims named on the PO ("Hang Tag: Not Required"). Tables are found by their headings, never by fixed rows.
- **Trims sheet:** recognised by a description column and a supplier column. Each row becomes a trim keyed by its label ("Size label - Printed Canvas" → `size label`), so a later trims sheet updates the PO's entry for the same item.

Tested on the four sample PO 36572 emails (kept outside git) plus two fictional ones: order created as 4040/BK-SAS/2026; revised prices replaced the original ones and the change log shows both; the later trims sheet turned the PO's "Hang Tag: Not Required" into a required hang tag with its supplier; an unrelated PO email was never downloaded; a short thread reply was matched; re-runs and rescans stored nothing twice; an older PO arriving in a later run changed nothing.

Manual forwards: forwarded blocks from Thunderbird, Gmail, Outlook (with or without a marker line, plain or bold headers), Apple Mail and cPanel webmail are read for the original subject and date; numeric dates are day-first and times without a zone are Pakistan time. A forwarded date later than the forward itself, or more than 3 years earlier, is ignored.

Re-apply (`POST /api/admin/orders/:id/reapply-emails`): re-parses each matched email from storage, corrects `sent_at`, re-applies PO and trims sheets oldest-first, sets "PO received" to the earliest original email if earlier, and logs everything. Running it twice changes nothing.

Known limits:

- A PO mentioned only in an email **body** is not detected (bodies are not downloaded for screening). Use a rescan or, later, manual import.
- PDF attachments are stored but not read (in the samples they are artwork).
- The measurement spec sheet is stored and its text extracted, but not read into tables.

## Next

1. Manual import of a missed email by IMAP UID or Message-ID.
2. Buffer / wastage on top of buyer quantities, once the parameters are supplied.

## Not in scope

- Per-size measurement specs, costing, and shipment splits.
- A staff approval step before extracted data reaches the order (parked; revisit if the trial readings are not reliable enough).
- Buffer and wastage calculations on top of buyer quantities (parameters to come from the owner).
- Any order other than PO 36572 (4040/BK-SAS/2026).
