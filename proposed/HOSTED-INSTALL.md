# Hosted M2 install

Proposed procedure for a hosted database. This file does not connect to one, and it does not run the install. Take a backup, or confirm point-in-time recovery covers the start of the window, before any statement that writes. If a later rollback cannot be applied, restore from that backup.

The local rehearsal that proved these files is `docs/m2-rehearsal.md`. `SHOW server_version` there returned `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. Run the same statement on the hosted database and record what it returns. Do not assume the local string.

`proposed/m2-with-approval-boundary/approval-boundary.local.sql` is not part of this procedure.

## Window

The window starts when `proposed/m2-packet/01.sql` commits and ends when `record-uploaded-content-sha.sql` verifies. Approval and signing during that window see a partial install. Stop at the first failed check. Do not start the next file.

## How a file runs

Run one file per execution. Do not paste the next file into the same run.

Supabase SQL editor: paste one file and run it. A packet file has no `BEGIN`/`COMMIT`; the editor run is its transaction. An own file contains `BEGIN`/`COMMIT`; run that file alone so its `COMMIT` commits only that file.

psql, `ON_ERROR_STOP=1`, hosted connection string:

- Packet file: `psql -v ON_ERROR_STOP=1 -1 -f <file>`. `-1` is the transaction. The file must not also contain `BEGIN`.
- Own file: `psql -v ON_ERROR_STOP=1 -f <file>`. Do not pass `-1`.

## Pre-checks

Stop if any of these fail. Nothing has been written yet, so there is nothing to roll back.

1. `SHOW server_version;`
2. `storage.objects.version` is `text`, and `storage.objects.user_metadata` is `jsonb`. Both are rows in the preflight.
3. The `postgres` role is superuser or `BYPASSRLS`. That is the preflight row `postgres bypassrls or superuser`.
4. Object versioning is off on `driver-docs`, `license-uploads`, `profile-screenshots`, `rental-agreements`, and `condition-media`. The preflight row `storage.objects one row per path` must be `holds`. A second row for the same bucket and name means versioning is on, or a duplicate was left behind. If the Storage dashboard shows versioning on, stop even when that row says `holds`.
5. `proposed/m2-preflight.sql`, without `-1`. Every `ok` value is true. `private.approval_validate(uuid)` and `private.approval_snapshot(uuid)` are `absent`. `public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)` is `absent`.

```sql
SHOW server_version;
```

```sql
SELECT check_name, expected, actual, ok
FROM (/* paste proposed/m2-preflight.sql */) preflight
WHERE ok IS NOT TRUE;
```

An empty result is the preflight pass. The proof runs the file directly and counts rows whose `ok` is not `t`.

## Order

After each file, run the verification query in a new execution. The query must return `t`. If the file errors before commit, that file rolled back. Fix it and run it again. Do not run its rollback. If the file commits and the verification returns `f` or errors, stop and use the rollback named below.

| Step | File | Transaction | Verify | Rollback if this step committed and the check failed |
| --- | --- | --- | --- | --- |
| 1 | `proposed/m2-packet/01.sql` | `-1` or one editor run | `SELECT to_regprocedure('private.approval_provider_actor()') IS NOT NULL;` | `proposed/rollback/01-auth-binding.sql` |
| 2 | `proposed/m2-with-approval-boundary/00-approval-boundary.sql` | own `BEGIN`/`COMMIT`, no `-1` | `SELECT to_regprocedure('private.approval_validate(uuid)') IS NOT NULL AND to_regclass('private.approval_operations') IS NOT NULL;` | `proposed/rollback/00-approval-boundary.sql` |
| 3 | `proposed/m2-packet/02.sql` | `-1` | `SELECT to_regprocedure('private.lock_vehicle_release()') IS NOT NULL;` | `proposed/rollback/02-safe-release.sql` |
| 4 | `proposed/m2-packet/03.sql` | `-1` | `SELECT to_regclass('public.booking_vehicle_assignments') IS NOT NULL;` | `proposed/rollback/03-record-rental.sql` |
| 5 | `proposed/m2-packet/04.sql` | `-1` | `SELECT to_regclass('private.record_close_operations') IS NOT NULL;` | `proposed/rollback/04-closeout-legacy-guard.sql` |
| 6 | `proposed/m2-packet/05.sql` | `-1` | `SELECT to_regclass('private.record_evidence_v1') IS NOT NULL;` | `proposed/rollback/05-evidence.sql` |
| 7 | `proposed/m2-packet/06.sql` | `-1` | `SELECT to_regprocedure('private.document_integrity_guard_v1()') IS NOT NULL;` | `proposed/rollback/06-document-identity.sql` |
| 8 | `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql` | own, no `-1` | `SELECT pg_get_functiondef('private.integrity_serialize_v1()'::regprocedure) LIKE '%SECURITY DEFINER%';` | `proposed/rollback/06b-approval-identity-check.sql` |
| 9 | `proposed/m2-packet/07.sql` | `-1` | `SELECT to_regprocedure('private.record_identity_reader_v2(uuid)') IS NOT NULL;` | `proposed/rollback/07-evidence-consumer.sql` |
| 10 | `proposed/m2-packet/08.sql` | `-1` | `SELECT to_regprocedure('private.recover_record_evidence_v1(uuid)') IS NOT NULL;` | `proposed/rollback/08-evidence-recovery.sql` |
| 11 | `proposed/m2-packet/09.sql` | `-1` | `SELECT to_regprocedure('private.record_issuer_scope_v2(uuid)') IS NOT NULL;` | `proposed/rollback/09-issuer-permissions.sql` |
| 12 | `proposed/m2-packet/10.sql` | `-1` | `SELECT to_regprocedure('private.record_approval_scope_v3(uuid)') IS NOT NULL;` | `proposed/rollback/10-approval-permissions.sql` |
| 13 | `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql` | own, no `-1` | `SELECT has_column_privilege('rr_approval_executor','public.applications','approval_evidence_version','SELECT') AND (SELECT count(*) = 2 FROM pg_policy WHERE polrelid = 'public.audit_log'::regclass AND polname IN ('approval_scope_permissive_v3','approval_scope_restrictive_v3') AND pg_get_expr(polqual, polrelid) LIKE '%application.approved%');` | `proposed/rollback/10b-approval-executor-writes.sql` |
| 14 | `proposed/m2-packet/11.sql` | `-1` | `SELECT to_regprocedure('private.record_executor_scope_v3(uuid)') IS NOT NULL;` | `proposed/rollback/11-executor-permissions.sql` |
| 15 | `proposed/m2-packet/12.sql` | `-1` | `SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema='public' AND table_name='rentals' AND column_name='deposit_amount';` | `proposed/rollback/12-deposit-nullability.sql` |
| 16 | `proposed/m2-packet/13.sql` | `-1` | `SELECT pg_get_functiondef('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)'::regprocedure) LIKE '%pickup_reading_id,driver_id INTO r%';` | `proposed/rollback/13-closeout-projection.sql` |
| 17 | `proposed/m2-packet/14.sql` | `-1` | `SELECT count(*) = 1 FROM pg_policy WHERE polname='issuer_identity_allow_v5';` | `proposed/rollback/14-issuer-identity-permissions.sql` |
| 18 | `proposed/m2-packet/15.sql` | `-1` | `SELECT pg_get_functiondef('public.record_existing_rental_evidence_v1(uuid,jsonb)'::regprocedure) LIKE '%record.application_id%';` | `proposed/rollback/15-consumption-scope.sql` |
| 19 | `proposed/m2-packet/16.sql` | `-1` | `SELECT to_regprocedure('private.record_close_scope_v5(uuid)') IS NOT NULL;` | `proposed/rollback/16-closeout-scope.sql` |
| 20 | `proposed/m2-packet/17.sql` | `-1` | `SELECT to_regprocedure('private.storage_integrity_v1()') IS NOT NULL;` | `proposed/rollback/17-storage-integrity.sql` |
| 21 | `proposed/m2-packet/18.sql` | `-1` | `SELECT to_regclass('private.rental_subscription_operations_v1') IS NOT NULL;` | `proposed/rollback/18-subscription-coordination.sql` |
| 22 | `proposed/m2-packet/19.sql` | `-1` | `SELECT to_regprocedure('private.finalized_archive_pointer_v1()') IS NOT NULL;` | `proposed/rollback/19-signed-archive-protection.sql` |
| 23 | `proposed/m2-packet/19b.sql` | `-1` | `SELECT to_regclass('private.agreement_evidence') IS NOT NULL;` | `proposed/rollback/19b-agreement-evidence.sql` |
| 24 | `proposed/m2-with-approval-boundary/19c-agreement-contract.sql` | own, no `-1` | `SELECT pg_get_functiondef('private.record_agreement_evidence(uuid,uuid,timestamptz,numeric)'::regprocedure) LIKE '%record_rental_terms_v1%';` | `proposed/rollback/19c-agreement-contract.sql` |
| 25 | `proposed/m2-packet/20.sql` | `-1` | `SELECT to_regclass('private.swap_operations') IS NOT NULL;` | `proposed/rollback/20-vehicle-swap.sql` |
| 26 | `proposed/m2-packet/extend.sql` | `-1` | `SELECT to_regclass('private.extend_operations') IS NOT NULL;` | `proposed/rollback/extend-rental.sql` |
| 27 | `proposed/m2-packet/return.sql` | `-1` | `SELECT to_regclass('public.return_checklists') IS NOT NULL;` | `proposed/rollback/return-checklist.sql` |
| 28 | `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql` | own, no `-1` | `SELECT to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL;` | `proposed/rollback/record-uploaded-content-sha.sql` |

Each verify query returns `f` immediately before its file and `t` immediately after. A later file may replace a function again. Run the query for the file just applied, not after the whole install.

Step 8's function already exists as an invoker after step 7. The check is `SECURITY DEFINER` in `pg_get_functiondef`. Step 10 already creates `approval_scope_permissive_v3` and `approval_scope_restrictive_v3` on `public.audit_log`, so step 13 counts those two policies on `public.audit_log` only when `pg_get_expr` contains `application.approved`, and it also requires `SELECT` on `applications.approval_evidence_version`. Step 16's signature already exists after step 5. The check is the column list `pickup_reading_id,driver_id INTO r`, which step 5's body does not have. Step 18's signature already exists after step 6. The check is `record.application_id`. Step 23 leaves the four-argument `record_agreement_evidence` as a deny-all. Step 24's check is `record_rental_terms_v1` in that body.

Roll `record-uploaded-content-sha.sql` back before the return checklist when undoing a committed prefix. Then roll back return, extend, 20, 19c, 19b, 19 through 2, 00, and 01. Do not skip backward over a later committed step.

## Stop points

- Preflight `ok` is not true, versioning is on, or `storage.objects one row per path` is `duplicated`. Stop. No rollback.
- A file errors inside its transaction. Stop. That file did not commit. Do not roll back earlier steps unless the verification of an earlier step is also wrong.
- A file commits and its verification fails. Stop. Run only that step's rollback, then stop. Do not continue the install in the same window.
- `06b-approval-identity-check.sql` rollback raises `06b_rollback_unused_install_only` when a verified `approval_identity` row exists. `00-approval-boundary.sql` rollback raises `00_rollback_unused_install_only` when any `approval_identity` or `verified` row exists. Export with `proposed/rollback/00-approval-data-export.sql` (read-only, no `-1`), move those rows, and remove them before that rollback. If they cannot be moved, restore the backup or the point-in-time recovery snapshot. Do not force the rollback.

After step 28 verifies, the window is closed. The upload flag in `src/lib/document-content-sha.ts` stays false until a separate rebuild turns it on. This procedure does not change that constant.
