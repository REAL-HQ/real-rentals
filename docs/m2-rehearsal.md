# M2 install rehearsal

Local only. Postgres 16.15 on `127.0.0.1:55442`, database `m2`, trust authentication, role `postgres`. No production credentials were used, and no hosted database was contacted.

The packet SQL was not edited. Rollback scripts are under `proposed/rollback/`. They were generated from the local catalog difference for each step, then run in reverse on this database.

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

The recorded run below uses that supplemented baseline. No packet file was changed. On a database that already has these live objects, the packet files apply as written. Adding `CREATE TABLE application_identity_reviews` to step 6 would fail on that live database.

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

The rollback scripts restore replaced function bodies, the original `application_identity_reviews_resolution_check`, and `NOT NULL` on `rentals.deposit_amount` and `rentals.deposit_held`. They drop objects the step added. Privilege text is written back from the pre-step catalog, and `pg_shdepend` rows for a role the step created are removed so `DROP ROLE` can succeed after that rewrite.

## Fixes

No packet SQL was changed.

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

## Recommended install order

1. Drizzle objects already live: `application_identity_reviews`, `applications.deleted_at`, `application_waitlist_holds`.
2. Packet step 1, `010-auth-binding.sql`. It creates `rr_approval_executor` and the session-checking `approval_provider_actor`, plus `approval_actor` and `approval_lock`.
3. Step 0, `proposed/m2-with-approval-boundary/00-approval-boundary.sql`. This creates `approval_validate`, `approval_snapshot`, and the rest of the approval boundary.
4. Packet steps 2 through 17, then 18, 19, 19b, 20, extend rental, and the return checklist.

`proposed/m2-with-approval-boundary/approval-boundary.local.sql` is a byte-for-byte copy of the excluded script (`90e1ca62274aa59df8c48de8953827e61523cf11a2c82e7be2f6e6ce780d5deb`). The original packet files were not edited. Their bytes are in `proposed/m2-packet/` and match the SHA-256 table above. The installable step 0 is that script with the three `CREATE FUNCTION` statements step 1 owns removed, so step 1's session-checking provider is not replaced by the deny stub.

The excluded file cannot be applied unchanged in either order:

- Before step 1, on this baseline, it stops at its `GRANT` and the transaction rolls back. No approval function remains. Error text: `ERROR:  role "rr_approval_executor" does not exist` at `approval-boundary.local.sql:12`.
- After step 1, its first function statement is `CREATE FUNCTION private.approval_provider_actor`, which already exists.

Step 6 replaces `application_identity_reviews_resolution_check` after step 0. Until `06b-approval-identity-check.sql`, the check that remains is the step 6 `positive_license_v1` check. A verified `approval_identity` row does not satisfy that step 6 check, and a verified `positive_license_v1` row does not satisfy the boundary check. The reachability run below left those checks unmerged. The functional rehearsal adds 06b, which keeps both shapes.

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

Local proof on the production-matching baseline, recommended order (step 1, `00-approval-boundary.sql`, steps 2 through the return checklist). The seed was a manager `auth.users` row, a matching `auth.sessions` row, an `admin` role, an approved application with a driver `user_id` and a future license, two current verified `license_front` / `license_back` documents, and an available vehicle. Those rows were inserted with `session_replication_role = replica` and then the calls ran with triggers on. A normal `license_front` insert, triggers on, fails before any review write:

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

Triggers stayed on for the install and for `scripts/m2-functional-proof.sql`. The only `session_replication_role = replica` use is the unused-install fixture under Rollbacks. `approval-boundary.local.sql` is still the verbatim excluded script. Packet files were not edited.

`private.approval_object_version` now reads the one `storage.objects` row for the document's bucket and path. It returns that object's bucket, path, and sha256, and a version token: the provider `version` column when this catalog has one, otherwise `metadata.version`, then `metadata.eTag`, then the object id. The object must carry the same sha256 the document row claims. A missing or mismatched object still raises `approval_storage_version_unverified`. This database's `storage.objects` has no `version` column, so the rehearsal token is the object id.

`private.approval_evidence_changed` stays owned by the table owner. Under step 10 the executor's application policy calls `approval_actor` and requires `record.application_id`, so a driver upload cannot bump the version as `rr_approval_executor`. The guard still rejects every direct write of `approval_evidence_version`. It allows only a nested update that adds exactly 1, which is the trigger's own statement. `private.integrity_serialize_v1` is security definer for the same reason: it only takes `approval_lock`, and step 1 revokes that function from `authenticated` and `service_role`.

`verify_approval_identity` and `approve_application_checked` are owned by `rr_approval_executor` and set `record.application_id` for that application. Step 10's audit policy allowed only `identity_review.positive_license_v1`, and its column grants omitted `status`, `contacted_at`, `approval_evidence`, and `resolution_note`. `10b-approval-executor-writes.sql` adds those columns and those two audit actions for the executor. Authenticated and service-role policies are unchanged.

Step 6's check rejects `kind = 'approval_identity'` with `resolution = 'verified'`. That is the row `approval_validate` reads. `06b-approval-identity-check.sql` keeps the `positive_license_v1` arm and the other-kind arm, and adds the step 0 approval-identity shape with `positive_evidence_v1` null.

Step 19b leaves the four-argument `record_agreement_evidence` as a deny-all. `19c-agreement-contract.sql` replaces that body. It locks the application's unlinked agreements, requires exactly one, and returns that agreement id only when the signed archived document, the storage object, the vehicle, and `merge_data.record_rental_terms_v1` match the call. The document bucket must be `rental-agreements`, the path must be `immutable-v1/<document id>/<sha>.pdf`, and exactly one `storage.objects` row in that bucket at that path must carry `metadata.sha256` or `metadata.content_sha256` equal to the agreement sha. Any other case still raises `agreement_contract_unverified`. The two-argument overload is unchanged.

`confirmDocumentUpload` and `registerDocument` do not set `content_sha256` while `DOCUMENT_CONTENT_SHA256_ENABLED` is false. Supabase storage metadata does not carry a sha256 on its own. The earlier proof at `2362f2b` hand-seeded both sides in `/tmp/m2-proof.sql` after the upload-shaped inserts: `UPDATE public.documents SET content_sha256` to the literals `1111…1111` and `2222…2222`, then `INSERT INTO storage.objects` with those same literals in `metadata.sha256`. The agreement row was inserted already at `immutable-v1/…` with a literal sha. No packet step hashes driver-upload bytes. Step 9 `bind_document_integrity_v1` writes `content_sha256` only when an issuer supplies a sha and rebinds the row onto `immutable-v1`. After step 19, `finalized_archive_document_v1` refuses that path change on a document whose path matches `^(immutable|completed)-v1/` or that an agreement with a sha already points at.

The production path for license bytes is the flag in `src/lib/document-content-sha.ts`. It stays false. When an owner changes it and rebuilds, `recordUploadedContentSha` downloads the uploaded object, SHA-256s the bytes, re-uploads with `metadata.sha256`, and `confirmDocumentUpload` / `registerDocument` store that hex on `documents.content_sha256`. No environment variable opens it. That flag is not on the release line yet. It needs its own dark pull request before anyone turns it on. No SQL.

Today's eSign does not reach `immutable-v1`. With `SIGNED_ARCHIVE_V1_ENABLED` false it writes `{applicationId}/agreement-{id}.pdf` and does not set `documents.content_sha256`. With that flag true, `archiveCompletedV1` writes `completed-v1/<document id>/<file sha>.pdf`. Step 9 cannot move either path after step 19. The missing app change, not done in this rehearsal and not a second signing path, is an initial eSign insert of the document and the storage object already at `immutable-v1/<document id>/<pdf sha>.pdf` in bucket `rental-agreements`, with `content_sha256` and `metadata.sha256` equal to the PDF hash, before the agreement row is archived with that sha.

### Install order

Packet files are applied with `psql -v ON_ERROR_STOP=1 -1 -f`. They have no transaction wrapper. `00-approval-boundary.sql`, `06b-approval-identity-check.sql`, `10b-approval-executor-writes.sql`, and `19c-agreement-contract.sql` each contain their own `BEGIN`/`COMMIT`. Run those with `ON_ERROR_STOP` and without `psql -1`.

1. `proposed/m2-packet/01.sql`
2. `proposed/m2-with-approval-boundary/00-approval-boundary.sql`
3. Packet steps 2 through 6
4. `06b-approval-identity-check.sql`
5. Packet steps 7 through 10
6. `10b-approval-executor-writes.sql`
7. Packet steps 11 through 19
8. Packet step 19b
9. `19c-agreement-contract.sql`
10. Packet step 20, extend rental, return checklist

| File | SHA-256 |
| --- | --- |
| `00-approval-boundary.sql` | `6d556e77c2a1f709ec2bb7c2c0d0fdf028515e76f59ef6f75e3ddbaa262746c2` |
| `06b-approval-identity-check.sql` | `48a97ec52eff7ccab70684ca40f3147dca83bc53d32970ee35061914c3e113c6` |
| `10b-approval-executor-writes.sql` | `53003c593a65bc6bfa9cdf6166d2fd30929ca7ff37081ddce2c4d09d2d5b1251` |
| `19c-agreement-contract.sql` | `68973314709860b19a7f93bbc44142164159baf4529e593e74cb98318cacddde` |

`approval-boundary.local.sql` is unchanged: `90e1ca62274aa59df8c48de8953827e61523cf11a2c82e7be2f6e6ce780d5deb`.

### Proof

`scripts/m2-functional-proof.sql`, one transaction, then `ROLLBACK`. No 64-hex literal is in that file. License and agreement hashes are `encode(extensions.digest(bytes, 'sha256'), 'hex')` of `m2-license-front-v1`, `m2-license-back-v1`, `m2-signed-agreement-v1`, and `signed terms`. `scripts/m2-content-sha.test.ts` checks that `contentSha256Hex` returns the same digests. Front is `66cd8986298ba1265463727de09dbc11f65fc4a17d9726222218b63c56793f0c`. Back is `577ba23d2c2bcdccc259d9b91c0261232ca4c26e4e9bc528484dd8378a3dd240`. The flag stayed false.

(a) and (b) insert the `confirmDocumentUpload` column list with no `content_sha256`. The hash step then writes `documents.content_sha256` and `storage.objects.metadata.sha256` from that digest. The agreement used for (d) is an initial insert at `immutable-v1/<doc>/<digest>.pdf` in `rental-agreements`, with the object metadata sha equal to the same digest. A `completed-v1` agreement is refused with `agreement_contract_unverified`, and updating its path to `immutable-v1` raises `finalized_archive_immutable`.

| Check | Result |
| --- | --- |
| (a) Driver license upload | Pass. `service_role` insert of `license_front`, no `content_sha256`. Row `55555555-5555-4555-8555-555555555555`. Version became 1. |
| (b) Service-role upload | Pass. Same shape for `license_back`. Row `66666666-6666-4666-8666-666666666666`. Version became 2. |
| (c) Version tamper | Pass. `postgres` and `service_role` raised `evidence_version_managed`. `authenticated` was `permission denied for table applications`. |
| (d) `record_existing_rental_tx` | Pass. `status = recorded`, rental `3ca98aee-91a8-499c-8063-9747c1bfe0c3`, `active`, weekly rate 250.00. Agreement `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` is `signed` / `archived`, `rental_id` is that rental, and the document path is `immutable-v1` in `rental-agreements`. Review `bdf73f02-f64f-4c20-be74-9defb038d22d` is `approval_identity` / `resolved` / `verified`, with `approval_evidence` set and `positive_evidence_v1` null. |
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

Rollback 00 drops `private.approval_operations` and the columns `application_identity_reviews.approval_evidence` and `applications.approval_evidence_version`. Identity-review rows remain, without the evidence payload. `proposed/rollback/00-approval-data-export.sql` is optional and read-only. Run it first when those values should be kept. On this rehearsal it emitted the seeded operation `16161616-1616-4161-8161-161616161616` before rollback 00 dropped the table.

Rollback 01 no longer deletes from `pg_shdepend`. `DROP OWNED BY` plus `DROP ROLE` removes `rr_approval_executor`. Rollback 10 revokes the schema, function, and column privileges step 10 added, and it leaves the step 6 execute grants and the step 0 `USAGE` on `private`.

Rollbacks 03, 05, and 11 no longer assign `nspacl`, `attacl`, or `proacl`, and they do not delete from `pg_shdepend`. Rollback 03 revokes `rr_record_executor` and drops the role. `REVOKE ALL` removes step 3's `CREATE` on `private` and `public` and leaves step 0's `USAGE` for `rr_approval_executor`. Rollback 11 revokes only the `USAGE`, function, and column privileges step 11 granted to `rr_record_executor`. It leaves step 3's `CREATE`, step 7's execute grants on `license_snapshot_v1` and `validate_license_v1`, and the column grants from steps 6, 9, 10, and 10b, including `rr_approval_executor` `UPDATE` on `applications.status`. Rollback 05 revokes `rr_evidence_issuer`. Steps 9 and 14 still rewrite ACLs in place, which leaves shared-dependency rows after the privilege itself is gone. Rollback 05 grants each of those privileges and revokes it in the same transaction, which clears the row. The committed privileges match the pre-step dump.

Rollbacks 07, 09, and 14 still assign `proacl` or `attacl`. A fresh local run of `scripts/m2-rehearsal-proof.sh` matched every per-step privilege dump, including 03 against the post-step-2 dump, 05 against the post-step-4 dump, and 11 against the post-step-10b dump. Final counts were 0 `rr_%` roles, 0 applications, and 0 approval functions.

## Step 0 install and rollback

Order applied: step 1, step 0, steps 2 through the return checklist. Every step passed.

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

`proposed/m2-preflight.sql` is a single read-only `SELECT`. `ok` is true when `actual` equals `expected`.

Prerequisites are expected `present`: the three Drizzle objects, `private.approval_validate(uuid)`, `private.approval_snapshot(uuid)`, `storage.objects`, `storage.objects.name`, and the existing `condition-media` bucket. Step 17 does not create a bucket. It requires `storage.objects.name` and adds `private.storage_integrity_v1` plus two triggers, which the preflight expects to be `absent` before install.

Objects the packet and step 0 create are expected `absent`.

### Baseline

Production-matching baseline. 218 rows. 216 are `ok`. The two approval functions are the required prerequisites that are still absent.

```
                                                             check_name                                                             | expected | actual  | ok 
------------------------------------------------------------------------------------------------------------------------------------+----------+---------+----
 index private.rental_subscription_pending_v1                                                                                       | absent   | absent  | t
 index public.record_one_original                                                                                                   | absent   | absent  | t
 index public.return_checklists_rental_idx                                                                                          | absent   | absent  | t
 policy public.agreements.issuer_scope_allow_v2                                                                                     | absent   | absent  | t
 policy public.agreements.issuer_scope_limit_v2                                                                                     | absent   | absent  | t
 policy public.application_identity_reviews.approval_scope_permissive_v3                                                            | absent   | absent  | t
 policy public.application_identity_reviews.approval_scope_restrictive_v3                                                           | absent   | absent  | t
 policy public.application_identity_reviews.issuer_identity_allow_v5                                                                | absent   | absent  | t
 policy public.application_identity_reviews.issuer_identity_limit_v5                                                                | absent   | absent  | t
 policy public.application_identity_reviews.positive_review_privacy_v1                                                              | absent   | absent  | t
 policy public.application_identity_reviews.record_scope_permissive_v3                                                              | absent   | absent  | t
 policy public.application_identity_reviews.record_scope_restrictive_v3                                                             | absent   | absent  | t
 policy public.applications.approval_scope_permissive_v3                                                                            | absent   | absent  | t
 policy public.applications.approval_scope_restrictive_v3                                                                           | absent   | absent  | t
 policy public.applications.issuer_scope_allow_v2                                                                                   | absent   | absent  | t
 policy public.applications.issuer_scope_limit_v2                                                                                   | absent   | absent  | t
 policy public.applications.record_scope_permissive_v3                                                                              | absent   | absent  | t
 policy public.applications.record_scope_restrictive_v3                                                                             | absent   | absent  | t
 policy public.audit_log.approval_scope_permissive_v3                                                                               | absent   | absent  | t
 policy public.audit_log.approval_scope_restrictive_v3                                                                              | absent   | absent  | t
 policy public.audit_log.record_scope_permissive_v3                                                                                 | absent   | absent  | t
 policy public.audit_log.record_scope_restrictive_v3                                                                                | absent   | absent  | t
 policy public.documents.approval_scope_permissive_v3                                                                               | absent   | absent  | t
 policy public.documents.approval_scope_restrictive_v3                                                                              | absent   | absent  | t
 policy public.documents.issuer_scope_allow_v2                                                                                      | absent   | absent  | t
 policy public.documents.issuer_scope_limit_v2                                                                                      | absent   | absent  | t
 policy public.documents.record_scope_permissive_v3                                                                                 | absent   | absent  | t
 policy public.documents.record_scope_restrictive_v3                                                                                | absent   | absent  | t
 policy public.odometer_readings.record_scope_permissive_v3                                                                         | absent   | absent  | t
 policy public.odometer_readings.record_scope_restrictive_v3                                                                        | absent   | absent  | t
 policy public.rentals.record_read_permissive_v3                                                                                    | absent   | absent  | t
 policy public.rentals.record_read_restrictive_v3                                                                                   | absent   | absent  | t
 policy public.rentals.record_write_permissive_v3                                                                                   | absent   | absent  | t
 policy public.rentals.record_write_restrictive_v3                                                                                  | absent   | absent  | t
 policy public.return_checklist_items.Managers insert return checklist items                                                        | absent   | absent  | t
 policy public.return_checklist_items.Managers read return checklist items                                                          | absent   | absent  | t
 policy public.return_checklist_photos.Managers insert return checklist photos                                                      | absent   | absent  | t
 policy public.return_checklist_photos.Managers read return checklist photos                                                        | absent   | absent  | t
 policy public.return_checklists.Managers insert return checklists                                                                  | absent   | absent  | t
 policy public.return_checklists.Managers read return checklists                                                                    | absent   | absent  | t
 policy public.user_roles.approval_scope_permissive_v3                                                                              | absent   | absent  | t
 policy public.user_roles.approval_scope_restrictive_v3                                                                             | absent   | absent  | t
 policy public.user_roles.issuer_scope_allow_v2                                                                                     | absent   | absent  | t
 policy public.user_roles.issuer_scope_limit_v2                                                                                     | absent   | absent  | t
 policy public.user_roles.record_scope_permissive_v3                                                                                | absent   | absent  | t
 policy public.user_roles.record_scope_restrictive_v3                                                                               | absent   | absent  | t
 policy public.vehicles.record_scope_permissive_v3                                                                                  | absent   | absent  | t
 policy public.vehicles.record_scope_restrictive_v3                                                                                 | absent   | absent  | t
 private.agreement_evidence                                                                                                         | absent   | absent  | t
 private.approval_actor()                                                                                                           | absent   | absent  | t
 private.approval_after()                                                                                                           | absent   | absent  | t
 private.approval_application_guard()                                                                                               | absent   | absent  | t
 private.approval_audit_guard()                                                                                                     | absent   | absent  | t
 private.approval_evidence_changed()                                                                                                | absent   | absent  | t
 private.approval_lock()                                                                                                            | absent   | absent  | t
 private.approval_object_version(uuid)                                                                                              | absent   | absent  | t
 private.approval_operation_immutable()                                                                                             | absent   | absent  | t
 private.approval_operations                                                                                                        | absent   | absent  | t
 private.approval_provider_actor()                                                                                                  | absent   | absent  | t
 private.approval_result(private.approval_operations, boolean)                                                                      | absent   | absent  | t
 private.approval_review_guard()                                                                                                    | absent   | absent  | t
 private.approval_serialize()                                                                                                       | absent   | absent  | t
 private.approval_snapshot(uuid)                                                                                                    | present  | absent  | f
 private.approval_validate(uuid)                                                                                                    | present  | absent  | f
 private.approval_write_audit(uuid, text)                                                                                           | absent   | absent  | t
 private.assignment_closures                                                                                                        | absent   | absent  | t
 private.bind_document_integrity_v1(uuid, jsonb, text, text, uuid)                                                                  | absent   | absent  | t
 private.completed_archive_storage_v1()                                                                                             | absent   | absent  | t
 private.document_integrity_guard_v1()                                                                                              | absent   | absent  | t
 private.extend_operations                                                                                                          | absent   | absent  | t
 private.finalized_archive_document_v1()                                                                                            | absent   | absent  | t
 private.finalized_archive_pointer_v1()                                                                                             | absent   | absent  | t
 private.guard_safe_vehicle_release()                                                                                               | absent   | absent  | t
 private.hold_vehicle_on_evidence()                                                                                                 | absent   | absent  | t
 private.integrity_serialize_v1()                                                                                                   | absent   | absent  | t
 private.issue_record_evidence_v1(jsonb, jsonb, jsonb)                                                                              | absent   | absent  | t
 private.license_snapshot_v1(uuid)                                                                                                  | absent   | absent  | t
 private.lock_vehicle_release()                                                                                                     | absent   | absent  | t
 private.positive_audit_guard_v1()                                                                                                  | absent   | absent  | t
 private.positive_review_guard_v1()                                                                                                 | absent   | absent  | t
 private.preserve_inspection_safety()                                                                                               | absent   | absent  | t
 private.record_agreement_evidence(uuid, uuid)                                                                                      | absent   | absent  | t
 private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)                                                   | absent   | absent  | t
 private.record_agreement_evidence_v1(uuid, uuid, timestamp with time zone, numeric)                                                | absent   | absent  | t
 private.record_approval_scope_v3(uuid)                                                                                             | absent   | absent  | t
 private.record_assignment_history                                                                                                  | absent   | absent  | t
 private.record_assignment_interval_guard()                                                                                         | absent   | absent  | t
 private.record_audit_guard()                                                                                                       | absent   | absent  | t
 private.record_booking_number_seq                                                                                                  | absent   | absent  | t
 private.record_close_context                                                                                                       | absent   | absent  | t
 private.record_close_guard_v2()                                                                                                    | absent   | absent  | t
 private.record_close_operations                                                                                                    | absent   | absent  | t
 private.record_close_scope_v5(uuid)                                                                                                | absent   | absent  | t
 private.record_customer_number_seq                                                                                                 | absent   | absent  | t
 private.record_customers                                                                                                           | absent   | absent  | t
 private.record_evidence_consumed_v1                                                                                                | absent   | absent  | t
 private.record_evidence_context_v1                                                                                                 | absent   | absent  | t
 private.record_evidence_v1                                                                                                         | absent   | absent  | t
 private.record_executor_scope_v3(uuid)                                                                                             | absent   | absent  | t
 private.record_existing_rental_evidence_core_v1(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text) | absent   | absent  | t
 private.record_identity_reader_v2(uuid)                                                                                            | absent   | absent  | t
 private.record_immutable()                                                                                                         | absent   | absent  | t
 private.record_issuer_scope_v2(uuid)                                                                                               | absent   | absent  | t
 private.record_operations                                                                                                          | absent   | absent  | t
 private.record_session_v1()                                                                                                        | absent   | absent  | t
 private.record_snapshot_v1(uuid, uuid, uuid, uuid)                                                                                 | absent   | absent  | t
 private.record_subscription_evidence(uuid, uuid, numeric)                                                                          | absent   | absent  | t
 private.record_subscription_evidence_v1(uuid, uuid, numeric)                                                                       | absent   | absent  | t
 private.record_subscription_links                                                                                                  | absent   | absent  | t
 private.recover_record_evidence_v1(uuid)                                                                                           | absent   | absent  | t
 private.rental_subscription_operations_v1                                                                                          | absent   | absent  | t
 private.signed_binding_guard_v1()                                                                                                  | absent   | absent  | t
 private.storage_integrity_v1()                                                                                                     | absent   | absent  | t
 private.subscription_actor_v1(uuid, uuid)                                                                                          | absent   | absent  | t
 private.subscription_guard_v1()                                                                                                    | absent   | absent  | t
 private.swap_agreement_evidence(uuid, uuid, uuid, timestamp with time zone)                                                        | absent   | absent  | t
 private.swap_number_seq                                                                                                            | absent   | absent  | t
 private.swap_operations                                                                                                            | absent   | absent  | t
 private.swap_project_vehicle_v1(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, uuid, uuid, bigint, text)      | absent   | absent  | t
 private.validate_license_v1(uuid)                                                                                                  | absent   | absent  | t
 private.vehicle_release_reasons(uuid, uuid)                                                                                        | absent   | absent  | t
 private.verify_license_v1(uuid, jsonb)                                                                                             | absent   | absent  | t
 public.application_identity_reviews                                                                                                | present  | present | t
 public.application_identity_reviews.approval_evidence                                                                              | absent   | absent  | t
 public.application_identity_reviews.positive_evidence_v1                                                                           | absent   | absent  | t
 public.applications.approval_evidence_version                                                                                      | absent   | absent  | t
 public.applications.deleted_at                                                                                                     | present  | present | t
 public.application_waitlist_holds                                                                                                  | present  | present | t
 public.approval_readiness(uuid)                                                                                                    | absent   | absent  | t
 public.approve_application_checked(uuid, bigint, uuid, text)                                                                       | absent   | absent  | t
 public.booking_vehicle_assignments                                                                                                 | absent   | absent  | t
 public.booking_vehicle_assignments.swap_operation_id                                                                               | absent   | absent  | t
 public.close_recorded_rental_v2(uuid, uuid, timestamp with time zone, text, integer, text)                                         | absent   | absent  | t
 public.documents.integrity_v1                                                                                                      | absent   | absent  | t
 public.end_rental_safe_v1(uuid, date, text, integer, uuid, text)                                                                   | absent   | absent  | t
 public.extend_rental_tx(uuid, uuid, date, date, text)                                                                              | absent   | absent  | t
 public.link_replacement_agreement_v1(uuid, uuid)                                                                                   | absent   | absent  | t
 public.list_assignment_history_v1(uuid, uuid)                                                                                      | absent   | absent  | t
 public.preview_approval_identity(uuid)                                                                                             | absent   | absent  | t
 public.record_existing_rental_evidence_v1(uuid, jsonb)                                                                             | absent   | absent  | t
 public.record_existing_rental_tx(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)                | absent   | absent  | t
 public.recover_application_approval(uuid, uuid)                                                                                    | absent   | absent  | t
 public.rental_subscription_begin_v1(uuid, uuid, uuid, text, text, text)                                                            | absent   | absent  | t
 public.rental_subscription_finish_v1(uuid, uuid, uuid, text, text, text)                                                           | absent   | absent  | t
 public.return_checklist_items                                                                                                      | absent   | absent  | t
 public.return_checklist_photos                                                                                                     | absent   | absent  | t
 public.return_checklists                                                                                                           | absent   | absent  | t
 public.swap_rental_vehicle_tx(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, uuid)                      | absent   | absent  | t
 public.verify_approval_identity(uuid, jsonb, text)                                                                                 | absent   | absent  | t
 role rr_approval_executor                                                                                                          | absent   | absent  | t
 role rr_evidence_issuer                                                                                                            | absent   | absent  | t
 role rr_record_executor                                                                                                            | absent   | absent  | t
 storage.buckets condition-media                                                                                                    | present  | present | t
 storage.objects                                                                                                                    | present  | present | t
 storage.objects.name                                                                                                               | present  | present | t
 trigger private.agreement_evidence.agreement_evidence_immutable                                                                    | absent   | absent  | t
 trigger private.approval_operations.immutable_operation                                                                            | absent   | absent  | t
 trigger private.assignment_closures.assignment_close_interval                                                                      | absent   | absent  | t
 trigger private.assignment_closures.record_immutable                                                                               | absent   | absent  | t
 trigger private.extend_operations.extend_operations_immutable                                                                      | absent   | absent  | t
 trigger private.record_close_operations.record_immutable                                                                           | absent   | absent  | t
 trigger private.record_customers.record_immutable                                                                                  | absent   | absent  | t
 trigger private.record_evidence_consumed_v1.consumption_immutable                                                                  | absent   | absent  | t
 trigger private.record_evidence_v1.evidence_immutable                                                                              | absent   | absent  | t
 trigger private.record_operations.record_immutable                                                                                 | absent   | absent  | t
 trigger private.record_subscription_links.record_immutable                                                                         | absent   | absent  | t
 trigger private.swap_operations.swap_operations_immutable                                                                          | absent   | absent  | t
 trigger public.agreements.finalized_archive_pointer_v1                                                                             | absent   | absent  | t
 trigger public.agreements.integrity_serialize_v1                                                                                   | absent   | absent  | t
 trigger public.agreements.signed_binding_truncate_v1                                                                               | absent   | absent  | t
 trigger public.agreements.signed_binding_v1                                                                                        | absent   | absent  | t
 trigger public.application_identity_reviews.approval_evidence_changed                                                              | absent   | absent  | t
 trigger public.application_identity_reviews.approval_review_guard                                                                  | absent   | absent  | t
 trigger public.application_identity_reviews.approval_reviews_truncate                                                              | absent   | absent  | t
 trigger public.application_identity_reviews.approval_serialize                                                                     | absent   | absent  | t
 trigger public.application_identity_reviews.integrity_serialize_v1                                                                 | absent   | absent  | t
 trigger public.application_identity_reviews.positive_review_truncate_v1                                                            | absent   | absent  | t
 trigger public.application_identity_reviews.positive_review_v1                                                                     | absent   | absent  | t
 trigger public.applications.approval_audit                                                                                         | absent   | absent  | t
 trigger public.applications.approval_boundary                                                                                      | absent   | absent  | t
 trigger public.applications.approval_serialize                                                                                     | absent   | absent  | t
 trigger public.applications.integrity_serialize_v1                                                                                 | absent   | absent  | t
 trigger public.audit_log.approval_audit_guard                                                                                      | absent   | absent  | t
 trigger public.audit_log.approval_audit_truncate                                                                                   | absent   | absent  | t
 trigger public.audit_log.positive_audit_truncate_v1                                                                                | absent   | absent  | t
 trigger public.audit_log.positive_audit_v1                                                                                         | absent   | absent  | t
 trigger public.audit_log.record_audit_immutable                                                                                    | absent   | absent  | t
 trigger public.audit_log.record_audit_no_truncate                                                                                  | absent   | absent  | t
 trigger public.booking_vehicle_assignments.assignment_interval                                                                     | absent   | absent  | t
 trigger public.booking_vehicle_assignments.record_immutable                                                                        | absent   | absent  | t
 trigger public.documents.approval_evidence_changed                                                                                 | absent   | absent  | t
 trigger public.documents.approval_serialize                                                                                        | absent   | absent  | t
 trigger public.documents.document_integrity_truncate_v1                                                                            | absent   | absent  | t
 trigger public.documents.document_integrity_v1                                                                                     | absent   | absent  | t
 trigger public.documents.finalized_archive_document_v1                                                                             | absent   | absent  | t
 trigger public.documents.integrity_serialize_v1                                                                                    | absent   | absent  | t
 trigger public.incidents.safe_release_evidence                                                                                     | absent   | absent  | t
 trigger public.incidents.safe_release_lock                                                                                         | absent   | absent  | t
 trigger public.inspection_items.safe_release_evidence                                                                              | absent   | absent  | t
 trigger public.inspection_items.safe_release_history                                                                               | absent   | absent  | t
 trigger public.inspection_items.safe_release_lock                                                                                  | absent   | absent  | t
 trigger public.inspections.safe_release_evidence                                                                                   | absent   | absent  | t
 trigger public.inspections.safe_release_history                                                                                    | absent   | absent  | t
 trigger public.inspections.safe_release_lock                                                                                       | absent   | absent  | t
 trigger public.maintenance_records.safe_release_evidence                                                                           | absent   | absent  | t
 trigger public.maintenance_records.safe_release_lock                                                                               | absent   | absent  | t
 trigger public.rentals.record_close_guard_v2                                                                                       | absent   | absent  | t
 trigger public.rentals.safe_release_guard                                                                                          | absent   | absent  | t
 trigger public.rentals.safe_release_lock                                                                                           | absent   | absent  | t
 trigger public.rentals.subscription_guard_v1                                                                                       | absent   | absent  | t
 trigger public.user_roles.approval_serialize                                                                                       | absent   | absent  | t
 trigger public.user_roles.integrity_serialize_v1                                                                                   | absent   | absent  | t
 trigger public.vehicles.safe_release_guard                                                                                         | absent   | absent  | t
 trigger public.vehicles.safe_release_lock                                                                                          | absent   | absent  | t
 trigger storage.objects.completed_archive_storage_truncate_v1                                                                      | absent   | absent  | t
 trigger storage.objects.completed_archive_storage_v1                                                                               | absent   | absent  | t
 trigger storage.objects.storage_integrity_truncate_v1                                                                              | absent   | absent  | t
 trigger storage.objects.storage_integrity_v1                                                                                       | absent   | absent  | t
(218 rows)
```

### After step 0 and the packet

Same 218 rows. The eight prerequisites are `present` and `ok`. The 210 collision rows are `present`, so `ok` is false.

```
                                                             check_name                                                             | expected | actual  | ok 
------------------------------------------------------------------------------------------------------------------------------------+----------+---------+----
 index private.rental_subscription_pending_v1                                                                                       | absent   | present | f
 index public.record_one_original                                                                                                   | absent   | present | f
 index public.return_checklists_rental_idx                                                                                          | absent   | present | f
 policy public.agreements.issuer_scope_allow_v2                                                                                     | absent   | present | f
 policy public.agreements.issuer_scope_limit_v2                                                                                     | absent   | present | f
 policy public.application_identity_reviews.approval_scope_permissive_v3                                                            | absent   | present | f
 policy public.application_identity_reviews.approval_scope_restrictive_v3                                                           | absent   | present | f
 policy public.application_identity_reviews.issuer_identity_allow_v5                                                                | absent   | present | f
 policy public.application_identity_reviews.issuer_identity_limit_v5                                                                | absent   | present | f
 policy public.application_identity_reviews.positive_review_privacy_v1                                                              | absent   | present | f
 policy public.application_identity_reviews.record_scope_permissive_v3                                                              | absent   | present | f
 policy public.application_identity_reviews.record_scope_restrictive_v3                                                             | absent   | present | f
 policy public.applications.approval_scope_permissive_v3                                                                            | absent   | present | f
 policy public.applications.approval_scope_restrictive_v3                                                                           | absent   | present | f
 policy public.applications.issuer_scope_allow_v2                                                                                   | absent   | present | f
 policy public.applications.issuer_scope_limit_v2                                                                                   | absent   | present | f
 policy public.applications.record_scope_permissive_v3                                                                              | absent   | present | f
 policy public.applications.record_scope_restrictive_v3                                                                             | absent   | present | f
 policy public.audit_log.approval_scope_permissive_v3                                                                               | absent   | present | f
 policy public.audit_log.approval_scope_restrictive_v3                                                                              | absent   | present | f
 policy public.audit_log.record_scope_permissive_v3                                                                                 | absent   | present | f
 policy public.audit_log.record_scope_restrictive_v3                                                                                | absent   | present | f
 policy public.documents.approval_scope_permissive_v3                                                                               | absent   | present | f
 policy public.documents.approval_scope_restrictive_v3                                                                              | absent   | present | f
 policy public.documents.issuer_scope_allow_v2                                                                                      | absent   | present | f
 policy public.documents.issuer_scope_limit_v2                                                                                      | absent   | present | f
 policy public.documents.record_scope_permissive_v3                                                                                 | absent   | present | f
 policy public.documents.record_scope_restrictive_v3                                                                                | absent   | present | f
 policy public.odometer_readings.record_scope_permissive_v3                                                                         | absent   | present | f
 policy public.odometer_readings.record_scope_restrictive_v3                                                                        | absent   | present | f
 policy public.rentals.record_read_permissive_v3                                                                                    | absent   | present | f
 policy public.rentals.record_read_restrictive_v3                                                                                   | absent   | present | f
 policy public.rentals.record_write_permissive_v3                                                                                   | absent   | present | f
 policy public.rentals.record_write_restrictive_v3                                                                                  | absent   | present | f
 policy public.return_checklist_items.Managers insert return checklist items                                                        | absent   | present | f
 policy public.return_checklist_items.Managers read return checklist items                                                          | absent   | present | f
 policy public.return_checklist_photos.Managers insert return checklist photos                                                      | absent   | present | f
 policy public.return_checklist_photos.Managers read return checklist photos                                                        | absent   | present | f
 policy public.return_checklists.Managers insert return checklists                                                                  | absent   | present | f
 policy public.return_checklists.Managers read return checklists                                                                    | absent   | present | f
 policy public.user_roles.approval_scope_permissive_v3                                                                              | absent   | present | f
 policy public.user_roles.approval_scope_restrictive_v3                                                                             | absent   | present | f
 policy public.user_roles.issuer_scope_allow_v2                                                                                     | absent   | present | f
 policy public.user_roles.issuer_scope_limit_v2                                                                                     | absent   | present | f
 policy public.user_roles.record_scope_permissive_v3                                                                                | absent   | present | f
 policy public.user_roles.record_scope_restrictive_v3                                                                               | absent   | present | f
 policy public.vehicles.record_scope_permissive_v3                                                                                  | absent   | present | f
 policy public.vehicles.record_scope_restrictive_v3                                                                                 | absent   | present | f
 private.agreement_evidence                                                                                                         | absent   | present | f
 private.approval_actor()                                                                                                           | absent   | present | f
 private.approval_after()                                                                                                           | absent   | present | f
 private.approval_application_guard()                                                                                               | absent   | present | f
 private.approval_audit_guard()                                                                                                     | absent   | present | f
 private.approval_evidence_changed()                                                                                                | absent   | present | f
 private.approval_lock()                                                                                                            | absent   | present | f
 private.approval_object_version(uuid)                                                                                              | absent   | present | f
 private.approval_operation_immutable()                                                                                             | absent   | present | f
 private.approval_operations                                                                                                        | absent   | present | f
 private.approval_provider_actor()                                                                                                  | absent   | present | f
 private.approval_result(private.approval_operations, boolean)                                                                      | absent   | present | f
 private.approval_review_guard()                                                                                                    | absent   | present | f
 private.approval_serialize()                                                                                                       | absent   | present | f
 private.approval_snapshot(uuid)                                                                                                    | present  | present | t
 private.approval_validate(uuid)                                                                                                    | present  | present | t
 private.approval_write_audit(uuid, text)                                                                                           | absent   | present | f
 private.assignment_closures                                                                                                        | absent   | present | f
 private.bind_document_integrity_v1(uuid, jsonb, text, text, uuid)                                                                  | absent   | present | f
 private.completed_archive_storage_v1()                                                                                             | absent   | present | f
 private.document_integrity_guard_v1()                                                                                              | absent   | present | f
 private.extend_operations                                                                                                          | absent   | present | f
 private.finalized_archive_document_v1()                                                                                            | absent   | present | f
 private.finalized_archive_pointer_v1()                                                                                             | absent   | present | f
 private.guard_safe_vehicle_release()                                                                                               | absent   | present | f
 private.hold_vehicle_on_evidence()                                                                                                 | absent   | present | f
 private.integrity_serialize_v1()                                                                                                   | absent   | present | f
 private.issue_record_evidence_v1(jsonb, jsonb, jsonb)                                                                              | absent   | present | f
 private.license_snapshot_v1(uuid)                                                                                                  | absent   | present | f
 private.lock_vehicle_release()                                                                                                     | absent   | present | f
 private.positive_audit_guard_v1()                                                                                                  | absent   | present | f
 private.positive_review_guard_v1()                                                                                                 | absent   | present | f
 private.preserve_inspection_safety()                                                                                               | absent   | present | f
 private.record_agreement_evidence(uuid, uuid)                                                                                      | absent   | present | f
 private.record_agreement_evidence(uuid, uuid, timestamp with time zone, numeric)                                                   | absent   | present | f
 private.record_agreement_evidence_v1(uuid, uuid, timestamp with time zone, numeric)                                                | absent   | present | f
 private.record_approval_scope_v3(uuid)                                                                                             | absent   | present | f
 private.record_assignment_history                                                                                                  | absent   | present | f
 private.record_assignment_interval_guard()                                                                                         | absent   | present | f
 private.record_audit_guard()                                                                                                       | absent   | present | f
 private.record_booking_number_seq                                                                                                  | absent   | present | f
 private.record_close_context                                                                                                       | absent   | present | f
 private.record_close_guard_v2()                                                                                                    | absent   | present | f
 private.record_close_operations                                                                                                    | absent   | present | f
 private.record_close_scope_v5(uuid)                                                                                                | absent   | present | f
 private.record_customer_number_seq                                                                                                 | absent   | present | f
 private.record_customers                                                                                                           | absent   | present | f
 private.record_evidence_consumed_v1                                                                                                | absent   | present | f
 private.record_evidence_context_v1                                                                                                 | absent   | present | f
 private.record_evidence_v1                                                                                                         | absent   | present | f
 private.record_executor_scope_v3(uuid)                                                                                             | absent   | present | f
 private.record_existing_rental_evidence_core_v1(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text) | absent   | present | f
 private.record_identity_reader_v2(uuid)                                                                                            | absent   | present | f
 private.record_immutable()                                                                                                         | absent   | present | f
 private.record_issuer_scope_v2(uuid)                                                                                               | absent   | present | f
 private.record_operations                                                                                                          | absent   | present | f
 private.record_session_v1()                                                                                                        | absent   | present | f
 private.record_snapshot_v1(uuid, uuid, uuid, uuid)                                                                                 | absent   | present | f
 private.record_subscription_evidence(uuid, uuid, numeric)                                                                          | absent   | present | f
 private.record_subscription_evidence_v1(uuid, uuid, numeric)                                                                       | absent   | present | f
 private.record_subscription_links                                                                                                  | absent   | present | f
 private.recover_record_evidence_v1(uuid)                                                                                           | absent   | present | f
 private.rental_subscription_operations_v1                                                                                          | absent   | present | f
 private.signed_binding_guard_v1()                                                                                                  | absent   | present | f
 private.storage_integrity_v1()                                                                                                     | absent   | present | f
 private.subscription_actor_v1(uuid, uuid)                                                                                          | absent   | present | f
 private.subscription_guard_v1()                                                                                                    | absent   | present | f
 private.swap_agreement_evidence(uuid, uuid, uuid, timestamp with time zone)                                                        | absent   | present | f
 private.swap_number_seq                                                                                                            | absent   | present | f
 private.swap_operations                                                                                                            | absent   | present | f
 private.swap_project_vehicle_v1(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, uuid, uuid, bigint, text)      | absent   | present | f
 private.validate_license_v1(uuid)                                                                                                  | absent   | present | f
 private.vehicle_release_reasons(uuid, uuid)                                                                                        | absent   | present | f
 private.verify_license_v1(uuid, jsonb)                                                                                             | absent   | present | f
 public.application_identity_reviews                                                                                                | present  | present | t
 public.application_identity_reviews.approval_evidence                                                                              | absent   | present | f
 public.application_identity_reviews.positive_evidence_v1                                                                           | absent   | present | f
 public.applications.approval_evidence_version                                                                                      | absent   | present | f
 public.applications.deleted_at                                                                                                     | present  | present | t
 public.application_waitlist_holds                                                                                                  | present  | present | t
 public.approval_readiness(uuid)                                                                                                    | absent   | present | f
 public.approve_application_checked(uuid, bigint, uuid, text)                                                                       | absent   | present | f
 public.booking_vehicle_assignments                                                                                                 | absent   | present | f
 public.booking_vehicle_assignments.swap_operation_id                                                                               | absent   | present | f
 public.close_recorded_rental_v2(uuid, uuid, timestamp with time zone, text, integer, text)                                         | absent   | present | f
 public.documents.integrity_v1                                                                                                      | absent   | present | f
 public.end_rental_safe_v1(uuid, date, text, integer, uuid, text)                                                                   | absent   | present | f
 public.extend_rental_tx(uuid, uuid, date, date, text)                                                                              | absent   | present | f
 public.link_replacement_agreement_v1(uuid, uuid)                                                                                   | absent   | present | f
 public.list_assignment_history_v1(uuid, uuid)                                                                                      | absent   | present | f
 public.preview_approval_identity(uuid)                                                                                             | absent   | present | f
 public.record_existing_rental_evidence_v1(uuid, jsonb)                                                                             | absent   | present | f
 public.record_existing_rental_tx(uuid, uuid, uuid, timestamp with time zone, numeric, numeric, integer, uuid, text)                | absent   | present | f
 public.recover_application_approval(uuid, uuid)                                                                                    | absent   | present | f
 public.rental_subscription_begin_v1(uuid, uuid, uuid, text, text, text)                                                            | absent   | present | f
 public.rental_subscription_finish_v1(uuid, uuid, uuid, text, text, text)                                                           | absent   | present | f
 public.return_checklist_items                                                                                                      | absent   | present | f
 public.return_checklist_photos                                                                                                     | absent   | present | f
 public.return_checklists                                                                                                           | absent   | present | f
 public.swap_rental_vehicle_tx(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, uuid)                      | absent   | present | f
 public.verify_approval_identity(uuid, jsonb, text)                                                                                 | absent   | present | f
 role rr_approval_executor                                                                                                          | absent   | present | f
 role rr_evidence_issuer                                                                                                            | absent   | present | f
 role rr_record_executor                                                                                                            | absent   | present | f
 storage.buckets condition-media                                                                                                    | present  | present | t
 storage.objects                                                                                                                    | present  | present | t
 storage.objects.name                                                                                                               | present  | present | t
 trigger private.agreement_evidence.agreement_evidence_immutable                                                                    | absent   | present | f
 trigger private.approval_operations.immutable_operation                                                                            | absent   | present | f
 trigger private.assignment_closures.assignment_close_interval                                                                      | absent   | present | f
 trigger private.assignment_closures.record_immutable                                                                               | absent   | present | f
 trigger private.extend_operations.extend_operations_immutable                                                                      | absent   | present | f
 trigger private.record_close_operations.record_immutable                                                                           | absent   | present | f
 trigger private.record_customers.record_immutable                                                                                  | absent   | present | f
 trigger private.record_evidence_consumed_v1.consumption_immutable                                                                  | absent   | present | f
 trigger private.record_evidence_v1.evidence_immutable                                                                              | absent   | present | f
 trigger private.record_operations.record_immutable                                                                                 | absent   | present | f
 trigger private.record_subscription_links.record_immutable                                                                         | absent   | present | f
 trigger private.swap_operations.swap_operations_immutable                                                                          | absent   | present | f
 trigger public.agreements.finalized_archive_pointer_v1                                                                             | absent   | present | f
 trigger public.agreements.integrity_serialize_v1                                                                                   | absent   | present | f
 trigger public.agreements.signed_binding_truncate_v1                                                                               | absent   | present | f
 trigger public.agreements.signed_binding_v1                                                                                        | absent   | present | f
 trigger public.application_identity_reviews.approval_evidence_changed                                                              | absent   | present | f
 trigger public.application_identity_reviews.approval_review_guard                                                                  | absent   | present | f
 trigger public.application_identity_reviews.approval_reviews_truncate                                                              | absent   | present | f
 trigger public.application_identity_reviews.approval_serialize                                                                     | absent   | present | f
 trigger public.application_identity_reviews.integrity_serialize_v1                                                                 | absent   | present | f
 trigger public.application_identity_reviews.positive_review_truncate_v1                                                            | absent   | present | f
 trigger public.application_identity_reviews.positive_review_v1                                                                     | absent   | present | f
 trigger public.applications.approval_audit                                                                                         | absent   | present | f
 trigger public.applications.approval_boundary                                                                                      | absent   | present | f
 trigger public.applications.approval_serialize                                                                                     | absent   | present | f
 trigger public.applications.integrity_serialize_v1                                                                                 | absent   | present | f
 trigger public.audit_log.approval_audit_guard                                                                                      | absent   | present | f
 trigger public.audit_log.approval_audit_truncate                                                                                   | absent   | present | f
 trigger public.audit_log.positive_audit_truncate_v1                                                                                | absent   | present | f
 trigger public.audit_log.positive_audit_v1                                                                                         | absent   | present | f
 trigger public.audit_log.record_audit_immutable                                                                                    | absent   | present | f
 trigger public.audit_log.record_audit_no_truncate                                                                                  | absent   | present | f
 trigger public.booking_vehicle_assignments.assignment_interval                                                                     | absent   | present | f
 trigger public.booking_vehicle_assignments.record_immutable                                                                        | absent   | present | f
 trigger public.documents.approval_evidence_changed                                                                                 | absent   | present | f
 trigger public.documents.approval_serialize                                                                                        | absent   | present | f
 trigger public.documents.document_integrity_truncate_v1                                                                            | absent   | present | f
 trigger public.documents.document_integrity_v1                                                                                     | absent   | present | f
 trigger public.documents.finalized_archive_document_v1                                                                             | absent   | present | f
 trigger public.documents.integrity_serialize_v1                                                                                    | absent   | present | f
 trigger public.incidents.safe_release_evidence                                                                                     | absent   | present | f
 trigger public.incidents.safe_release_lock                                                                                         | absent   | present | f
 trigger public.inspection_items.safe_release_evidence                                                                              | absent   | present | f
 trigger public.inspection_items.safe_release_history                                                                               | absent   | present | f
 trigger public.inspection_items.safe_release_lock                                                                                  | absent   | present | f
 trigger public.inspections.safe_release_evidence                                                                                   | absent   | present | f
 trigger public.inspections.safe_release_history                                                                                    | absent   | present | f
 trigger public.inspections.safe_release_lock                                                                                       | absent   | present | f
 trigger public.maintenance_records.safe_release_evidence                                                                           | absent   | present | f
 trigger public.maintenance_records.safe_release_lock                                                                               | absent   | present | f
 trigger public.rentals.record_close_guard_v2                                                                                       | absent   | present | f
 trigger public.rentals.safe_release_guard                                                                                          | absent   | present | f
 trigger public.rentals.safe_release_lock                                                                                           | absent   | present | f
 trigger public.rentals.subscription_guard_v1                                                                                       | absent   | present | f
 trigger public.user_roles.approval_serialize                                                                                       | absent   | present | f
 trigger public.user_roles.integrity_serialize_v1                                                                                   | absent   | present | f
 trigger public.vehicles.safe_release_guard                                                                                         | absent   | present | f
 trigger public.vehicles.safe_release_lock                                                                                          | absent   | present | f
 trigger storage.objects.completed_archive_storage_truncate_v1                                                                      | absent   | present | f
 trigger storage.objects.completed_archive_storage_v1                                                                               | absent   | present | f
 trigger storage.objects.storage_integrity_truncate_v1                                                                              | absent   | present | f
 trigger storage.objects.storage_integrity_v1                                                                                       | absent   | present | f
(218 rows)
```
