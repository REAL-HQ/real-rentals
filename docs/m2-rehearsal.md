# M2 install rehearsal

Local rehearsal. `SHOW server_version` on this database returned `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. The same files also pass on PostgreSQL 17.11. Host `127.0.0.1:55442`, database `m2`, trust authentication, role `postgres`. The hosted procedure is `proposed/HOSTED-INSTALL.md`. No production credentials were used, and no hosted database was contacted.

Header comments in 12 SQL files now point at `proposed/HOSTED-INSTALL.md`. Those comments changed the file bytes. The executable statements in the packet files were not rewritten. Current SHA-256 for the 12 files is in the functional rehearsal section below. Rollback scripts are under `proposed/rollback/`. They were generated from the local catalog difference for each step, then run in reverse on this database.

## Baseline

Schema built from `supabase/migrations` at `7e3e6eb` (122 files), plus local stubs:

- Roles `anon`, `authenticated`, `service_role`, `authenticator`
- Schemas `auth`, `storage`, `extensions`, `private`, `cron`, `net`, `vault`
- `auth.users`, `auth.sessions`, `auth.uid()`, `auth.role()`, `auth.jwt()`
- `storage.buckets`, `storage.objects`, `storage.foldername`, `storage.filename`, `storage.extension`
- `pgcrypto`
- `cron.schedule`, `cron.unschedule`, `cron.job`, `net.http_post`, `extensions.http_post`, `vault.create_secret`

`CREATE EXTENSION` lines for `pg_net`, `pg_cron`, `pg_graphql`, `supabase_vault`, and `pgsodium` were stripped during the local replay. Those extensions are not installed on this VM. Cron schedules in the migrations call the stubs and do not leave the machine.

Two local replay notes, both outside the packet:

- `20260721192708_...sql` grants `applications.sms_consent` before `20260722205426_...sql` adds the column. The rehearsal added `sms_consent boolean DEFAULT false` on this database before re-running that file.
- Several later migrations repeat `CREATE POLICY` and `CREATE TRIGGER` statements that an earlier migration already applied. The local replay skipped those duplicate objects so the rest of the file could run. The migration files in the repo were not changed.

## Objects the packet expects and `supabase/migrations` does not create

A first pass applied only `supabase/migrations` plus the stubs above.

| Attempt | Result |
| --- | --- |
| Step 6 `040-document-identity-v2.sql` | Fail. `relation "public.application_identity_reviews" does not exist`. The statement before it had added `documents.integrity_v1`. That partial change was removed, steps 1–5 were rolled back, and `pg_dump --schema-only` matched that baseline. |
| Step 10 `080-approval-permissions-v3.sql`, after the identity-review table was added | Fail. `column "deleted_at" of relation "applications" does not exist`. The partial step was rolled back to the post-step-9 catalog. |

Both objects are already live through Drizzle, not through `supabase/migrations`:

- `public.application_identity_reviews` is created by `drizzle/migrations/0019_application_identity_reviews.sql` and its grants are tightened by `drizzle/migrations/0020_identity_reviews_tighten_grants.sql`. The inline check is named `application_identity_reviews_resolution_check`, which step 6 drops and replaces.
- `applications.deleted_at` is added by `drizzle/migrations/0016_0016_driver_deletion_stage1.sql`. The rehearsal added that column and the other columns from the same statement: `deleted_by`, `deleted_reason`, `purged_at`, and `legal_hold`. The rest of 0016 was not applied. It creates deletion functions that reference further Drizzle tables.

The recorded run below uses that supplemented baseline. No packet file was changed to add those objects. On a database that already has these live objects, the packet files apply as written. Adding `CREATE TABLE application_identity_reviews` to step 6 would fail on that live database.

The first recorded run left `public.application_waitlist_holds` absent. `extend_rental_tx` mentions it inside a PL/pgSQL body, so `CREATE FUNCTION` succeeded. A later production-matching baseline, below, applies Drizzle `0014_waitlist_holds_and_safe_promotion.sql` before the packet.

`private.approval_validate` and `private.approval_snapshot` are not created by the 17 packet files or by `supabase/migrations`. They are defined in the excluded approval-boundary script. Steps that call them still installed, because PL/pgSQL resolves those callees at execution time. The production-matching run below records the execution error.

## Install order and sources

Steps 1–17 are one install. Step 3 is the installer-ownership copy of `010-record-rental-v3.sql` (the #62 copy that also grants `rr_record_executor` to `postgres` with `SET TRUE`, grants `CREATE` on `private` and `public` to that role, and grants `SELECT (rental_id)` on `booking_vehicle_assignments` to `postgres`).

Steps 18 and 19 are the files at `7e3e6eb`. Their bytes match `ed17ccd` on `cursor/record-rental-gated-live-path-1942`.

Steps 19b and 20 are from #78 head `3521b3894d0143565bffd7010d269c83e25a5243`. 19b is applied before 20.

`extend-rental-v1.sql` is from #73 head `14588dc856ce8a53e82c64bbbbb046266b42c829`. `return-checklist-v1.sql` is from #77 head `313708b226db92ebd04b7b1b99d5c36d4745b5c2`. Both are specified to follow step 19. They were applied after step 20 so that 19b stays immediately in front of step 20.

| Step | SHA-256 of the applied file |
| --- | --- |
| 1 | `d6fb0b76aa88dd1bd5615e9854aa4593a60889059ac5887eef15b4535709ef8c` |
| 2 | `871629c959945772edb10af15207212ad93b985bf141df29880a495d8b7acb6a` |
| 3 | `168c354777c4b573cf33124d9214a0bc14f7c45692eb56f4170e88a1440faedc` |
| 4 | `c29fa122bf9ddb4f7242ede634568e55a1622e2b01356d132c58279788705f8c` |
| 5 | `c27b49a46e55381eacbfc6f1bb2c246c9ee2c73ce549172d81d44bbadac9b665` |
| 6 | `e9c7ed772fde78753cec7897e387c545c27c5c2754d6dc66a614358e58004759` |
| 7 | `6537823ca84203a69af5b37127b317f6a5c2cc326663d77076a276f45430e537` |
| 8 | `814d00b8ff505457b4d5707e95fb887944a51c15dd3faea6333952203c3ef99f` |
| 9 | `290f3b4aceee1c68bfc1e1c7bcc1f7c09f2750811d23c4f0f24cad7aaf829b1d` |
| 10 | `46434d7a12581d7b6808128a10ee3772fa5698d29862caee61fd933b226628da` |
| 11 | `71d422932602fbc1319f8ab6ae051aca75fe21070578f764bba3643e284eb340` |
| 12 | `c26bcdd58f62a8d75f8990432cf86c511746079bccdf204d01c3d754a2f0622a` |
| 13 | `0269b937f4189257f5ad1f5a4d3105302cf49d1e346e6a507ae950a700a8f00d` |
| 14 | `4f9217759844e9344046424c54bd51586e6302ba510395e8295f3d86517c166b` |
| 15 | `0e3977d47842d9d0d647ce06a5764bd63540cdc2e3f5d3cdf9c8b3c4fa62ca9f` |
| 16 | `09f339e76fd669c9a949c5f995214fe55ae2ebc725d0c9be33833defde04d2bc` |
| 17 | `d8bd7ebcbe2adbee9aa3dab5b29b14cc73373c92c7a80e9d3bc215b372b5557e` |
| 18 | `7057c340052ea363ba91c066cdb0d712b0a7d1390b3d7696cddb16e59a3ed555` |
| 19 | `8ddf84ce34a9ecbddafc9c626a4acc8ce6ed0f867e3a5d8e0014ca81dd7775c9` |
| 19b | `4d6ae674a07a2cf27f2c51167e1e7f884c9221855abba1b51f46f7cf4616e0db` |
| 20 | `96bba3dd74a1648d9cc7abb421d2cf0da898b546469829c7fb2662f67e8ef3bf` |
| Extend | `7594f1f0f319278ed6de222aec8fd3a0f57aec7de6d2ab801664b0b7f05995ac` |
| Return checklist | `b1d911fa915b567828ed0de744c71567e47f1fc52065fac0e51f174116b3ea85` |

## Step results

Every row is from the supplemented baseline. Runtime is the first apply. A second apply was run immediately after. Where the second apply errors, the catalog hash was unchanged, so the error stopped on the first existing object and left the first apply in place.

| Step | Result | Runtime | Re-run | Re-run error |
| --- | --- | --- | --- | --- |
| 1 Auth binding | Pass | 0.009s | Errors | role `rr_approval_executor` already exists |
| 2 Safe release | Pass | 0.016s | Errors | function `lock_vehicle_release` already exists |
| 3 Record rental (installer-ownership) | Pass | 0.034s | Errors | role `rr_record_executor` already exists |
| 4 Closeout legacy guard | Pass | 0.016s | Errors | relation `record_close_operations` already exists |
| 5 Evidence | Pass | 0.022s | Errors | role `rr_evidence_issuer` already exists |
| 6 Document identity | Pass | 0.015s | Errors | column `integrity_v1` of `documents` already exists |
| 7 Evidence consumer | Pass | 0.009s | Errors | function `record_identity_reader_v2` already exists |
| 8 Evidence recovery | Pass | 0.008s | Errors | function `recover_record_evidence_v1` already exists |
| 9 Issuer permissions | Pass | 0.015s | Errors | function `record_issuer_scope_v2` already exists |
| 10 Approval permissions | Pass | 0.015s | Errors | function `record_approval_scope_v3` already exists |
| 11 Executor permissions | Pass | 0.018s | Errors | function `record_executor_scope_v3` already exists |
| 12 Deposit nullability | Pass | 0.006s | Idempotent | |
| 13 Closeout projection | Pass | 0.007s | Idempotent | |
| 14 Issuer identity permissions | Pass | 0.007s | Errors | policy `issuer_identity_allow_v5` already exists |
| 15 Consumption scope | Pass | 0.006s | Idempotent | |
| 16 Closeout scope | Pass | 0.008s | Errors | function `record_close_scope_v5` already exists |
| 17 Storage integrity | Pass | 0.007s | Errors | function `storage_integrity_v1` already exists |
| 18 Subscription coordination | Pass | 0.013s | Errors | relation `rental_subscription_operations_v1` already exists |
| 19 Signed archive protection | Pass | 0.009s | Errors | function `finalized_archive_pointer_v1` already exists |
| 19b Agreement evidence | Pass | 0.017s | Errors | relation `agreement_evidence` already exists |
| 20 Vehicle swap | Pass | 0.017s | Errors | relation `swap_number_seq` already exists |
| Extend rental | Pass | 0.014s | Errors | relation `extend_operations` already exists |
| Return checklist | Pass | 0.014s | Idempotent | |

Idempotent means the second run succeeded and the catalog hash did not change. `DROP NOT NULL` (step 12), `CREATE OR REPLACE` alone (steps 13 and 15), and the return checklist (`IF NOT EXISTS` plus `DROP POLICY IF EXISTS`) are safe to run again. The other files are not. Re-running them raises the error in the table and does not change the schema.

## Rollback

Scripts, applied from the return checklist back through step 1:

`return-checklist.sql`, `extend-rental.sql`, `20-vehicle-swap.sql`, `19b-agreement-evidence.sql`, `19-signed-archive-protection.sql`, `18-subscription-coordination.sql`, `17-storage-integrity.sql`, `16-closeout-scope.sql`, `15-consumption-scope.sql`, `14-issuer-identity-permissions.sql`, `13-closeout-projection.sql`, `12-deposit-nullability.sql`, `11-executor-permissions.sql`, `10-approval-permissions.sql`, `09-issuer-permissions.sql`, `08-evidence-recovery.sql`, `07-evidence-consumer.sql`, `06-document-identity.sql`, `05-evidence.sql`, `04-closeout-legacy-guard.sql`, `03-record-rental.sql`, `02-safe-release.sql`, `01-auth-binding.sql`.

Each script ran in its own transaction and committed. After step 1 rolled back:

- `pg_dump --schema-only` matched the pre-packet baseline dump. The comparison ignores the per-dump `\restrict` / `\unrestrict` token and the `Dumped from` / `Dumped by` comment lines, which change on every dump.
- No `rr_%` roles remained. Roles are cluster-wide and are not part of `pg_dump --schema-only`.

The rollback scripts restore replaced function bodies, the original `application_identity_reviews_resolution_check`, and `NOT NULL` on `rentals.deposit_amount` and `rentals.deposit_held`. They drop objects the step added. Privilege text is written back from the pre-step catalog. Rollback 01 does not delete from `pg_shdepend`. `DROP OWNED BY` plus `DROP ROLE` removes `rr_approval_executor`.

## Fixes

The packet files were not patched to create those Drizzle objects.

The install fails on a `supabase/migrations`-only database at step 6 and, after the identity-review table is added, at step 10. The minimal fix is to have those already-live Drizzle objects in place before the packet, as this rehearsal did. It is not a patch to the packet files.

## Production catalog

A read-only live catalog check, not repeated by this rehearsal, reported:

- `private.approval_validate` and `private.approval_snapshot` are absent. No function whose name contains `approval` exists.
- `public.application_waitlist_holds`, `public.application_identity_reviews`, and `applications.deleted_at` are present.
- None of the packet roles or objects exist yet.

This rehearsal did not contact a hosted database. The local baseline was rebuilt to match that fact: Drizzle `0014_waitlist_holds_and_safe_promotion.sql` applied in full (the holds table, `waitlist_signed_up_at`, `waitlist_source`, the staff read policy, `waitlist_holds_guard`, and `promote_waitlist_entry`), on top of the identity-review table and the deletion columns already in the first baseline. Approval functions stayed absent. `pg_dump --schema-only` of that baseline is the comparison point for the rollback below.

## Packet on that baseline

Steps 1 through the return checklist were applied with no step 0. Every step committed. No install step failed.

| Step | Result | Runtime |
| --- | --- | --- |
| 1 through 11 | Pass | 0.008s to 0.031s |
| 12 through 17 | Pass | 0.005s to 0.008s |
| 18, 19, 19b, 20, extend, return | Pass | 0.007s to 0.019s |

The first failure is execution of `public.record_existing_rental_tx`, which step 3 creates and no later step replaces. After a manager session, an approved application, and the record scope settings, the call reaches the missing function:

```
ERROR:  function private.approval_validate(uuid) does not exist
LINE 1: identity_id:=private.approval_validate(_application_id)
                     ^
HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
QUERY:  identity_id:=private.approval_validate(_application_id)
CONTEXT:  PL/pgSQL function public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text) line 31 at assignment
```

A direct call on the same database returns the same absence for both functions:

```
ERROR:  function private.approval_validate(uuid) does not exist
ERROR:  function private.approval_snapshot(uuid) does not exist
```

The probe rows and the temporary `rr_evidence_transport` role were removed before rollback. That packet was then rolled back with the existing scripts. `pg_dump --schema-only` matched the production-matching baseline, and no `rr_%` role remained.

## Approval-boundary dependency

`private.approval_validate(uuid)` and `private.approval_snapshot(uuid)` are required before the installed functions are called. `CREATE FUNCTION` does not resolve them.

| Caller | When it calls them |
| --- | --- |
| Step 3 `public.record_existing_rental_tx` | `identity_id:=private.approval_validate(_application_id)`. This body is still the one in place after the full packet. Execution fails with the error above. |
| Step 5 `private.record_snapshot_v1` | Calls `private.approval_validate` and puts `private.approval_snapshot` in the returned jsonb. Step 7 replaces this function. The replacement calls `approval_lock` and `approval_actor` only. |
| Step 5 `private.record_existing_rental_evidence_core_v1` | Calls `private.approval_validate`. Step 7 replaces this function. The replacement does not call `approval_validate` or `approval_snapshot`. |
| Step 6 | The name `approval_validate` appears in a comment. The file does not call it. |
| Step 1 | Creates `approval_provider_actor`, `approval_actor`, and `approval_lock`. It does not create `approval_validate` or `approval_snapshot`. |

After step 7, the remaining packet call is `record_existing_rental_tx`. Before step 7 is applied, the two step 5 bodies fail the same way, and `record_snapshot_v1` also needs `approval_snapshot`.

## Application deploy, then this migration

Ship the application before the packet. `approveApplication` calls `approve_application_checked` with the manager JWT. `PGRST202` is the only error that uses the legacy service-role status update and `application.approved` audit insert. `42883` does not. Installing the packet first makes live Approve fail: the approval triggers refuse both of those writes. Do not install step 3, `00-approval-boundary.sql`, until the flag-on builds are deployed, the byte backfill has run, and `proposed/backfill-document-content-sha.sql` reports 0 missing and 0 mismatched. A script dry-run does not download, so its `mismatched=0` is not that gate. `DOCUMENT_CONTENT_SHA256_ENABLED` and `IDENTITY_VERIFICATION_ENABLED` stay false in this repository. Turning either one on is a separate owner approval. Step 2 installs `record_uploaded_content_sha` first, so the backfill has a function to call. Otherwise the snapshot closes Approve for every real application. The rehearsal runs `scripts/m2-approve-before.sql` on the baseline, then `scripts/m2-functional-proof.sql` after install. The before script records a successful legacy approve. The proof records `approval_rpc_required` and `approval_audit_rpc_required` for the same service-role writes, then a successful `approve_application_checked`. Each hosted verify query also requires `prosecdef`, the `search_path` proconfig entry, and that `anon` and `authenticated` are not members of the privileged roles. `GRANT authenticated TO anon` leaves `proacl` unchanged and makes that query false.

## Recommended install order

Drizzle objects are already live: `application_identity_reviews`, `applications.deleted_at`, and `application_waitlist_holds`.

The install sequence is the 29-row table in `proposed/HOSTED-INSTALL.md`. `proposed/INSTALL.md` copies that table. Follow the table as written.

HOSTED-INSTALL step 2 is `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql`.

HOSTED-INSTALL step 3 is `proposed/m2-with-approval-boundary/00-approval-boundary.sql`. It comes after the content-sha file. Installing that boundary file first closes Approve.

HOSTED-INSTALL step 9 is `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql`.

HOSTED-INSTALL step 14 is `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql`.

HOSTED-INSTALL step 25 is `proposed/m2-with-approval-boundary/19c-agreement-contract.sql`.

HOSTED-INSTALL step 29 is `proposed/m2-packet/21-revoke-executor-create.sql`.

HOSTED-INSTALL step 1 is `proposed/m2-packet/01.sql`. It creates `rr_approval_executor` and the session-checking `approval_provider_actor`, plus `approval_actor` and `approval_lock`.

`proposed/m2-with-approval-boundary/approval-boundary.local.sql` is the excluded script plus a header comment. Its SHA-256 is `e377ee948cd294b6afdc34b7f7441fdd1d86801a66b2337a57d4431f84995e78`. The SHA-256 table in the baseline section records the first apply, before those header comments. The installable step 0 is that script with the three `CREATE FUNCTION` statements step 1 owns removed, so step 1's session-checking provider is not replaced by the deny stub.

The excluded file cannot be applied unchanged in either order:

- Before step 1, on this baseline, it stops at its `GRANT` and the transaction rolls back. No approval function remains. Error text: `ERROR:  role "rr_approval_executor" does not exist` at `approval-boundary.local.sql:12`.
- After step 1, its first function statement is `CREATE FUNCTION private.approval_provider_actor`, which already exists.

HOSTED-INSTALL step 8 (`proposed/m2-packet/06.sql`) replaces `application_identity_reviews_resolution_check` after the approval boundary.

Until HOSTED-INSTALL step 9 (`proposed/m2-with-approval-boundary/06b-approval-identity-check.sql`), the check that remains is the `positive_license_v1` check in `proposed/m2-packet/06.sql`. A verified `approval_identity` row does not satisfy that check, and a verified `positive_license_v1` row does not satisfy the boundary check. The reachability run below left those checks unmerged. The functional rehearsal adds 06b, which keeps both shapes.

## Resolution value `approval_identity`

No packet function, and no code under `src`, inserts or updates `resolution = 'approval_identity'`. That string is not a resolution. Step 6 does not remove a resolution value any of those writers use, so no extra step is required.

`approval_identity` is a `kind`. The only writer is step 0's `verify_approval_identity`, which inserts `kind = 'approval_identity'` and `resolution = 'verified'`. It is not in the packet files and not in `src`. `record_existing_rental_tx` does not write this column. After step 7 it still calls `approval_validate`, which only reads a row with that kind and `resolution = 'verified'`.

Writers that do exist, and what step 6's check allows:

| Writer | Values | Step 6 check |
| --- | --- | --- |
| `src/lib/applications.functions.ts` | `kind = 'phone_match_email_differs'`, resolution left null | Allowed |
| `src/lib/identity-review.functions.ts` and `resolve_application_identity_review` | `same_person`, `different_person`, or `dismissed` | Allowed |
| Step 6 `private.verify_license_v1` | `kind = 'positive_license_v1'`, `resolution = 'verified'`, `positive_evidence_v1` set | Allowed |

Local proof after steps 1, 0, and 2 through 6, with user triggers disabled so only the check was under test, then rolled back. Schema-only dump matched the production-matching baseline.

- The open-review insert, the `same_person` update, and the `positive_license_v1` / `verified` insert each succeeded.
- `resolution = 'approval_identity'` failed: `new row for relation "application_identity_reviews" violates check constraint "application_identity_reviews_resolution_check"`.
- `kind = 'approval_identity'` with `resolution = 'verified'` failed the same check. That is the step 0 insert shape. Nothing in the packet or `src` performs it.

`approval-privileges.local.sql` stays excluded.

## Whether `verify_approval_identity` is reachable

It is not reachable from `private.approval_validate`, `private.approval_snapshot`, `public.record_existing_rental_tx`, or any other installed function. After the recommended install, `pg_proc.prosrc` contains the text `verify_approval_identity(` in zero functions. The only insert of `kind = 'approval_identity'` and `resolution = 'verified'` is the body of `public.verify_approval_identity` itself. Nothing calls that function.

`private.approval_validate` reads a row of that shape. It does not insert one. `private.approval_snapshot` reads the application and the two current license documents. It does not insert a review. The installed functions that call `approval_validate(` are `private.approval_application_guard`, `private.approval_write_audit`, `public.approval_readiness`, and `public.record_existing_rental_tx`. Step 7 replaced the step 5 bodies, so `record_snapshot_v1` and `record_existing_rental_evidence_core_v1` no longer call it.

That reachability run did not include `06b-approval-identity-check.sql`. These calls do not fail the step 6 check, because they never insert the row. The functional rehearsal adds 06b, and `verify_approval_identity` then inserts the row under that check.

Local proof on the production-matching baseline. The order in this paragraph is history, not the install order: packet step 1, then `00-approval-boundary.sql`, then packet steps 2 through the return checklist. That run installed the boundary before content-sha. The install order is the 29-row table in `proposed/HOSTED-INSTALL.md`. The seed was a manager `auth.users` row, a matching `auth.sessions` row, an `admin` role, an approved application with a driver `user_id` and a future license, two current verified `license_front` / `license_back` documents, and an available vehicle. Those rows were inserted with `session_replication_role = replica` and then the calls ran with triggers on. A normal `license_front` insert, triggers on, fails before any review write:

```
ERROR: evidence_version_managed
CONTEXT: PL/pgSQL function private.approval_application_guard() line 7 at RAISE
SQL statement "UPDATE public.applications SET approval_evidence_version=approval_evidence_version+1 WHERE id=old_id OR id=new_id"
PL/pgSQL function private.approval_evidence_changed() line 11 at SQL statement
```

`approval_evidence_changed` is security definer, owned by `postgres`. The guard allows that version bump only when `current_user` is `rr_approval_executor`.

The calls used `session_authorization = authenticator`, `role = authenticated`, and `request.jwt.claims` with that manager, that session, `role = authenticated`, and a future `exp`.

`public.verify_approval_identity` stopped here. The insert is the statement after this assignment, and it did not run:

```
ERROR: approval_storage_version_unverified
CONTEXT: PL/pgSQL function private.approval_object_version(uuid) line 2 at RAISE
PL/pgSQL function private.approval_snapshot(uuid) line 13 at assignment
PL/pgSQL function public.verify_approval_identity(uuid,jsonb,text) line 7 at assignment
```

`private.approval_object_version` is the step 0 deny stub. It raises before `approval_snapshot` can return evidence.

`public.record_existing_rental_tx` with no `record.application_id` stopped at its own manager check, line 21, `ERROR: manager_required`. `record_executor_scope_v3` returns false when that setting is empty, so the executor's `user_roles` read sees no row. That is before `approval_validate`.

The same call with `record.application_id` and `record.vehicle_id` set to the seeded ids reached the identity read and stopped in the same stub. It did not call `verify_approval_identity` and it did not insert a review:

```
ERROR: approval_storage_version_unverified
CONTEXT: PL/pgSQL function private.approval_object_version(uuid) line 2 at RAISE
PL/pgSQL function private.approval_snapshot(uuid) line 13 at assignment
PL/pgSQL function private.approval_validate(uuid) line 4 at assignment
PL/pgSQL function public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text) line 31 at assignment
```

Line 31 is `identity_id:=private.approval_validate(_application_id)`. The call did not reach `private.record_agreement_evidence`, which remains the deny-all adapter.

The seed transaction was rolled back. Schema rollback then ran return, extend, 20, 19b, 19 through 2, `00-approval-boundary.sql`, and `01-auth-binding.sql`. `pg_dump --schema-only --no-owner --no-privileges` matched the production-matching baseline (normalized length 273072). Applications were 0, `rr_%` roles were 0, and no function whose name contains `approval` remained.

## Functional rehearsal

Triggers stayed on for the install and for `scripts/m2-functional-proof.sql`. The only `session_replication_role = replica` use is the unused-install fixture under Rollbacks. `approval-boundary.local.sql` keeps the excluded script's statements and adds a header comment. Its SHA-256 is `e377ee948cd294b6afdc34b7f7441fdd1d86801a66b2337a57d4431f84995e78`. Header comments in the 12 files below point at `proposed/HOSTED-INSTALL.md`. The executable packet statements were not rewritten. The rehearsal passes on PostgreSQL 16.15 and 17.11.

`private.approval_object_version` now reads the one `storage.objects` row for the document's bucket and path. It returns that object's bucket, path, and sha256, and a version token: `storage.objects.version` when that column exists and is non-blank, otherwise `metadata.version`, then `metadata.eTag`, then the object id. `user_metadata.sha256` is client-writable, so it is not evidence by itself. The function also reads `private.uploaded_content_sha`, which only `record_uploaded_content_sha` writes. The live object id, version, `updated_at`, and `user_metadata` must still equal that row, and the row's sha must equal `documents.content_sha256`. A missing binding, a client metadata overwrite, or a replaced object raises `approval_storage_version_unverified`. The rehearsal adds `version text` before the baseline, the same provider column hosted Storage has. License objects are inserted at `v1`. After verify, setting the front object to `v2` is the hosted upsert's version change, and `approve_application_checked` raises `approval_storage_version_unverified` because the server binding still says `v1`. Putting the version back to `v1` lets the success path approve.

`private.approval_evidence_changed` stays owned by the table owner. Under HOSTED-INSTALL step 13 (`proposed/m2-packet/10.sql`) the executor's application policy calls `approval_actor` and requires `record.application_id`, so a driver upload cannot bump the version as `rr_approval_executor`. The guard still rejects every direct write of `approval_evidence_version`. It allows only a nested update that adds exactly 1, which is the trigger's own statement. `private.integrity_serialize_v1` is security definer for the same reason: it only takes `approval_lock`, and HOSTED-INSTALL step 1 (`proposed/m2-packet/01.sql`) revokes that function from `authenticated` and `service_role`.

`verify_approval_identity` and `approve_application_checked` are owned by `rr_approval_executor` and set `record.application_id` for that application. The audit policy in HOSTED-INSTALL step 13 (`proposed/m2-packet/10.sql`) allowed only `identity_review.positive_license_v1`, and its column grants omitted `status`, `contacted_at`, `approval_evidence`, and `resolution_note`. HOSTED-INSTALL step 14 (`proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql`) adds those columns and those two audit actions for the executor. Authenticated and service-role policies are unchanged.

The check in HOSTED-INSTALL step 8 (`proposed/m2-packet/06.sql`) rejects `kind = 'approval_identity'` with `resolution = 'verified'`. That is the row `approval_validate` reads. HOSTED-INSTALL step 9 (`proposed/m2-with-approval-boundary/06b-approval-identity-check.sql`) keeps the `positive_license_v1` arm and the other-kind arm, and adds the approval-identity shape from HOSTED-INSTALL step 3 (`proposed/m2-with-approval-boundary/00-approval-boundary.sql`) with `positive_evidence_v1` null.

HOSTED-INSTALL step 24 (`proposed/m2-packet/19b.sql`) leaves the four-argument `record_agreement_evidence` as a deny-all, and its first statement refuses with `agreement_evidence_already_installed` when `private.agreement_evidence` already exists, so a later re-apply cannot replace the step 25 body with that stub. HOSTED-INSTALL step 25 (`proposed/m2-with-approval-boundary/19c-agreement-contract.sql`) replaces that body. It locks the application's unlinked agreements, requires exactly one, and returns that agreement id only when the signed archived document, the storage object, the vehicle, and `merge_data.record_rental_terms_v1` match the call. The document bucket must be `rental-agreements`, the path must be `immutable-v1/<document id>/<sha>.pdf`, and exactly one `storage.objects` row in that bucket at that path must carry `user_metadata.sha256` or `user_metadata.content_sha256` equal to the agreement sha. `metadata` is system data and is not a fallback. Any other case still raises `agreement_contract_unverified`. The two-argument overload is unchanged.

`swap_rental_vehicle_tx` reads the application id from `private.record_operations`, then sets `record.application_id` and, before each vehicle read, `record.vehicle_id`. It does not select `weekly_rate`, `stripe_subscription_id`, or `autopay_active`. HOSTED-INSTALL step 26 (`proposed/m2-packet/20.sql`) grants `EXECUTE` on `vehicle_rental_ready_missing(uuid)` and `UPDATE (id)` on `application_identity_reviews`. `swap_project_vehicle_v1` sets `app.rental_tx` on for the rental pointer update and off before the status writes. The functional proof completes one swap and a same-argument replay that returns `recovered` true without a second closure, assignment, or audit.

`confirmDocumentUpload` and `registerDocument` do not set `content_sha256` while `DOCUMENT_CONTENT_SHA256_ENABLED` is false. Supabase storage metadata does not carry a sha256 on its own. The earlier proof at `2362f2b` hand-seeded both sides in `/tmp/m2-proof.sql` after the upload-shaped inserts: `UPDATE public.documents SET content_sha256` to the literals `1111…1111` and `2222…2222`, then `INSERT INTO storage.objects` with those same literals in `metadata.sha256`. The agreement row was inserted already at `immutable-v1/…` with a literal sha. No packet step hashes driver-upload bytes. HOSTED-INSTALL step 12 (`proposed/m2-packet/09.sql`) `bind_document_integrity_v1` writes `content_sha256` only when an issuer supplies a sha and rebinds the row onto `immutable-v1`. After HOSTED-INSTALL step 23 (`proposed/m2-packet/19.sql`), `finalized_archive_document_v1` refuses that path change on a document whose path matches `^(immutable|completed)-v1/` or that an agreement with a sha already points at.

The production path for license bytes is the flag in `src/lib/document-content-sha.ts`. It stays false. When an owner changes it and rebuilds, `recordUploadedContentSha` calls Storage API `info` and `download`, SHA-256s those bytes, and calls `public.record_uploaded_content_sha`. That function refuses an `immutable-v1` path, and it refuses a bucket and path that are not already a documents row or a known application upload. It overwrites `user_metadata.sha256` with the digest of the downloaded bytes and drops a client-set `content_sha256` key. The object's id and version, or `updated_at` when version is blank, must still match the hashed row. It then writes `private.uploaded_content_sha` from the object it just updated. A stored document hash that differs is `content_sha256_mismatch` and is not replaced. The storage client's `updatedAt` is that timestamp. It does not re-upload the file and it does not `UPDATE storage.objects` through PostgREST. `confirmDocumentUpload` inserts the documents row first so the function can see it. If the later `content_sha256` stamp fails, that new row is marked not current before the error is rethrown, so the previous current row stays the only current row. `registerDocument` hashes a known application upload and stores the returned hex. A missing packet function is `PGRST202` only. The first flag-on call logs that once per process and confirms the upload with `content_sha256` null, so approval stays closed. `42883` throws. A hasher error after the insert marks that new row not current and rethrows. The new row is not deleted. No environment variable opens the flag. The function is step 2, `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql`, an own-transaction file. Hosted install is `proposed/HOSTED-INSTALL.md`. It is not installed on hosted.

`proposed/backfill-document-content-sha.sql` only reports. It does not read Storage bytes and it does not copy `user_metadata`. Setting `m2.backfill_content_sha` to `write` raises `backfill_refused_report_only`. The writer is `scripts/backfill-document-content-sha.ts`. Dry-run is the default and does not download, so a dry-run `mismatched=0` proves nothing. `--write` downloads every current `license_front` and `license_back` object. A row whose `content_sha256` is not 64 hex is hashed through `writeUploadedContentSha`. A stored hash is compared after lowercasing, so uppercase hex is the same digest. A match is skipped, and a difference is counted mismatched and is not replaced. Missing is HTTP 404, including an HTTP 400 whose body `statusCode` is `"404"`. Any other Storage failure, including a 5xx from `writeUploadedContentSha`'s download, is `storage_errors` and does not abort the rest of the run. `--write` exits nonzero when missing, mismatched, or storage_errors is greater than 0. The script refuses to start unless the key role is `service_role` and `SUPABASE_URL` was passed with `--url` or is a shell value other than the committed `.env`. It prints the target host. Clearing `documents.content_sha256` does not delete `private.uploaded_content_sha`. That table is revoked from `service_role` and has no policy, so only the table owner can `DELETE` the binding row. After that delete, set the document hash to null and run `--write` again. The SQL report is the gate that missing and mismatched are both 0.

`SIGNED_ARCHIVE_V1_ENABLED` stays false, so eSign still writes `{applicationId}/agreement-{id}.pdf` and does not set `documents.content_sha256`. There is no `ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED` constant in this repository. `archiveDocument` checks `SIGNED_ARCHIVE_V1_ENABLED` first and, when that flag is on, runs completed-v1. With only that flag true, `archiveCompletedV1` writes `completed-v1/<document id>/<file sha>.pdf`. HOSTED-INSTALL step 12 (`proposed/m2-packet/09.sql`) cannot move a finalized path after HOSTED-INSTALL step 23 (`proposed/m2-packet/19.sql`).

### Install order

Install mode is `proposed/INSTALL.md`. Packet files, including `17.sql`, are applied with `psql -v ON_ERROR_STOP=1 -1 -f`. They have no transaction wrapper. `17.sql` is applied that way by the local proof. A hosted run follows `proposed/HOSTED-INSTALL.md`. `00-approval-boundary.sql`, `06b-approval-identity-check.sql`, `10b-approval-executor-writes.sql`, `19c-agreement-contract.sql`, and `record-uploaded-content-sha.sql` each contain their own `BEGIN`/`COMMIT`. Run those with `ON_ERROR_STOP` and without `psql -1`. Rollbacks are the same, except the read-only export. Preflight is one `SELECT`, without `-1`.

The sequence is the 29-row table in `proposed/HOSTED-INSTALL.md` and `proposed/INSTALL.md`. `record-uploaded-content-sha.sql` is step 2, before `00-approval-boundary.sql` (step 3). Hold step 3 until the flag-on builds are deployed, `--write` has run, and `proposed/backfill-document-content-sha.sql` reports missing 0 and mismatched 0. A script dry-run does not download, so its mismatched count is not that gate. `17.sql` is step 21. `proposed/m2-packet/20.sql` is step 26 (`proposed/vehicle-swap-v1.sql` is a pointer and is not installed). `extend.sql` is step 27. `21-revoke-executor-create.sql` is step 29. It revokes `CREATE` on `public` and `private` from `rr_record_executor`. Its rollback grants that privilege back. The proof rolls the content-sha file back after `00-approval-boundary.sql` and before `01-auth-binding.sql`.

`00-approval-boundary.sql` records `actor_email` and `actor_role` on the approval audit rows. `private.approval_source_statuses()` is the one list: `partial`, `new`, `complete`, `reviewing`, `declined`, `closed`, `duplicate`. `verify_approval_identity` also allows `approved`. `active` and `suspended` raise `application_status_not_approvable` because approving them would demote a running renter. `declined`, `closed`, and `duplicate` stay until an owner changes that one list. The same array is `APPROVAL_SOURCE_STATUSES` in `src/lib/approval-source-statuses.ts`. The legacy service-role update refuses `active` and `suspended` only when both content-hash and identity flags are true. While those flags are false, the `PGRST202` fallback keeps today's status list. `deleted_at` and `purged_at` stay refused. `10b` grants the executor `INSERT` on the two audit columns.

SHA-256 of the current files:

| File | SHA-256 |
| --- | --- |
| `proposed/m2-packet/10.sql` | `cf40bd9d02cf03d999c8413ae4123ec23d0e7133bba912b2dad7ffd49bb5d764` |
| `proposed/m2-packet/11.sql` | `b8fde7718e9893c3ed97dd0066808c6d02a921de15fccc7ff5514976753472a2` |
| `proposed/m2-packet/17.sql` | `36b3d8e9525bbe6f688b3fd865f005cb09bcccccdb3ed21767a6cee71e831b25` |
| `proposed/m2-packet/19b.sql` | `af1f5b28d91b774a1bd0e39fe26668fc487b15c3f4a6ed3662b1c911b0d12384` |
| `proposed/m2-packet/20.sql` | `c23e187d4aada1280616197e876151a1668810c235e5c1504901ee15349ee70a` |
| `proposed/m2-packet/extend.sql` | `3492408c17413619e75fffd19dcefc422ec7107b735197e957000e043c00f883` |
| `proposed/m2-packet/21-revoke-executor-create.sql` | `2eea1a9184bc545d668e7821a3782156ee80492d31543dd11b5dac8b3744c70a` |
| `proposed/m2-with-approval-boundary/00-approval-boundary.sql` | `d8b5c035f90488b7981e0c6a614913fbe5ee9d07836499f0e9f7d0ac14075482` |
| `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql` | `69fd2705cf22bf32fad1de71a40bc18d78810c37017e27acd2a680923bc759cb` |
| `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql` | `0c2cbbad3a3a741f5f069e222327da78acea0891e4544d2c73de8d87d47f5392` |
| `proposed/m2-with-approval-boundary/19c-agreement-contract.sql` | `7d7ce32780f39cf93721f66f68e52ab24db334767fcafa26d4e8a2fafa69ae8c` |
| `proposed/m2-with-approval-boundary/approval-boundary.local.sql` | `e377ee948cd294b6afdc34b7f7441fdd1d86801a66b2337a57d4431f84995e78` |
| `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql` | `1d0b2cf8f43cb2c3945f7df4ccd9da036977d7fa10d92cd9f5ee3ca17b4c139d` |

### Proof

`scripts/m2-functional-proof.sql`, one transaction, then `ROLLBACK`. After the evidence record, the authenticated manager calls `link_replacement_agreement_checked(uuid, uuid)` on the signed archived agreement and gets `recovered` false. A driver with a session and no `user_roles` row is refused with `manager_required`. `anon` is `permission denied` for that function. `link_replacement_agreement_v1` stays denied for `authenticated`. No 64-hex literal is in that file. License and agreement hashes are `encode(extensions.digest(bytes, 'sha256'), 'hex')` of `m2-license-front-v1`, `m2-license-back-v1`, `m2-signed-agreement-v1`, and `signed terms`. `scripts/m2-content-sha.test.ts` checks that `contentSha256Hex` returns the same digests. Front is `66cd8986298ba1265463727de09dbc11f65fc4a17d9726222218b63c56793f0c`. Back is `577ba23d2c2bcdccc259d9b91c0261232ca4c26e4e9bc528484dd8378a3dd240`. The flag stayed false. After the evidence record, the proof seeds a rental-ready replacement, a signed archived agreement for that car, and a `private.agreement_evidence` row, then calls `swap_rental_vehicle_tx` as the authenticated manager. A second call with the same arguments returns `recovered` true and does not add a closure, assignment, or audit.

(a) and (b) insert the `confirmDocumentUpload` column list with no `content_sha256`. The objects are inserted with `user_metadata.source` and no sha. `service_role` then calls `public.record_uploaded_content_sha`, which sets `documents.content_sha256` and merges `user_metadata.sha256`. `anon` and `authenticated` are `permission denied`. A stale version raises `content_sha256_object_changed`. A different stored hash raises `content_sha256_mismatch`. An `immutable-v1` path raises `content_sha256_immutable` and writes nothing. A `driver-docs` path with no documents row and no application upload raises `content_sha256_unclaimed` and writes nothing. `metadata` is system data (`mimetype`, `size`) and has no sha. supabase-js stores the upload `metadata` option in `user_metadata` (storage migration 0025), so `approval_object_version` and step 19c read `user_metadata` and do not fall back to `metadata`. The agreement used for (d) is an initial insert at `immutable-v1/<doc>/<digest>.pdf` in `rental-agreements`, with the object `user_metadata` sha equal to the same digest. A `completed-v1` agreement is refused with `agreement_contract_unverified`, and updating its path to `immutable-v1` raises `finalized_archive_immutable`.

| Check | Result |
| --- | --- |
| (a) Driver license upload | Pass. `service_role` insert of `license_front`, no `content_sha256`. Row `55555555-5555-4555-8555-555555555555`. Version became 1. |
| (b) Service-role upload | Pass. Same shape for `license_back`. Row `66666666-6666-4666-8666-666666666666`. Version became 2. |
| (c) Version tamper | Pass. `postgres` and `service_role` raised `evidence_version_managed`. `authenticated` was `permission denied for table applications`. |
| (d) `record_existing_rental_tx` | Pass. `status = recorded`, rental `d7da0621-ced4-443b-9497-0e49009b656b`, `active`, weekly rate 250.00. Agreement `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` is `signed` / `archived`, `rental_id` is that rental, and the document path is `immutable-v1` in `rental-agreements`. The object sha is in `user_metadata`, and `metadata` has no sha. Review `ce6497c0-be81-4586-9407-6503fc7d4ad0` is `approval_identity` / `resolved` / `verified`, with `approval_evidence` set and `positive_evidence_v1` null. |
| (e) Step 6 check | Pass. The installed check is 06b. The unmodified step 6 text rejects `resolution = 'verified'` on `kind = 'approval_identity'`. |

An authenticated manager insert of an `insurance` document succeeded and left the evidence version at 2. The functional proof did not use `session_replication_role = replica`.

### Rollbacks

Each rollback was applied on its own and compared with `pg_dump --schema-only --no-owner` (privileges included; `\restrict`, `\unrestrict`, and the dump-version comments removed) to the dump taken after the previous install step. Every comparison matched. After rollback 01, `rr_%` roles were 0, applications were 0, and no function whose name contains `approval` remained.

| Rollback | Compared with | Result |
| --- | --- | --- |
| return checklist | after extend | Match |
| extend | after step 20 | Match |
| 20 | after 19c | Match |
| 19c | after 19b | Match |
| 19b | after 19 | Match |
| 19 | after 18 | Match |
| 18 | after 17 | Match |
| 17 | after 16 | Match |
| 16 | after 15 | Match |
| 15 | after 14 | Match |
| 14 | after 13 | Match |
| 13 | after 12 | Match |
| 12 | after 11 | Match |
| 11 | after 10b | Match |
| 10b | after 10 | Match |
| 10 | after 9 | Match |
| 9 | after 8 | Match |
| 8 | after 7 | Match |
| 7 | after 06b | Match |
| 06b, empty install | after 6 | Match |
| 6 | after 5 | Match |
| 5 | after 4 | Match |
| 4 | after 3 | Match |
| 3 | after 2 | Match |
| 2 | after step 0 | Match |
| 00 | after step 1 | Match |
| 01 | production-matching baseline | Match |

Rollback 06b is unused-install-only. With one `approval_identity` / `verified` row present, the script raised `06b_rollback_unused_install_only` and left the 06b check in place. The safe post-use procedure is to leave 06b installed and not delete the review. That fixture used `session_replication_role = replica` only so the insert could pass the executor trigger. The check constraint still applied. The row was removed before the clean rollback chain.

Rollback 00 drops `private.approval_operations` and the columns `application_identity_reviews.approval_evidence` and `applications.approval_evidence_version`. Identity-review rows remain, without the evidence payload. The check it restores rejects `kind = 'approval_identity'` and `resolution = 'verified'`. Rollback past 06b, including this file, is for an unused install, or for an install whose `approval_identity` and `verified` rows were exported and then removed. With two such reviews present the script raises `00_rollback_unused_install_only` and leaves step 0 in place. `proposed/rollback/00-approval-data-export.sql` is read-only. On this rehearsal, before that refusal, it emitted two operations (`16161616-1616-4161-8161-161616161616`, `17171717-1717-4171-8171-171717171717`), two reviews (`1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a`, `1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b`), and two applications whose `approval_evidence_version` is not 0. Those reviews were removed only after the export, and only so the empty-install rollback could match the baseline.

Rollback 01 no longer deletes from `pg_shdepend`. `DROP OWNED BY` plus `DROP ROLE` removes `rr_approval_executor`. Rollback 10 revokes the schema, function, and column privileges step 10 added, and it leaves the step 6 execute grants and the step 0 `USAGE` on `private`.

Rollbacks 03, 05, 07, 09, 11, and 14 use `REVOKE` and `GRANT` only. They do not assign `nspacl`, `attacl`, `proacl`, or `relacl`, and they do not `UPDATE`, `DELETE`, or `INSERT` `pg_catalog` tables. Rollback 03 revokes `rr_record_executor` and drops the role. `REVOKE ALL` removes step 3's `CREATE` on `private` and `public` and leaves step 0's `USAGE` for `rr_approval_executor`. Rollback 11 revokes only the `USAGE`, function, and column privileges step 11 granted to `rr_record_executor`. It leaves step 3's `CREATE`, step 7's execute grants on `license_snapshot_v1` and `validate_license_v1`, and the column grants from steps 6, 9, 10, and 10b, including `rr_approval_executor` `UPDATE` on `applications.status`. Rollback 07 revokes execute on `license_snapshot_v1` and `validate_license_v1` from `rr_evidence_issuer` and `rr_record_executor`. `record_identity_reader_v2` is dropped with the function. Rollback 09 revokes the privileges step 9 granted to `rr_evidence_issuer`. It leaves step 5's `USAGE` on `private` and step 6's execute grant on `bind_document_integrity_v1`. Rollback 14 revokes the column selects step 14 granted to `rr_evidence_issuer` and leaves the earlier grants for `rr_approval_executor`, `rr_record_executor`, `anon`, and `authenticated`. Rollback 05 still grants each leftover privilege and revokes it in the same transaction, so a shared-dependency row cannot block `DROP ROLE`. The committed privileges match the pre-step dump.

`scripts/m2-rehearsal-proof.sh` starts with a catalog-write guard over `proposed/`. A fresh local run matched every per-step privilege dump, including 07 against the post-step-06b dump, 09 against the post-step-8 dump, and 14 against the post-step-13 dump. Final counts were 0 `rr_%` roles, 0 applications, and 0 approval functions. The local `storage.objects` table had no `user_metadata` or `version` column; the proof adds `user_metadata jsonb` and `version text` before the baseline dump, so every comparison includes them. `scripts/m2-baseline-builder.sh` reproduces that baseline from a database already loaded with `supabase/migrations`. It applies Drizzle `0014` through `0023` only when `application_identity_reviews` is missing, and it does not create `approval_validate` or `approval_snapshot`.

## Step 0 install and rollback

Historical order applied, not the install order: step 1, step 0, steps 2 through the return checklist. That run installed the boundary before content-sha. The install order is the 29-row table in `proposed/HOSTED-INSTALL.md`. Every step in that historical run passed.

| Step | Result | Runtime |
| --- | --- | --- |
| 1 Auth binding | Pass | 0.009s |
| 0 Approval boundary | Pass | 0.025s |
| 2 Safe release | Pass | 0.018s |
| 3 Record rental | Pass | 0.030s |
| 4 Closeout legacy guard | Pass | 0.017s |
| 5 Evidence | Pass | 0.021s |
| 6 Document identity | Pass | 0.016s |
| 7 Evidence consumer | Pass | 0.010s |
| 8 Evidence recovery | Pass | 0.006s |
| 9 Issuer permissions | Pass | 0.014s |
| 10 Approval permissions | Pass | 0.012s |
| 11 Executor permissions | Pass | 0.016s |
| 12 Deposit nullability | Pass | 0.006s |
| 13 Closeout projection | Pass | 0.007s |
| 14 Issuer identity permissions | Pass | 0.007s |
| 15 Consumption scope | Pass | 0.006s |
| 16 Closeout scope | Pass | 0.008s |
| 17 Storage integrity | Pass | 0.006s |
| 18 Subscription coordination | Pass | 0.015s |
| 19 Signed archive protection | Pass | 0.008s |
| 19b Agreement evidence | Pass | 0.015s |
| 20 Vehicle swap | Pass | 0.017s |
| Extend rental | Pass | 0.013s |
| Return checklist | Pass | 0.018s |

Rollback ran return, extend, 20, 19b, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, then `00-approval-boundary.sql`, then `01-auth-binding.sql`. Each script committed. `pg_dump --schema-only` matched the production-matching baseline. No `rr_%` role remained, and no function whose name contains `approval` remained.

SHA-256 of the installable step 0 file at that rehearsal: `a6b749ce3b3a711750081848d1fcdd9c0c3982d543587249ad7ea42f536a1a66`. The current file is recorded in Functional rehearsal.

## Preflight

`proposed/m2-preflight.sql` is a single read-only `SELECT`. `ok` is true when `actual` equals `expected`. The proof runs it after adding `user_metadata` and `version`, and before install. The proof fails if any row is not `ok`.

Prerequisites expected `present`: the three Drizzle objects, `storage.objects`, `storage.objects.name`, `storage.objects.user_metadata` as `jsonb`, `storage.objects.version` as `text`, the existing `condition-media` bucket, and a `postgres` role that is superuser or `BYPASSRLS`. `storage.objects one row per path` is expected `holds`. A duplicated path means object versioning is on, or a second row was left for the same bucket and name. `private.approval_validate(uuid)` and `private.approval_snapshot(uuid)` are created by HOSTED-INSTALL step 3 (`proposed/m2-with-approval-boundary/00-approval-boundary.sql`). Before that step they are expected `absent`. HOSTED-INSTALL step 21 (`proposed/m2-packet/17.sql`) does not create a bucket. It requires `storage.objects.name` and adds `private.storage_integrity_v1` plus two triggers, which the preflight expects to be `absent` before install. `public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)` and `private.uploaded_content_sha` are also expected `absent` until HOSTED-INSTALL step 2 (`proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql`) is applied.

Objects the packet and step 0 create are expected `absent`.

Earlier dumps of this query, including the 218-row tables, are removed. They expected objects that step 0 creates to already be present. Run `proposed/m2-preflight.sql` for the current rows. Hosted pre-checks are in `proposed/HOSTED-INSTALL.md`.

