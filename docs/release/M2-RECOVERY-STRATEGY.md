# M2 recovery strategy without PITR (2026-10-24)

The owner has **not** approved accepting up to 24 hours of data loss. This note finds the smallest
supported recovery point for each window. Nothing here has been executed. Every production action
below needs its own approval.

## What the platform supports (Lovable Cloud docs, read via search; direct access blocked by the proxy)

| Capability | Supported | Limits |
|---|---|---|
| Point-in-time recovery | **No** | — |
| Automatic backups | Daily, about 14 days | No manual trigger. Restore is in place, irreversible, a few minutes down, loses everything after the snapshot, and rolls back the schema. |
| **Export project data** (More → Database → Manage → Settings) | Yes, owner-initiated, on demand | Once per 24 h; database ≤ 15 GB, file ≤ 5 GB. Format is a PostgreSQL archive (`pg_restore`); the docs also call it an SQL dump, so check the file. Lovable emails you and saves the file in the project's storage. Includes auth password hashes. **Database only: no Storage files, functions or secrets.** |
| Per-table CSV | Yes | One table at a time; not consistent across tables. |
| Storage file backup | **None** | Download from More → Storage only. |

**The export is not PITR.** It is a consistent snapshot of the database at one moment. Lovable offers
no way to load it back into this project. Its use is to:
1. prove what the pre-window state was;
2. extract specific rows for a targeted repair;
3. rebuild in a new project as a last resort.

No supported method gives an in-place, consistent database-plus-Storage restore point.

## What M2 actually changes (from the packet at `95d921dd`)

- **No install file rewrites existing rows.** Every `UPDATE`/`INSERT`/`DELETE` is inside a function
  body. Outside function bodies there is only DDL, triggers, policies and grants. Each file is one
  transaction.
- **Storage bytes are never modified.** Steps 21 and 23 add triggers that *refuse* overwrite or
  delete of immutable objects. Step 2's recorder writes only `storage.objects.user_metadata`.
- **Rollback guards after real use:** only step 3 (`00_rollback_unused_install_only`) and step 9
  (`06b_rollback_unused_install_only`) refuse, once a verified approval-identity row exists. No
  other rollback has a use-guard.

## Window 1 (steps 1–2, hash backfill): SQL-recoverable, no platform restore needed

| Change | Undo | Gap |
|---|---|---|
| Steps 1–2 (schema and functions) | `rollback/record-uploaded-content-sha.sql`, then the hosted variant of `01-auth-binding.sql` (rehearsed) | none |
| Backfill: `documents.content_sha256` (NULL → hash), `private.uploaded_content_sha`, `storage.objects.user_metadata.sha256` | `proposed/rollback/backfill-content-sha.sql` (owner undo) | the recorder **removes** any existing client `user_metadata.content_sha256` key; the undo does not put it back |

To close the gap, before the backfill:
1. **One read-only aggregate query:** count `storage.objects` rows referenced by current
   license documents whose `user_metadata ? 'content_sha256'`. It returns counts only, never values.
2. If the count is 0, the undo is exact. If it is above 0, run a guarded **pre-image capture**: copy
   `(id, bucket_id, name, user_metadata)` for those objects, plus `(id, content_sha256)` of the
   affected documents, into an owner-only `private.m2_w1_preimage` table in one transaction. The undo
   then restores them exactly. This is to be built and rehearsed in the harness.

With the Lovable export taken immediately before as the forensic baseline, Window 1's recovery
loses no customer activity.

## Window 2 (steps 3–29): NO-GO until the post-use path exists

| Situation | Recovery | Customer activity lost |
|---|---|---|
| A file fails mid-window | atomic; INSTALL.md stop-point table (rehearsed) | none |
| Defect found **before the first real approval** | full reverse rollback 29 → 1 (rehearsed) | none |
| Defect after use, in steps 14–29 | their rollbacks have no use-guard. With the Record Rental flags off, their tables should be empty; assert that read-only first | none |
| Defect after use, in steps 1–13 | **forward fix** through the same guarded route, or the **evidence-preserving rollback** below | none |
| Platform-level loss unrelated to M2 | Lovable daily backup plus the pre-window export | up to the snapshot age |

**Evidence-preserving rollback (not built yet).** The packet already names this path in the step 3
rollback header: export the evidence, migrate it, remove it, then roll back. Its export
(`00-approval-data-export.sql`) uses `COPY … TO STDOUT`. On the hosted route that would hand
customer evidence to the operator, so a hosted version must instead:
1. archive `private.approval_operations`, the approval-identity rows and their evidence payloads
   into an owner-only, append-only table in the same transaction;
2. remove them;
3. run the 9 → 1 rollbacks.

Applications stay approved, `audit_log` keeps every entry, and payments, agreements and rentals
are untouched. What changes is that archived reviews stop being enforceable under the restored
check. The step 9 header warns about this, so it is an owner decision.

**Safeguards before Window 2 GO:**
1. Build the evidence-preserving rollback and rehearse it in the harness: install, real approvals,
   archive, roll back, verify that approvals work again on Release A's legacy path, and that row
   counts for applications, audit, payments and agreements are unchanged.
2. A **first-approval checkpoint.** After step 29's verify, nobody approves until the owner signs
   off on Release B's read-only checks. Up to that point, everything is reversible by SQL.
3. Take the Lovable export immediately before the window.

## Testing the restore outside production

The owner runs **Export project data** on the disposable project `c27f585c` (test data only) and
supplies the file. Claude restores it into the local PostgreSQL 17 harness (`pg_restore`, no network)
and checks:
- the file format;
- that the schema and row counts match the disposable project;
- a targeted row-extract repair.

This proves the procedure without touching customer data. The production export itself stays with
the owner.
