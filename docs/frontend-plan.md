# Merchandising UI plan

## Scope and ownership

This is a planning handoff, not an implemented feature. The owner approved the
frontend-only work split. The backend developer owns email intake, extraction,
business rules, permissions, database changes, the OpenAPI contract, generated
clients, and document generation. UI work stays in `artifacts/bk-textile/**` and
`artifacts/mockup-sandbox/**`.

API requests and fictional examples are in [ui-api-requests.md](ui-api-requests.md).
Proposed UI paths below are not API routes. The backend developer chooses the
final API paths and operation names in the contract.

## Current baseline

`artifacts/bk-textile/src/App.tsx` already provides the order register, commercial
order form, order detail, readable activity history, and private file attachments.
The current contract supplies `useGetOrders`, `useGetOrder`, `useUpdateOrder`,
`useGetOrderActivity`, and order-file hooks. It does not supply intake/draft/
amendment operations, size × colour quantities, per-order fabrics/trims,
structured field revisions, or generated-document revisions.

Do not parse activity descriptions into structured changes or treat uploaded
attachments as generated, revisioned documents. Do not infer fabric composition,
measurements, or missing business facts from a garment photograph.

## 1. Intake review queue

- **Proposed UI path:** `/merchandising/intake`.
- Add an “Email intake” navigation entry; retain the existing order register.
- Show classification (new order / amendment / question / not order-related)
  separately from review state (pending / confirmed / rejected).
- Columns: received time, client, buyer PO, style, confidence, flagged issues,
  classification, and review state. A multi-order email can have multiple linked
  drafts; do not assume one email equals one order.
- Filter/search using the contract's supported fields and pagination. Show
  “Not extracted” for absent facts; unknown confidence is not zero confidence.
- Open new drafts in draft review, amendments in amendment review, and other
  messages in source detail with only backend-permitted actions.
- Cover loading, empty inbox, no matches, failed extraction, retryable load errors,
  already-reviewed items, and insufficient access. Questions must not silently
  create orders. Never access the mailbox from the browser; the backend reads it over IMAP.

## 2. Draft order review

- **Proposed UI path:** `/merchandising/intake/:intakeId/drafts/:draftId`.
- Desktop: editable extracted fields on the left; original email, attachments,
  and source quotes on the right. Mobile: labelled “Draft” and “Source” sections,
  retaining edits while switching.
- Group commercial fields, size/colour quantities, fabrics, trims, and delivery
  instructions. Highlight missing/conflicting values with text and icons, not
  colour alone. Selecting a source citation reveals the corresponding quote.
- Distinguish absent, explicitly blank, zero, and unconfirmed values. Display the
  backend's editable fields, required fields, and validation messages.
- “Confirm order” previews the reviewed result before submission; “Reject” asks
  for confirmation and a reason. Save a draft only if the backend supports it;
  otherwise label unsaved edits and warn before leaving.
- Confirmation must use the backend review operation, not a separate generic
  create-order request. Disable duplicate clicks and retain input on failure.
- On success, refresh queue/order lists and navigate to the returned order ID.
  On a stale-version conflict, preserve local edits and require comparison with
  the latest draft rather than automatically overwriting it.

## 3. Order detail extension

- **Existing UI path:** `/orders/:orderId`; extend rather than replace it.
- Keep commercial header, order status, notes, attachments, and activity.
- Add a size × colour grid with row/column totals, preserving the backend's size
  order. Distinguish buyer quantity from planned cutting quantity and actual
  production; do not invent allowances or silently reconcile mismatched totals.
- Show separate fabric identities/uses and trims with units. Missing information
  displays “Not provided”, not synthetic production values.
- Add structured revision history: changed field, old value, new value, actor,
  time, reason, source email, and revision. Keep existing activity as a separate
  human-readable feed.
- Keep “Reference attachments” separate from “Generated documents”. Generated
  spec sheets, cutting programmes/letters, packing lists, and department breakdowns
  appear only for document types the backend exposes.
- Each document shows type, template version, source-order revision, document
  revision, creator, time, preparation state, and any outdated-source warning.
  Expand history to preview/download an older immutable copy.
- Offer preview/create actions only when supported and permitted. Preview the
  source revision and missing-field warnings before creating a saved copy.
  Creation does not imply production approval, shipment, or an external send.
- Actual cutting-letter and packing-list templates are still required from the
  owner. The backend developer maps them and generates/stores the documents.
  The UI must not substitute invented layouts or claim generation is implemented.

## 4. Amendment review

- **Proposed UI path:** `/merchandising/amendments/:amendmentId`.
- Show the linked order/reference and original follow-up email. Compare current
  values against proposed values; highlight additions, removals, and conflicts.
- Use structured comparisons for quantity grids, fabrics, and trims. An omitted
  proposed field means unchanged; an explicit removal must be visibly distinct.
- “Approve amendment” confirms the exact change set and base order revision.
  “Reject” requires confirmation/reason. Do not PATCH individual fields and then
  separately mark the amendment approved.
- Backend approval must atomically update the order, preserve its source revision,
  and record the decision. A stale base revision requires refreshed comparison.
- After success, refresh amendment/queue/order/revision/document data and show the
  resulting order. Old generated copies remain downloadable and labelled outdated;
  do not silently replace them.

## Shared implementation and acceptance rules

1. Pull merged GitHub changes before UI work. After backend contract updates,
   regenerate with `pnpm --filter @workspace/api-spec run codegen`; never hand-edit
   the generated packages.
2. Use generated client hooks/operations for backend requests. The presigned
   object-storage upload itself is a separate byte transfer, not a new backend
   endpoint. Request generated binary-download support if a hook needs it.
3. Until matching operations exist, any UI prototype uses clearly labelled
   fictional fixtures only inside `artifacts/bk-textile/**`; no silent mock
   fallback when a real request fails. No new fixtures or screens are built here.
4. Backend permissions determine actions; hidden UI buttons are not security.
   Handle signed-out, forbidden, missing-record, and expired-source states.
5. Render email content as safe text by default; never execute embedded HTML,
   scripts, or attachment instructions. Use authenticated source/file operations,
   not public storage URLs.
6. Preserve unsaved edits, keyboard navigation, focus after errors, accessible
   labels, and readable small-screen comparisons. No optimistic approval.
7. Derive cache keys from generated helpers. After review mutations refresh all
   affected lists/details. Refetch on revisits/window focus and clear user-scoped
   state on auth changes; never discard an in-progress form on background refresh.
8. Implement in order: queue/source view → draft confirmation → enriched order
   detail → amendment review → generated document preview/create/history.
   Each stage waits for its contract operations and fictional acceptance fixtures.
9. Acceptance must include duplicate submission, missing/conflicting fields,
   stale review by a second staff member, rejection, reload persistence, and
   viewing an older document after an amendment. Browser testing belongs to the
   implemented flows, not this documentation-only handoff.
