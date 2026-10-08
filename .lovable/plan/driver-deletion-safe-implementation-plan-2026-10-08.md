# Driver Deletion — Safe Implementation Plan

Preview only. No migrations, real-record changes or publication until approved. Pending combined release, C1 and Waitlist reconciliation untouched.

## 1. Dependency Audit (live database)

Today "Delete" is a direct browser delete of the application row, blocked only by a waitlist check in the menu. The database then reacts per link:

| Linked record | Current on-delete | Risk |
|---|---|---|
| waitlist.promoted_application_id | Blocks | Source of the FK error |
| application_waitlist_holds | Blocks | Hold history |
| agreements (incl. signed) | **Cascade-deletes** | Signed contracts destroyed |
| documents (driver files) | **Cascade-deletes rows** | Storage files orphaned, still in bucket |
| driver_screenings, lead_documents | Cascade | Screening evidence lost |
| automation_enrollments, resume tokens, upload grants | Cascade | Fine |
| payments, rentals, toll_charges, incidents, inspections, condition_media, messages, outbound_messages | Set to blank | Financial/rental history loses its driver |
| applications.primary_application_id (duplicates) | Set to blank | Duplicates detach |

Conclusion: the existing hard delete is unsafe beyond the waitlist error — it can silently destroy signed agreements and orphan payments and private files. It must be replaced, not just unblocked.

## 2. Deletion Behavior

**Delete Driver (Owner; Managers keep their current permission, not expanded)** — soft delete:
- Stamps deleted_at / deleted_by / reason on the application. Nothing else changes.
- Hidden from Drivers (All, every filter), Waitlist, counts, metrics and searches; active waitlist hold closed (history kept).
- Resume links and applicant upload grants revoked; open automations stopped. No messages sent.
- Fully reversible: Owner "Recently Deleted" view with Restore.
- Refused if the driver has an active rental (end the rental first).

**Delete Permanently (Owner only)**, allowed only on a soft-deleted record:
- Removes: personal answers on the application (name, contact, address, license, SSN-type fields, notes), driver documents and their storage files, screenings, lead documents, recordings, resume tokens, enrollments.
- Retains (anonymized link kept, row becomes "Deleted Driver"): signed agreements and their PDFs, payments, refunds, ledger entries, rentals, tolls, incidents, inspections/condition evidence, audit log.
- The application row is kept as an anonymized tombstone so every retained record still points somewhere — no broken links, no blanks.
- Waitlist rows that point to it are anonymized too; signup date, source and campaign stay so marketing conversion counts don't change.
- Irreversible; requires typing the driver's name.

## 3. Waitlist Foreign Key
Kept as is (no cascade, no disabling). Soft delete never removes the row; permanent delete anonymizes instead of deleting, so the constraint is never hit. The menu-level block message is removed.

## 4. Confirmation Dialog
Shows name, current status, waitlist history yes/no, related applications/duplicates, document count, active rentals, open balances, signed agreements, "Will Be Removed", "Must Be Retained", and Reversible / Not Reversible. Permanent delete adds the typed-name confirmation.

## 5. Safeguards
- All deletes go through Owner-checked server functions (one atomic database function each); direct browser deletes of applications are revoked from staff.
- Idempotent: repeat requests return "already deleted"; row lock prevents double runs.
- Only the selected application (and, if chosen, its own duplicates) is affected — never another driver.
- Storage files deleted server-side after the database step succeeds; failures are logged and retryable, never left publicly reachable (bucket stays private).
- Every action audited with actor, time, reason and what was removed/retained.

## Technical Details
Migration (on approval):
- applications: add deleted_at, deleted_by, deleted_reason, purged_at (nullable).
- Change agreements and documents FKs from cascade to restrict (added NOT VALID-safe, additive) so nothing can cascade-delete them again.
- Functions: soft_delete_application, restore_application, purge_application (security definer, owner check via private.is_owner(), row lock, audit).
- Revoke DELETE on applications from authenticated; update RLS-backed list queries and fleet/driver counts to exclude deleted_at.
- Code: DriversPanel menu + new confirmation dialog, applications.functions.ts server functions, Recently Deleted view.

Tests (temporary fixtures, cleaned up): delete/restore/purge from each status including promoted waitlist applicant and one with a signed agreement + payment; Manager/Coordinator/Driver/signed-out denial incl. direct calls; integrity query showing zero orphans; counts before/after; storage access denied after purge.

## Decisions Needed
- Should Managers keep their current soft Delete, or should deletion become Owner-only?
- Retention period for soft-deleted records before a purge is allowed (suggest none — Owner decides).
