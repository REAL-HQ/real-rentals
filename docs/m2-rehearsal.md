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

`public.application_waitlist_holds` (Drizzle `0014_waitlist_holds_and_safe_promotion.sql`) is still absent. `extend_rental_tx` mentions it inside a PL/pgSQL body, so `CREATE FUNCTION` succeeded. A call that reaches that query will fail until the table exists.

`private.approval_validate` and `private.approval_snapshot` are not created by the 17 packet files or by `supabase/migrations`. They are defined in the excluded approval-boundary script. Steps that call them still installed, because PL/pgSQL resolves those callees at execution time.

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
