# Driver Deletion — Revised Migration & Deployment Plan

Nothing applied or published. Separate from the pending combined release and the historical Waitlist reconciliation. No real applicant is touched during testing.

## 1. Permission Matrix (enforced in database functions and server actions)

| Action | Owner | Manager | Coordinator | Driver | Signed-out |
|---|---|---|---|---|---|
| Set status Closed | Yes | Yes | Yes (unchanged today) | No | No |
| Delete Driver (soft) | Yes | No | No | No | No |
| Restore Driver | Yes | No | No | No | No |
| Delete Permanently | Yes | No | No | No | No |
| Retry File Cleanup | Yes | No | No | No | No |
| View Recently Deleted | Yes | No | No | No | No |
| Set / clear Legal Hold | Yes | No | No | No | No |

Every database function starts with an Owner check (fails with "Forbidden" for anyone else, even when called directly). Every server action also calls requireOwner first. Signed-out callers cannot run the functions at all.

## 2. Data Retention Rules

**Delete Driver (reversible):** nothing is erased. The record is hidden from Drivers, Waitlist, counts, metrics and searches. Resume links and upload permissions are revoked, open automations stopped, active Waitlist hold closed (history kept). Refused if the driver has an active rental.

**Delete Permanently (irreversible)** — allowed only after Delete Driver, and refused when: Legal Hold is on, an active rental exists, or an unpaid/partial charge is open.

| Record | Treatment |
|---|---|
| Application personal fields (name, email, phone, birth date, address, license number/photo, notes, card details, consent phone/text, insurance policy details) | Erased; row kept as "Deleted Driver" tombstone so every link stays valid |
| Lead source, campaign, signup date, status, dates | Kept (marketing conversion history) |
| Identity documents: License Front, License Back, Insurance, Insurance Card, Gig Profile, Trip History | Removed with files — unless linked to a money record, vehicle or agreement |
| Agreements (signed or not) and their PDFs | Always kept |
| Payment confirmations, receipts, repair/service invoices, condition photos, title, registration, Unknown | Always kept |
| Payments, refunds, ledger, deposits, rentals, tolls, incidents, inspections, condition media, odometer | Always kept, still linked to the tombstone |
| Screening / interview records | Anonymized, not erased: personal free text and identifiers cleared (notes, insurance policy number, carrier phone, recording link); decisions, scores, verification outcome and dates kept |
| Waitlist entries pointing to the driver | Name, email, phone erased; signup date, source, campaign, promotion link kept |
| Messages / outbound message log | Kept (communication history); content review is a future decision |
| Audit history | Kept; new entries name the record by id only, not by person |

Retention periods are not invented: there is no automatic expiry. The Owner decides when to purge; Legal Hold blocks it.

## 3. Database Changes (two stages)

**Stage 1 — additive only, safe to apply while the current site is live (migration 0016):**
- applications: add nullable deleted_at, deleted_by, deleted_reason, purged_at, legal_hold (default false).
- New Owner-only table deletion_events: application id, action (deleted/restored/purged/hold), actor, time, counts and document categories removed/retained — no personal data.
- New Owner-only table deletion_file_jobs: bucket, path, status (pending/done/failed), attempts, last error, times.
- Functions soft_delete_application, restore_application, purge_application, set_legal_hold — each Owner-checked internally, row-locked, idempotent ("already" on repeats).
- No change to existing policies, the Delete permission or foreign keys. The live Delete button keeps working exactly as today.

**Stage 2 — applied right after the new code is published (migration 0017):**
- Staff view/update policies on applications exclude deleted rows; Owner-only read policy for deleted rows.
- Remove the Manager raw-delete permission; revoke direct delete from signed-in users.
- Agreements and documents: change "delete along with driver" to "refuse".
- Waitlist and hold links already refuse; unchanged.

## 4. Backward-Compatible Deployment

```text
1. Apply 0016 (additive)        -> live site unaffected; old Delete still works
2. Build + test in preview      -> new UI calls only the new functions; preview hides
                                   deleted rows in its own queries until Stage 2
3. Your approval to publish     -> publish new code (Delete menu Owner-only)
4. Apply 0017 immediately after -> raw delete closed; RLS hides deleted rows
5. Live verification
```
Between steps 3 and 4 (minutes) the old raw delete is still possible only for Managers via direct calls; no UI exposes it. If any step fails, stop at the prior step — the feature stays unpublished.

## 5. Storage Cleanup

- Purge removes eligible document rows and queues each file in deletion_file_jobs in the same database step.
- A server action then deletes queued files from the private bucket; success marks done, failure records the error and attempt count.
- Owner sees "File Cleanup: N pending / N failed" in Recently Deleted with Retry. Retries are idempotent (missing file = done).
- Buckets stay private; with the document rows gone no app path can serve the files, so a failed cleanup never becomes public.

## 6. Test Plan (temporary fixtures only, then removed)

- Fixtures: one temporary applicant per status (New, Reviewing, Waitlisted, Approved, Active-no-rental, Suspended, Declined, Closed), a promoted-from-Waitlist applicant, and one with a signed agreement, a payment, a condition photo and a screening.
- Authorization: Owner succeeds; Manager, Coordinator, Driver denied (server action and direct function call); signed-out denied. Requires temporary Manager/Coordinator test roles on temporary users, removed afterward.
- Integrity: zero orphaned links after soft delete and purge; protected records unchanged (row counts + checksums); Waitlist signup date/source unchanged; other drivers unchanged; repeat requests idempotent; active rental / open charge / Legal Hold block purge.
- Storage: purged files unreachable; forced failure shows Failed and Retry succeeds.
- Before/after counts for Drivers, Waitlist and Overview.
- Rolled-back SQL tests run through the migration test harness, since the read-only test session cannot create functions.

## 7. Rollback

- Stage 2 rollback: restore the previous view/update policies and Manager delete permission; keep agreements/documents on "refuse" (no return to cascading deletion).
- Stage 1 rollback: drop the four new functions; leave new columns and tables in place, marked deprecated.
- Permanent deletions cannot be undone by design; deletion_events records what happened.

## 8. Remaining Risks

- Short window between publish and Stage 2 (mitigated: no UI path, Managers only).
- Retention periods and screening policy are your business/legal decision; defaults keep more rather than less.
- Messages may contain personal details and are kept.
- Coordinator/Manager live tests need temporary role accounts.

## Technical Notes
- Server actions in a new src/lib/driver-deletion.functions.ts (requireOwner + context.supabase RPC as the user); storage worker in driver-deletion.server.ts.
- DriversPanel: Delete menu shown only to Owner; confirmation dialog with counts of what is removed/retained; Recently Deleted view.
- AGENTS.md rule added once implemented.
