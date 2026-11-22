# UI → backend requests: Merchandising

**Status:** requested, not implemented. This file is the collaboration channel,
not an API specification. Backend owner: Claude. Frontend owner: Replit Agent.
Do not edit backend/schema/generated files to fulfil these requests from the UI.
The backend developer should resolve these requests in
`lib/api-spec/openapi.yaml` and publish the generated operations. No API route
names below are assumed to exist.

All examples are fictional, contain no source mailbox content, and are not
requests to seed a database. Real data is approved only for PO 36572 (BK Inv.
4040) and only in the database; UI mocks and fixtures stay fictional.

**Backend status (updated by the backend owner):**

- Database tables exist for buyers, order lines (style + process + price),
  colourways, size × colour quantities, fabrics, trims, source emails, email ↔
  order links, and attachments (`docs/po-36572-intake-db-plan.md`).
- **Delivered (API 0.3.0, generated hooks available):**
  - `useGetBuyers` — buyers with abbreviations (for the order form's buyer picker).
  - `Order` now carries `buyerId`, `invoiceNumber`, `invoiceRef` (show this as
    the BK invoice), `poReceivedAt`, `poIssueDate`, `endCustomer`, price/payment
    terms, `shipVia`, `countryOfOrigin`, `overShipTolerancePct`.
  - `useCreateOrder` assigns the BK invoice automatically and **requires a PO**;
    send `buyerId` from the buyer picker (a typed name/abbreviation also works).
    Errors: 400 (missing PO / unknown buyer), 409 (PO already exists for that buyer).
  - `useGetOrderBreakdown` — priced lines, colours under each line, the size
    grid (`sizeLabels` gives column order; a missing size means "not on the PO",
    not zero), per-colour/line/order totals and `quantityMismatch`.
  - `useGetOrderFabrics`, `useGetOrderTrims`.
  - `useGetOrderEmails` / `useGetOrderEmail` (plain-text body: render as text),
    `useUpdateOrderEmail` (confirm/ignore a `needs_review` link, fix category),
    `downloadOrderEmailAttachment` (always a download).
  - `useGetOrderActivity` rows now include `source` (staff / email_intake /
    system), `action`, `details.changes[{field, from, to}]` and `sourceEmailId`
    for the change log.
  - `useGetCurrentUser` → `isAdmin`; admin-only `useGetInvoiceCounter`,
    `useSetInvoiceCounter`, `useSetOrderInvoiceNumber` (each needs a reason).
    Show these controls only when `isAdmin` is true; the server enforces it anyway.
- **API 0.4.0:** `OrderTrim` gains `required` (show "Not required" rows
    greyed out) and `sourceLabel`. Admin-only `useRunEmailIntake` runs the
    mailbox reader: offer "Preview (dry run)" and "Read mailbox now" buttons
    in the admin panel and show the returned summary (per email: outcome,
    orders, and per attachment: kind, number of changes, warnings).
- **API 0.5.0:** admin-only `useReapplyOrderEmails(orderId)`: add a "Re-apply emails" action next to "Override invoice number" on the order page, with a confirmation that staff edits to the same fields will be overwritten, then show the report (per email: original date, and per attachment: kind and number of changes) and refresh the order.
- **API 0.6.0 — users and access (must be reflected in the UI):**
  - `useGetCurrentUser` now returns `status`, `role`, `department`, `areas`
    (`dashboard`, `merchandising`, `department_work`, `materials`, `quality` →
    `none`/`read`/`write`), `permissions` and `canManageUsers`.
  - **Pending/disabled users:** when `status` is `pending`, show only a
    "Waiting for administrator approval" screen (with the user's email and Sign
    out); `disabled` → "Your access has been removed". Every other API call
    returns 403 with `code: "pending_approval"` / `"disabled"` for them.
  - **Navigation:** show a section only if its area is not `none`
    (Operations desk → dashboard, Order register → merchandising, Department
    work → department_work, Materials & lots → materials, Quality → quality).
    With `read`, hide create/edit/save controls.
  - **Special actions:** invoice panel and "Override invoice number" need
    `invoice_override`; "Read mailbox" and "Re-apply emails" need
    `intake_run`; "Create order" needs merchandising `write` +
    `commercial_edit`; in "Edit order", buyer, PO, value/currency, terms,
    ship via, country, over-shipment %, quantity and dates are editable only
    with `commercial_edit` (style, notes, status and priority need only
    merchandising `write`). Don't use `isAdmin` for these any more.
  - **New "Users & access" page** (only when `canManageUsers`):
    `useListUsers` (pending first, with a count badge in the navigation);
    per user: approve / disable, department (Department enum), a None/Read/
    Write selector per area, checkboxes for the three special permissions,
    and an "Apply department template" helper from `useGetAccessTemplates`;
    save with `useUpdateUserAccess`. For the administrator only:
    "Make deputy" / "Remove deputy" (`useSetUserRole`) and "Transfer
    administrator role" (`useTransferAdmin`, body `{confirm: true}`, behind a
    typed confirmation). Show server error messages as returned (e.g. you
    cannot change your own access).
- **API 0.9.0 — documents (frontend to build):** see the "Documents" brief below.
- **API 0.8.0 — customisable dashboards (frontend to build):** see the
  "Dashboards" brief below.
- Not yet: manual import of a missed email, staff editing of
  lines/grid/fabrics/trims.
- Owner decisions that change these requests:
  - The buyer's **PO number is the key**. One PO = one order = one BK invoice,
    shown as e.g. `4040/BK-SAS/2026`. No sub-invoices.
  - During the trial, email data goes **straight into the order**; there are no
    draft or amendment approval steps. Requests B and D are parked. Request A
    becomes a per-order **Emails** list; Request C (order detail with lines,
    size grid, fabrics, trims and a change log with old → new values) is next.
  - The later email wins; the change log shows what each email changed.
- Request E (generated documents) waits for the owner to supply the
  cutting-letter and packing-list templates.
There are currently no new UI mock fixtures; if prototypes are added before
endpoints, keep them clearly labelled inside `artifacts/bk-textile/**` and list
their location here.

## Already available

- Order list/detail/create/update and human-readable order activity.
- Private order-file listing, upload request/completion, download, and preview.
- These existing attachments have no document/template/source revision metadata.
  Current `Order` has a total quantity but no size/colour grid, fabrics, or trims.
- Existing activity has description text, not structured old/new field values or
  linked source emails. It cannot safely satisfy the requested revision display.

## Request A: intake queue and safe source access

**Screens:** intake queue and source panel.

Please expose paginated intake summaries with stable IDs, received time,
classification, separate review/extraction states, client/buyer PO/style summaries,
linked draft/amendment/order IDs, confidence with an explicit scale, and flagged
issues. Support search/filter criteria and return pagination information.
An email may relate to several drafts/styles. Document sort order, nullable
fields, supported filters, and whether classification can be corrected by staff.

Expose safe source email text, subject, sender display information, attachment
metadata, and stable source quote IDs. Provide authenticated access operations
for attachments; do not send mailbox credentials or public object URLs.
Extraction stays on the backend, which reads `orders@bktextile.com` over IMAP
(see `replit.md` → Email intake). The browser never touches the mailbox.

**Example summary shape (illustrative):**

```json
{
  "id": "example-intake",
  "classification": "new_order",
  "reviewState": "pending",
  "client": "Example Buyer",
  "poNumber": "DEMO-100",
  "style": "DEMO-HOODIE",
  "confidence": { "value": 0.84, "scale": "zero_to_one" },
  "issues": [{ "field": "deliveryDate", "code": "missing" }],
  "draftIds": ["example-draft"],
  "amendmentIds": []
}
```

Names/enum values are proposals only; the published contract is authoritative.
Include failure/extraction-in-progress states and what actions are permitted for
questions and non-order messages.

## Request B: reviewable drafts and atomic decisions

**Screen:** draft order review.

Provide a draft detail operation containing extracted commercial fields,
size/colour quantities, fabrics, trims, instructions, source links, per-field
confidence, missing/conflicting-field issues, editable fields, allowed actions,
and a concurrency version. Provide validation requirements in a machine-readable
form where they vary by draft.

Provide confirm/reject operations. Confirmation should accept reviewed values
and the expected draft version, deduplicate retried submissions, then create/link
the order and mark the intake reviewed as one backend action. Return the order
ID, reference, resulting revision, and final review state. Rejection should
preserve the source and record a reason/actor/time. Declare whether saving an
unfinished review is supported and define null/omitted/empty update semantics.

**Example confirmation input (illustrative, not a complete required schema):**

```json
{
  "expectedDraftVersion": 3,
  "submissionId": "example-review-attempt",
  "reviewedValues": {
    "buyer": "Example Buyer",
    "poNumber": "DEMO-100",
    "style": "DEMO-HOODIE",
    "quantity": 100,
    "deliveryDate": "2027-01-15"
  }
}
```

Return field-addressable validation issues and a defined stale-version response
so the UI can retain input and compare against fresh data. Do not accept a
client-supplied actor, order reference, or decision timestamp as authoritative.

## Request C: enriched order detail and structured revisions

**Screen:** existing order detail.

Provide size/colour rows with stable IDs, explicit units and size ordering,
buyer/planned/actual quantity distinctions where supported, totals, and
validation warnings. Provide per-order fabric identities/uses, quality/content,
GSM, width with unit/presentation, and trims/specifications/quantities/units.
State edit ownership and allowed actions rather than assuming all staff can edit.

Provide order revision identifiers and structured changes containing field paths,
typed old/new values, actor/time/reason, source email/quote links, and the source
and resulting revisions. Return enough history pagination data for older changes.
Missing values must remain missing; do not infer specifications from images.

**Example change (illustrative):**

```json
{
  "field": "quantities[row-demo].buyerQuantity",
  "oldValue": 40,
  "newValue": 50,
  "sourceEmailId": "example-followup",
  "sourceQuoteId": "example-quote",
  "fromRevision": 4,
  "toRevision": 5
}
```

## Request D: amendment comparison and atomic approval/rejection

**Screen:** amendment review.

Provide amendment IDs, linked order/source, decision state, concurrency version,
base order revision, current values, proposed values, explicit removals, source
quotes, issues, and allowed actions. The comparison must include nested
quantities/fabrics/trims; an omitted value must not mean deletion.

Approval input needs the expected amendment version, expected order revision,
and a retry-safe submission identity. Backend approval applies the change set
and records the revision/decision atomically, returning the resulting order and
revision. Reject records the reason without altering the order.
Define stale comparisons, already-approved/rejected requests, changed proposals,
and validation failures; return enough information to refresh the comparison.

**Example conflict (illustrative):** a proposal was prepared against revision 4,
but another staff member advanced the order to revision 5. Approval must be
blocked pending a fresh comparison, not silently applied over revision 5.

## Request E: generated document review, creation, and revision history

**Screen:** generated documents section on order detail.

The backend developer owns the generator and template mapping. The actual
cutting-letter and packing-list layouts are still missing; the owner must supply
them before those document types can be implemented faithfully.

Please expose:

- Available document types/templates, template version, required/missing fields,
  allowed actions, and preparation/generation state. Include spec sheets,
  cutting programmes/letters, packing lists, or department breakdowns only when
  supported; confirm their final type names in the contract.
- A reviewable preview tied to an exact order revision and template version.
  Declare whether previews are temporary and how expired previews are refreshed.
- Retry-safe creation from the reviewed preview/source revision; reject a
  changed order/template rather than quietly generating a different document.
- Saved immutable document revisions with document ID, order ID, type, document
  revision, source-order revision, template/version, creator/time, file metadata,
  and authenticated preview/download operations.
- A paginated revision listing and an outdated-source indicator. Regeneration
  creates a new copy; older copies remain accessible with their original data.
- Clear permission, missing-template, missing-field, generation failure, and
  stale-preview responses. Return pending/job IDs and a status operation only
  if creation is asynchronous.

**Example list item (illustrative):**

```json
{
  "id": "example-document",
  "orderId": "example-order",
  "type": "cutting_letter",
  "documentRevision": 2,
  "sourceOrderRevision": 5,
  "templateId": "example-template",
  "templateVersion": 1,
  "outdated": false,
  "state": "ready",
  "contentType": "application/pdf"
}
```

Please generate typed client support for binary preview/download operations.
The UI should not have to hand-code backend URLs or expose storage object paths.
Document creation must save metadata and private file content with the order;
UI-only downloads are not a substitute for durable revision history.

## Contract handover checklist

- Publish paths, operation IDs, enum values, required/nullable fields, request/
  response envelopes, pagination, permissions, and documented error statuses.
- Agree on field paths for nested validation issues and structured old/new data.
- Supply fictional examples for missing fields, conflicting values, duplicate
  submissions, concurrent review, rejection, and outdated document copies.
- Declare which IDs/revisions affected lists and details should refresh after
  each mutation. A successful response must make results visible after reload.
- Owner merges backend pull requests; UI pulls them and runs
  `pnpm --filter @workspace/api-spec run codegen` before using generated hooks.
- Track request status here as operations are delivered; do not mark any request
  complete merely because this planning document exists.


## Brief: customisable dashboards (API 0.8.0)

Build in `artifacts/bk-textile` only, using the generated hooks. Use a charting
library (e.g. Recharts) and a draggable/resizable grid (e.g. react-grid-layout,
12 columns); add them as UI-only dependencies.

1. **Operations desk becomes the dashboard.** On load, `useListDashboards`:
   show the user's default dashboard (`isDefault`), else `template`. Tabs or a
   picker switch between the user's saved dashboards (up to 10).
2. **Widgets.** For each widget call `useGetDashboardSourceData(source, {params})`
   and render by `viz`:
   - `kpi`: one big number per row (`labelKey` = label, first `valueKeys` = value);
   - `table`: all `columns` (format `date` and `money` columns);
   - `bar` / `line`: x = `labelKey`, one series per `valueKeys`;
   - `pie`: `labelKey` vs first `valueKeys`.
   Show `note` when present, an empty state when `rows` is empty, and a
   "No access" placeholder when `accessible === false` (do not call the data
   hook then). Title = widget `title` or the source's `title`. Each widget has
   a refresh button; refresh all every few minutes while the page is open.
3. **Edit mode** ("Customise" button): drag and resize widgets; "Add widget"
   opens a picker from `useListDashboardSources` (title, description) then lets
   the user choose a visualisation from the source's `visualizations` and its
   `params` (enum → select, integer → number with min/max); per-widget menu:
   change visualisation/options/title, remove. "Save" → `useUpdateDashboard`
   (or `useCreateDashboard` when editing the template for the first time:
   "Save as my dashboard"). "Cancel" discards. Also: rename, "Make default",
   "Duplicate", "Delete" (`useDeleteDashboard`), and "Reset to department
   template" (delete own copy). Show server validation messages as returned.
4. **Templates (administrators/deputies only, `canManageUsers`):** on the
   Users & access page (or a "Dashboard templates" page), list
   `useListDashboardTemplates`, edit one per department (plus "Everyone" = `*`)
   with the same editor, save with `useSaveDashboardTemplate`, remove with
   `useDeleteDashboardTemplate`. Note on screen: people only see the widgets
   their access allows.
5. Keep the existing summary cards working until the new dashboard replaces
   them; the old `useGetDashboardSummary` stays available.


## Brief: documents — cutting programs and packing lists (API 0.9.0)

Build in `artifacts/bk-textile` only, using the generated hooks.

1. **Order page → new "Documents" tab** (`useListOrderDocuments`): one card per
   type (Cutting program, Packing list) showing the latest revision with a
   status badge (Draft, In review, Changes requested, Approved, Superseded),
   revision number, prepared by, approved by/at, and an **"Out of date"**
   warning when `outOfDate` is true ("order data changed since approval —
   create a new revision"). Older revisions in a collapsible history list.
   Buttons: "Create" / "New revision" (`useCreateOrderDocument`, only with
   the `prepare_documents` permission), "Open", and "Download Excel" /
   "Download PDF" (`downloadOrderDocumentFile` with format `xlsx` / `pdf`;
   drafts are watermarked).
2. **Document page** (`useGetOrderDocument`): render `data` as on paper —
   letterhead (`data.company`), document number, and one section per finish:
   cutting program = table Style / Colour / Size / Actual / +allowance / Total
   with totals; packing list = description lines, Total pcs / dozens /
   cartons, and table Carton # (from–to) / PO / Style / Colour / Size /
   Actual qty ("-" when null) / Cartons / Qty per carton / Total pcs.
   Show `problems` as a red list (they block "Send for approval").
   Use the floor's size names on screen, as on paper: cutting program
   2XL → "2X", 3XL → "3X"; packing list S → "SMALL", M → "MEDIUM",
   L → "LARGE", 2XL → "2X". The downloaded Excel/PDF are the official
   layout (Times New Roman, centred, the factory's existing format); the
   on-screen view only needs to be a clear, faithful preview.
3. **Editing a draft** (when `canEdit`): allowance % (default 5), pieces per
   carton, previous reference, remarks, and per finish: description lines and
   quality line (`useUpdateOrderDocument`). Live preview refreshes from the
   response. "Send for approval" (`useSubmitOrderDocument`) when `canSubmit`.
4. **Reviewing** (status In review): if `approvalBlocker` is null show
   "Approve" (optional note; `useApproveOrderDocument`) and "Request changes"
   (required note; `useRequestOrderDocumentChanges`); otherwise show the
   blocker text (e.g. "You prepared or edited this document…"). Confirm
   before approving: "Approved documents are permanent and cannot be edited".
5. **"Awaiting my approval"** (`useListDocumentsAwaitingApproval`): a list
   (and a badge in the navigation) linking to each document.
6. **Order page:** "Responsible merchandiser" picker for
   administrators/deputies (`useSetOrderResponsible`, active users), and the
   new order fields **Pieces per carton** and **Garment description**
   (editable with merchandising write).
7. **Company profile** (administrators/deputies, e.g. on Users & access):
   name, up to 4 tagline lines, address (`useGetCompanyProfile`,
   `useSaveCompanyProfile`).
8. Users & access: the two new permissions **Prepare documents** and
   **Approve documents** appear with the other special permissions.
