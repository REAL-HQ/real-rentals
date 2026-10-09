# Smart Vehicle Document Upload — Implementation Plan

## What already exists (reuse, don't rebuild)
| Need | Existing piece |
|---|---|
| Drag-and-drop, Browse, multiple files, previews, progress, Retry, validation | `FileUploader` (`src/components/FileUploader.tsx`) |
| Modal look | Existing admin dialogs (e.g. `ApplyTemplateDialog.tsx`, `modal.tsx`) |
| Private storage + per-slot saving with expiry and superseded history | `vehicle-docs` bucket + `registerVehicleDoc` (`vehicle-docs.functions.ts`) |
| Reading documents (registration, insurance, title, purchase, inspection) | Fleet Inbox: `registerInboxFile` → `analyzeInboxItem` → `buildItemProposals` (uses `document-reader.server.ts`) |
| Field-by-field proposals with current value, confidence, conflicts, VIN matching | Fleet Inbox proposals + `getImportBatch` |
| Explicit apply with provenance and history | `applyImportDecisions` + `vehicle_field_provenance` + audit log |
| Shared PDFs covering several cars (one file, many links) | `document_vehicle_links` + `listVehicleLinkedDocs` |
| Title reading | `scanVehicleTitle` (already shares the reader) |
| Owner-only finance/title data | `isFinanceKind`, `getVehicleDocAccess`, Owner-only title table |
| Readiness updates | Existing readiness rules read the same records — no new logic |

## Gaps
1. Upload opens the file picker directly; no modal with vehicle header and preselected type.
2. Fleet Inbox review lives on its own page; nothing shows it inline for one vehicle.
3. Safe Autofill is currently **On** (50/day) and could apply values automatically to inbox items — it must never run for modal uploads.
4. No "this document also covers RR-00X" confirmation inside the vehicle view.

## Shortest path
1. **Upload modal** (`VehicleDocUploadDialog.tsx`): vehicle unit and description, document type preselected (changeable), `FileUploader` in multi-file mode, the expiry date field moves into the modal. The Upload button on each row opens it. *About half a day.*
2. **Pipeline**: each file goes through the existing Fleet Inbox path, as a one-vehicle batch tagged as a modal upload, with the chosen type passed as the starting class. No second reader and no duplicate storage. Safe Autofill is skipped for these items on the server. *About half a day.*
3. **Review screen** in the same modal: reuses Fleet Inbox proposals. Each field shows its name, current value, value read from the document, confidence, and an Apply checkbox (unchecked when there's a conflict). VIN mismatches and expired documents are flagged in red. Apply calls `applyImportDecisions`. "Save document only" stays available. *About 1 day.*
4. **Shared documents**: when the reader finds other full VINs, list the matching vehicles with checkboxes. Confirming adds links to the same file, never copies. *About half a day.*
5. **Tests**: synthetic PDFs and images only; covers roles, mismatches, storage failure, mobile, no unintended updates. *About half a day.*

Total: about 3 days.

## Security
- Server checks stay as they are. Coordinators can view but not apply. Finance and title fields are Owner-only on the server, not just hidden.
- Files stay in private storage. Insurance uploads never count as verified coverage.
- Nothing changes a vehicle without an explicit Apply. Original values are kept in the field history.

## Dependencies and approvals
- **Paid reading**: document reading uses the existing paid Anthropic connection, the same one Fleet Inbox already uses. Each upload costs a small amount; existing daily limits apply.
- **Database**: expected to need no migration. If tagging modal batches needs a new column, it waits behind the approved migration order.
- Out of scope: publishing, real vehicle edits, Resume, Identity Review, eSign, Manual Payments, Codex branches.
