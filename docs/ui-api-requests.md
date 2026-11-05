# UI → backend requests: Merchandising

**Status:** requested, not implemented. This file is the collaboration channel,
not an API specification. Backend owner: Claude. Frontend owner: Replit Agent.
Do not edit backend/schema/generated files to fulfil these requests from the UI.
The backend developer should resolve these requests in
`lib/api-spec/openapi.yaml` and publish the generated operations. No API route
names below are assumed to exist.

All examples are fictional, contain no source mailbox content, and are not
requests to seed a database. No live company data is approved for this work.
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
Extraction remains on the backend using POP and the existing shared mailbox.
Do not introduce a dedicated mailbox or assume IMAP folders.

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
