# Proposed Vehicle Readiness Guard Correction — NOT APPLIED

## Scope and dependency

Depends on PR 321 (visible field errors, preserved drafts, edited-field writes and confirmed readback). This branch does not include PR 320, app-wide formatting, upload changes, PR 314, activation changes or customer data updates.

The live `BEFORE UPDATE` guard selected the stored vehicle to validate it. That observes the old weekly rate/identity, so one valid update that supplies a rate and changes status to Available could be rejected. Conversely, a proposed invalid identity could be evaluated against valid old values. The proposed function validates `NEW` atomically.

Only `public.guard_vehicle_ready_status()` is replaced. Its existing INSERT / UPDATE OF status, weekly_rate attachment stays unchanged. Existing required year, nonblank make/model, valid-format VIN and positive weekly rate stay required on entry to Available/Reserved and on rate changes while in those states. Non-finite numeric rates are also rejected, matching the app's finite-rate check. Unchanged posted status/rate values no longer revalidate unrelated legacy-record edits. This does **not** widen the trigger to unrelated column-only updates or change rental activation.

No migration statement updates vehicles, backfills records, changes a vehicle status, relaxes RLS, grants client execution, changes an enum or sends anything. SECURITY DEFINER/owner and existing ACLs are retained; search_path is pinned empty because the function no longer needs to query any table.

## Exact migration fingerprint

SHA-256: `c05937828e7c0e37b9f06765b5009a62223744ab79e3e3f615f94b9f0c931d71`

## Approval required before production

Approval must explicitly cover applying `20261108131345_vehicle_ready_validate_proposed_row.sql` to REAL RENTALS project `8cf1f99e-71ad-4a93-a47c-bfbe833616d6`, merging the approved PR 321 + this follow-up into the integration branch, and publishing that reviewed application tree. Preparing this file did not authorize applying it. No production application or publish was performed.

## Exact release sequence after approval

1. Re-read the project's latest editor commit, integration head, the existing trigger attachment/function definition/owner/ACL and migration history. Stop if they differ unexpectedly from the reviewed baseline. Preserve the freshly read prior function definition for rollback; compare it with the review-only rollback file.
2. Re-test the exact approved combined application tree with `PG_BIN=/tmp/pgbin npm test`, `npx tsc --noEmit`, `npm run build` and the synthetic browser save suite. The local PostgreSQL suite applies this migration to a temporary database and tests rollback/reapply. Never substitute real vehicles for test fixtures.
3. Apply **only** the named migration through the sanctioned project database/migration tool in a transaction. Do not run an indiscriminate database push or apply other pending migrations. The database change is backward-compatible with existing callers and should precede publishing the frontend fixes.
4. Read metadata only: verify the new function definition, unchanged trigger attachment, same owner, pinned search_path and no PUBLIC/anon/authenticated execution grants. Do not save/update a production vehicle for verification, even inside a rolled-back test transaction.
5. Merge only the approved PRs into `integration/grok-baseline-2026-10-22` (not main/staging). Verify the merge tree exactly equals the tested tree, and verify Lovable editor sync to that exact commit. Publish once using the official project connector. If deployment is pending/ambiguous, only read status/live metadata; never republish speculatively.
6. Verify fresh public HTML deployment/commit and matching admin bundle. A real vehicle edit, if desired, must be performed by the user or separately authorized; no automatic customer-data write is part of this plan.

## Rollback (separate approval required)

`vehicle-ready-proposed-row.rollback.sql` restores only the prior trigger function, with its prior security/search_path and existing execution revocations. The local suite executes it and proves the old failure returns, then reapplies the fix successfully. Do not automatically reverse successfully saved vehicle details/rates/statuses: those were valid user edits. No backfill or customer-data rollback is included. If the live preflight definition differs, use the newly captured definition instead and stop for review.

## Validation inventory

- Old guard reproduction: no-rate + Available rejects the entire update.
- Proposed rate + Available/Reserved and proposed identity corrections succeed together.
- Missing, zero, negative and non-finite rate failures roll back every edited field.
- Missing year, blank make/model and invalid VIN remain failures evaluated from NEW.
- Existing non-null body type/plate/state/color survive a rate/status-only edit.
- Unrelated legacy edits work; unchanged posted status/rate does not re-trigger readiness.
- Invalid INSERT fails, valid INSERT succeeds; returned rows/readbacks checked.
- Trigger attachment, internal execution ACLs and security configuration verified locally.
- Migration itself changes no existing rows; rollback/reapply verified locally.
- Real Edit Details browser fixture shows submitted request, normalized write patch and last confirmed row separately. It exercises focused error feedback, draft preservation, valid rate/status and unchanged-field retention, plus network, permission and unconfirmed-readback failures.

The browser fixture simulates responses and never connects to production. The actual SQL migration/guard behavior is independently exercised in local PostgreSQL.
