# Hosted M2 install

Proposed procedure for a hosted database. This file does not connect to one, and it does not run the install. Take a backup, or confirm point-in-time recovery covers the start of the window, before any statement that writes. If a later rollback cannot be applied, restore from that backup.

The local rehearsal that proved these files is `docs/m2-rehearsal.md`. `SHOW server_version` there returned `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. Run the same statement on the hosted database and record what it returns. Do not assume the local string.

`proposed/m2-with-approval-boundary/approval-boundary.local.sql` is not part of this procedure.

## Deploy order

Ship the application first. Then run this migration.

`approveApplication` calls `approve_application_checked` with the manager's own JWT (`context.supabase`, not the service role). The packet grants that function to `authenticated` only. When the function is not installed yet, PostgREST returns `PGRST202`. Only that code uses the legacy service-role update of `applications.status` and the legacy `application.approved` audit insert. Postgres `42883`, and a message that mentions either code, is returned and is not retried as a legacy write.

Installing this packet before that application is deployed breaks live Approve. `approval_application_guard` refuses a direct status change to `approved` (`approval_rpc_required`), and `approval_audit_guard` refuses a direct insert of `application.approved` (`approval_audit_rpc_required`).

The other application writes were checked against those triggers and the document, review, and role guards. The only writes they refuse are that status update and that audit insert, both in `src/lib/applications.functions.ts`. Lifecycle updates never set `approved`. Identity-review inserts are `phone_match_email_differs` with no `approval_evidence`. `identity_review.resolved` is not `identity_review.approval_%`. Document inserts do not set `integrity_v1`. `user_roles` inserts and deletes only take the serialize lock.

After the application is deployed and this packet verifies, Approve goes through the RPC. The trigger writes the `application.approved` audit as `rr_approval_executor`. The application does not insert a second one. The local rehearsal proves the legacy write on the baseline, then proves the direct service-role write is refused and `approve_application_checked` succeeds after install.

## Window

The window starts when `proposed/m2-packet/01.sql` commits and ends when `21-revoke-executor-create.sql` verifies. Approval and signing during that window see a partial install. Stop at the first failed check. Do not start the next file. Do not open this window until the application deploy above is live, and do not install step 3 until the hold below is satisfied. Step 2 installs the content-sha function first, so the byte backfill can run before the approval boundary.

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
6. The preflight row `public CREATE holders` lists who holds `CREATE` on `public`. Step 5 grants `CREATE` on `public` and `private` to `rr_record_executor` because PostgreSQL requires the new owner to hold `CREATE` on the schema. That step moves `public.booking_vehicle_assignments` and `public.record_existing_rental_tx` to that role. Later steps move more objects to the same role. Step 29 revokes `CREATE` on both schemas after those transfers. Read the `actual` column before installing. Stop if `anon` or `authenticated` is in the list.
7. `scripts/m2-hosted-preflight.ts` against this database. Every printed line is `PASS`. A `STOP` means do not install.

## Read-only pre-flight

Run this before step 1. It does not write, and it does not connect unless `--url` is passed.

```
bun scripts/m2-hosted-preflight.ts --url '<postgres connection>'
```

A host that is not `127.0.0.1`, `localhost`, or `[::1]` also needs `--hosted`. The script does not read `SUPABASE_URL`. `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, and `PGDATABASE` fill in parts the URL leaves out. It prints `target host=` and then one `PASS` or `STOP` line per check, with the install step that first creates the object. It does not print a password. Step 0 is a prerequisite, not an install file.

The script loads `proposed/m2-preflight.sql` and accepts one `SELECT` or `WITH`. The guard tokenizes comments, standard strings, `E''` strings, dollar quotes, and quoted identifiers. A semicolon inside those cannot start another command. `set_config`, `pg_advisory_lock`, `pg_terminate_backend`, `pg_notify`, `pg_reload_conf`, and `pg_read_file` are refused before connect. The statement is sent with the extended protocol, which rejects a multi-command string. The connection sets `default_transaction_read_only` to `on`. The transaction checks that `transaction_read_only` is `on` and ends with `ROLLBACK`. Run it as a role that can `SELECT` the checklist tables and cannot insert, update, delete, or change the catalog. A superuser can ignore the read-only setting. The script does not create that role. A missing `documents.content_sha256` column prints `STOP step 0` labelled `supabase/migrations prerequisite`. That column comes from the migrations. The license counts read it through `to_jsonb`, so a missing column does not abort the run. Current `license_front` and `license_back` rows, applications, and the `active` and `suspended` application counts are reports: a non-zero count is still `PASS`. `applications.approval_evidence_version`, `application_identity_reviews.approval_evidence`, and `documents.integrity_v1` are created by the packet and must be `absent`. `anon`, `authenticated`, and `service_role` must already exist. The `rr_` roles must be `absent`.

## Step 3 hold

Do not install step 3, `proposed/m2-with-approval-boundary/00-approval-boundary.sql`, until all of the following are true. Step 2 is already installed. Otherwise Approve closes for everyone. The approval snapshot requires a verified `approval_identity` review and a server-recorded hash of the license bytes. A client-set `user_metadata.sha256` does not satisfy it. A real application fails `documents_unverified`, and after staff document review it fails `approval_storage_version_unverified`.

1. The flag-on builds are deployed. `DOCUMENT_CONTENT_SHA256_ENABLED` in `src/lib/document-content-sha.ts` and `IDENTITY_VERIFICATION_ENABLED` in `src/lib/identity-verification.ts` are true in that build. Both constants stay false in this repository. Turning either one on is a separate owner approval. Do not flip them as part of this install. The identity action calls `verify_approval_identity` from the application review screen, and it checks its flag before any role lookup or RPC. Hash-on-upload records `content_sha256` from the downloaded bytes when its flag is on.
2. `scripts/backfill-document-content-sha.ts --write` has been run with a service_role key. Pass the project with `--url` or a shell `SUPABASE_URL` that is not the committed `.env` value. The script prints `target host=` before it reads anything. It refuses any other JWT role. It downloads each current `license_front` and `license_back` object. A row with no 64-hex `content_sha256` is hashed through `writeUploadedContentSha`, which writes both sides through `record_uploaded_content_sha` from those bytes and overwrites a client-set `user_metadata.sha256`. It does not copy metadata into `documents.content_sha256`. A row that already has a 64-hex hash is downloaded and compared. A match is skipped, so a second run resumes. A difference is counted `mismatched` and is not replaced. Any Storage HTTP status other than 404, including 403 and a 5xx, is `storage_errors` and the run continues. A download error with no HTTP status and no message is `storage_errors`, not `missing`. The writer substitutes `Uploaded object missing` or `Uploaded bytes missing` when the client sent neither, and both of those messages are `storage_errors`. A thrown network error has a message and no HTTP status, and it still aborts the run. The process exits non-zero. The printed line has `storage_errors=0`, `missing=0`, and the `mismatched` count from that byte comparison.
3. `proposed/backfill-document-content-sha.sql` has been run as a report. It does not write a hash. A session that sets `m2.backfill_content_sha` to `write` is refused. The report's `missing` and `mismatched` counts are both 0. That SQL report is the gate. A dry-run of the script does not download, so its `mismatched=0` does not prove a stored hash matches the bytes. A forged `user_metadata` sha, or a `content_sha256` with no server binding, is mismatched in the SQL report. Clearing `documents.content_sha256` does not remove `private.uploaded_content_sha`. That table is revoked from `service_role` and has no policy. Only the table owner, the role that committed step 2, can delete the binding:

```sql
DELETE FROM private.uploaded_content_sha
WHERE bucket_id = '<bucket>' AND name = '<object path>';
```

Then set `documents.content_sha256` to null for that bucket and path, and run `--write` again. The script does not delete the binding.

Installing step 3 before those three leaves no path that can satisfy the snapshot. Approve stays closed for every applicant.

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
| 1 | `proposed/m2-packet/01.sql` | `-1` or one editor run | Step 1 query below | `proposed/rollback/01-auth-binding.sql` |
| 2 | `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql` | own `BEGIN`/`COMMIT`, no `-1` | Step 2 query below | `proposed/rollback/record-uploaded-content-sha.sql` |
| 3 | `proposed/m2-with-approval-boundary/00-approval-boundary.sql` | own `BEGIN`/`COMMIT`, no `-1` | Step 3 query below | `proposed/rollback/00-approval-boundary.sql` |
| 4 | `proposed/m2-packet/02.sql` | `-1` | Step 4 query below | `proposed/rollback/02-safe-release.sql` |
| 5 | `proposed/m2-packet/03.sql` | `-1` | Step 5 query below | `proposed/rollback/03-record-rental.sql` |
| 6 | `proposed/m2-packet/04.sql` | `-1` | Step 6 query below | `proposed/rollback/04-closeout-legacy-guard.sql` |
| 7 | `proposed/m2-packet/05.sql` | `-1` | Step 7 query below | `proposed/rollback/05-evidence.sql` |
| 8 | `proposed/m2-packet/06.sql` | `-1` | Step 8 query below | `proposed/rollback/06-document-identity.sql` |
| 9 | `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql` | own, no `-1` | Step 9 query below | `proposed/rollback/06b-approval-identity-check.sql` |
| 10 | `proposed/m2-packet/07.sql` | `-1` | Step 10 query below | `proposed/rollback/07-evidence-consumer.sql` |
| 11 | `proposed/m2-packet/08.sql` | `-1` | Step 11 query below | `proposed/rollback/08-evidence-recovery.sql` |
| 12 | `proposed/m2-packet/09.sql` | `-1` | Step 12 query below | `proposed/rollback/09-issuer-permissions.sql` |
| 13 | `proposed/m2-packet/10.sql` | `-1` | Step 13 query below | `proposed/rollback/10-approval-permissions.sql` |
| 14 | `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql` | own, no `-1` | Step 14 query below | `proposed/rollback/10b-approval-executor-writes.sql` |
| 15 | `proposed/m2-packet/11.sql` | `-1` | Step 15 query below | `proposed/rollback/11-executor-permissions.sql` |
| 16 | `proposed/m2-packet/12.sql` | `-1` | Step 16 query below | `proposed/rollback/12-deposit-nullability.sql` |
| 17 | `proposed/m2-packet/13.sql` | `-1` | Step 17 query below | `proposed/rollback/13-closeout-projection.sql` |
| 18 | `proposed/m2-packet/14.sql` | `-1` | Step 18 query below | `proposed/rollback/14-issuer-identity-permissions.sql` |
| 19 | `proposed/m2-packet/15.sql` | `-1` | Step 19 query below | `proposed/rollback/15-consumption-scope.sql` |
| 20 | `proposed/m2-packet/16.sql` | `-1` | Step 20 query below | `proposed/rollback/16-closeout-scope.sql` |
| 21 | `proposed/m2-packet/17.sql` | `-1` | Step 21 query below | `proposed/rollback/17-storage-integrity.sql` |
| 22 | `proposed/m2-packet/18.sql` | `-1` | Step 22 query below | `proposed/rollback/18-subscription-coordination.sql` |
| 23 | `proposed/m2-packet/19.sql` | `-1` | Step 23 query below | `proposed/rollback/19-signed-archive-protection.sql` |
| 24 | `proposed/m2-packet/19b.sql` | `-1` | Step 24 query below | `proposed/rollback/19b-agreement-evidence.sql` |
| 25 | `proposed/m2-with-approval-boundary/19c-agreement-contract.sql` | own, no `-1` | Step 25 query below | `proposed/rollback/19c-agreement-contract.sql` |
| 26 | `proposed/m2-packet/20.sql` | `-1` | Step 26 query below | `proposed/rollback/20-vehicle-swap.sql` |
| 27 | `proposed/m2-packet/extend.sql` | `-1` | Step 27 query below | `proposed/rollback/extend-rental.sql` |
| 28 | `proposed/m2-packet/return.sql` | `-1` | Step 28 query below | `proposed/rollback/return-checklist.sql` |
| 29 | `proposed/m2-packet/21-revoke-executor-create.sql` | `-1` | Step 29 query below | `proposed/rollback/21-revoke-executor-create.sql` |

Each query returns one boolean. It keeps the step check and adds these privilege assertions: `anon` and `authenticated` have no `USAGE` on `private`; `anon` is not a member of `authenticated`; neither `anon` nor `authenticated` is a member of `service_role`, `postgres`, `authenticator`, `rr_record_executor`, `rr_approval_executor`, or `rr_evidence_issuer` (a role that does not exist yet is skipped); and every packet function that exists after that step has the `proacl` text, `prosecdef` value, and `search_path` proconfig entry recorded from the local install. `proacl::text IS NOT DISTINCT FROM` is the comparison. A null `proacl` (the default `PUBLIC EXECUTE` grant) does not match. `GRANT authenticated TO anon` does not change `proacl` and still makes the query false. `authenticated` EXECUTE is present only on `preview_approval_identity`, `verify_approval_identity`, `recover_application_approval`, `approve_application_checked`, `approval_readiness`, `record_existing_rental_evidence_v1`, `close_recorded_rental_v2`, `swap_rental_vehicle_tx`, `list_assignment_history_v1`, and `link_replacement_agreement_checked`. `record_existing_rental_tx` and `link_replacement_agreement_v1` are `rr_record_executor` only. `extend_rental_tx(uuid,uuid,date,date,text,uuid)` is `service_role` only. `record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)` is `service_role` only. Step 24 refuses with `agreement_evidence_already_installed` when `private.agreement_evidence` already exists. Do not re-run `19b.sql` after step 25. Step 26 grants `rr_record_executor` `EXECUTE` on `vehicle_rental_ready_missing(uuid)` and `UPDATE` (`id`) on `application_identity_reviews`. It does not grant rental billing columns. The swap sets `record.application_id`, `record.vehicle_id`, and `app.rental_tx` itself.

### Step 1

```sql
SELECT to_regprocedure('private.approval_provider_actor()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=5 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 2

```sql
SELECT to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL
 AND to_regclass('private.uploaded_content_sha') IS NOT NULL
 AND to_regprocedure('private.approval_provider_actor()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=6 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 3

```sql
SELECT to_regprocedure('private.approval_validate(uuid)') IS NOT NULL AND to_regclass('private.approval_operations') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=24 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=public'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 4

```sql
SELECT to_regprocedure('private.lock_vehicle_release()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=30 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 5

```sql
SELECT to_regclass('public.booking_vehicle_assignments') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=36 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 6

```sql
SELECT to_regclass('private.record_close_operations') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=38 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 7

```sql
SELECT to_regclass('private.record_evidence_v1') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=45 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 8

```sql
SELECT to_regprocedure('private.document_integrity_guard_v1()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=54 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 9

```sql
SELECT (SELECT pg_get_functiondef('private.integrity_serialize_v1()'::regprocedure) LIKE '%SECURITY DEFINER%')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=54 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 10

```sql
SELECT to_regprocedure('private.record_identity_reader_v2(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=55 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 11

```sql
SELECT to_regprocedure('private.recover_record_evidence_v1(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=56 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 12

```sql
SELECT to_regprocedure('private.record_issuer_scope_v2(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=57 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 13

```sql
SELECT to_regprocedure('private.record_approval_scope_v3(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=58 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 14

```sql
SELECT has_column_privilege('rr_approval_executor','public.applications','approval_evidence_version','SELECT') AND (SELECT count(*) = 2 FROM pg_policy WHERE polrelid = 'public.audit_log'::regclass AND polname IN ('approval_scope_permissive_v3','approval_scope_restrictive_v3') AND pg_get_expr(polqual, polrelid) LIKE '%application.approved%')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=58 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 15

```sql
SELECT to_regprocedure('private.record_executor_scope_v3(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=59 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 16

```sql
SELECT (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema='public' AND table_name='rentals' AND column_name='deposit_amount')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=59 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 17

```sql
SELECT (SELECT pg_get_functiondef('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)'::regprocedure) LIKE '%pickup_reading_id,driver_id INTO r%')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=59 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 18

```sql
SELECT (SELECT count(*) = 1 FROM pg_policy WHERE polname='issuer_identity_allow_v5')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=59 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 19

```sql
SELECT (SELECT pg_get_functiondef('public.record_existing_rental_evidence_v1(uuid,jsonb)'::regprocedure) LIKE '%record.application_id%')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=59 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 20

```sql
SELECT to_regprocedure('private.record_close_scope_v5(uuid)') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=60 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 21

```sql
SELECT to_regprocedure('private.storage_integrity_v1()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=61 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 22

```sql
SELECT to_regclass('private.rental_subscription_operations_v1') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=65 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 23

```sql
SELECT to_regprocedure('private.finalized_archive_pointer_v1()') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=68 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 24

```sql
SELECT to_regclass('private.agreement_evidence') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=71 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 25

```sql
SELECT (SELECT pg_get_functiondef('private.record_agreement_evidence(uuid,uuid,timestamptz,numeric)'::regprocedure) LIKE '%record_rental_terms_v1%')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=71 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 26

```sql
SELECT to_regclass('private.swap_operations') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=75 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.list_assignment_history_v1(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.swap_agreement_evidence(uuid,uuid,uuid,timestamp with time zone)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,uuid,uuid,bigint,text)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 27

```sql
SELECT to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)') IS NOT NULL AND to_regclass('private.extend_operations') IS NOT NULL AND coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'') LIKE '%manager_required%' AND position('manager_required' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) < position('private.approval_lock' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'private.approval_lock')) AND position('approval_actor' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) = 0 AND position('FOR SHARE NOWAIT' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'')) > position('private.approval_lock' in coalesce(pg_get_functiondef(to_regprocedure('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)')),'private.approval_lock'))
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=76 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.list_assignment_history_v1(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.swap_agreement_evidence(uuid,uuid,uuid,timestamp with time zone)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,uuid,uuid,bigint,text)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 28

```sql
SELECT to_regclass('public.return_checklists') IS NOT NULL
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=76 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.list_assignment_history_v1(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.swap_agreement_evidence(uuid,uuid,uuid,timestamp with time zone)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,uuid,uuid,bigint,text)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 29

```sql
SELECT to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL
 AND NOT has_schema_privilege('rr_record_executor','public','CREATE')
 AND NOT has_schema_privilege('rr_record_executor','private','CREATE')
 AND NOT has_schema_privilege('anon','private','USAGE')
 AND NOT has_schema_privilege('authenticated','private','USAGE')
 AND NOT EXISTS (
  SELECT 1
  FROM (VALUES ('anon'), ('authenticated')) AS w(who)
  CROSS JOIN (VALUES
   ('authenticated'),
   ('service_role'),
   ('postgres'),
   ('authenticator'),
   ('rr_record_executor'),
   ('rr_approval_executor'),
   ('rr_evidence_issuer')
  ) AS priv(rol)
  WHERE to_regrole(w.who) IS NOT NULL
    AND to_regrole(priv.rol) IS NOT NULL
    AND w.who <> priv.rol
    AND pg_has_role(w.who, priv.rol, 'member')
 )
 AND (SELECT count(*)=76 AND coalesce(bool_and(
      p.proacl::text IS NOT DISTINCT FROM e.acl
      AND p.prosecdef = e.definer
      AND (SELECT c FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) = 'search_path') IS NOT DISTINCT FROM e.spath
    ), false)
 FROM (VALUES
 ('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.approval_readiness(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.approve_application_checked(uuid,bigint,uuid,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""'),
 ('public.close_recorded_rental_v2(uuid,uuid,timestamp with time zone,text,integer,text)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.end_rental_safe_v1(uuid,date,text,integer,uuid,text)','{postgres=X/postgres,service_role=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.end_rental_tx(uuid,date,text,integer,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_checked(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.link_replacement_agreement_v1(uuid,uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('public.list_assignment_history_v1(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.preview_approval_identity(uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('private.approval_actor()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_after()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_application_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_evidence_changed()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.approval_lock()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_object_version(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_operation_immutable()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_provider_actor()','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_result(private.approval_operations,boolean)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_review_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_serialize()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.approval_snapshot(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_source_statuses()','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.bind_document_integrity_v1(uuid,jsonb,text,text,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.completed_archive_storage_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.document_integrity_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.finalized_archive_document_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.finalized_archive_pointer_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.integrity_serialize_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.issue_record_evidence_v1(jsonb,jsonb,jsonb)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.license_snapshot_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.positive_audit_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.positive_review_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_approval_scope_v3(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('private.record_assignment_interval_guard()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_audit_guard()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.record_close_guard_v2()','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_close_scope_v5(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_executor_scope_v3(uuid)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor,postgres=X/rr_record_executor}',true,'search_path=""'),
 ('private.record_identity_reader_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_immutable()','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_issuer_scope_v2(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',false,'search_path=""'),
 ('private.record_session_v1()','{postgres=X/postgres,rr_evidence_issuer=X/postgres,rr_approval_executor=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.record_snapshot_v1(uuid,uuid,uuid,uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.record_subscription_evidence(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.record_subscription_evidence_v1(uuid,uuid,numeric)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.recover_record_evidence_v1(uuid)','{postgres=X/postgres,rr_evidence_issuer=X/postgres}',true,'search_path=""'),
 ('private.signed_binding_guard_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.storage_integrity_v1()','{postgres=X/postgres}',false,'search_path=""'),
 ('private.subscription_actor_v1(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.subscription_guard_v1()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.swap_agreement_evidence(uuid,uuid,uuid,timestamp with time zone)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,uuid,uuid,bigint,text)','{postgres=X/postgres,rr_record_executor=X/postgres}',true,'search_path=""'),
 ('private.validate_license_v1(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres,rr_evidence_issuer=X/postgres,rr_record_executor=X/postgres}',false,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('private.verify_license_v1(uuid,jsonb)','{postgres=X/postgres,rr_approval_executor=X/postgres}',false,'search_path=""'),
 ('public.record_existing_rental_evidence_v1(uuid,jsonb)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.record_existing_rental_tx(uuid,uuid,uuid,timestamp with time zone,numeric,numeric,integer,uuid,text)','{rr_record_executor=X/rr_record_executor}',true,'search_path=""'),
 ('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamp with time zone)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```



Each verify query returns `f` immediately before its file and `t` immediately after. The same query is false after `GRANT authenticated TO anon`, and it is false if `prosecdef` or the `search_path` entry differs from the recorded row. A later file may replace a function again. Run the query for the file just applied, not after the whole install.

Step 9's function already exists as an invoker after step 8. The check is `SECURITY DEFINER` in `pg_get_functiondef`. Step 13 (`proposed/m2-packet/10.sql`) already creates `approval_scope_permissive_v3` and `approval_scope_restrictive_v3` on `public.audit_log`, so step 14 counts those two policies on `public.audit_log` only when `pg_get_expr` contains `application.approved`, and it also requires `SELECT` on `applications.approval_evidence_version`. Step 17's signature already exists after step 6. The check is the column list `pickup_reading_id,driver_id INTO r`, which step 6's body does not have. Step 19's signature already exists after step 7. The check is `record.application_id`. Step 24 leaves the four-argument `record_agreement_evidence` as a deny-all. Step 25's check is `record_rental_terms_v1` in that body. Step 27 installs `public.extend_rental_tx(uuid,uuid,date,date,text,uuid)`, revokes `PUBLIC`, `anon`, and `authenticated`, grants `EXECUTE` to `service_role`, checks the actor id is a manager before `private.approval_lock`, repeats that check with `FOR SHARE` after the rental lock, and does not call `private.approval_actor`. Step 2 installs `public.record_uploaded_content_sha` and `private.uploaded_content_sha` before the approval boundary.

Roll `21-revoke-executor-create.sql` back first when undoing a committed prefix. Then roll back return, extend, 20, 19c, 19b, 19 through 2, 00, the content-sha file, and 01. Do not skip backward over a later committed step. Step 29's rollback grants `CREATE` on `public` and `private` back to `rr_record_executor`.

## Stop points

- Preflight `ok` is not true, versioning is on, or `storage.objects one row per path` is `duplicated`. Stop. No rollback.
- A file errors inside its transaction. Stop. That file did not commit. Do not roll back earlier steps unless the verification of an earlier step is also wrong.
- A file commits and its verification fails. Stop. Run only that step's rollback, then stop. Do not continue the install in the same window.
- `06b-approval-identity-check.sql` rollback raises `06b_rollback_unused_install_only` when a verified `approval_identity` row exists. `00-approval-boundary.sql` rollback raises `00_rollback_unused_install_only` when any `approval_identity` or `verified` row exists. Export with `proposed/rollback/00-approval-data-export.sql` (read-only, no `-1`), move those rows, and remove them before that rollback. If they cannot be moved, restore the backup or the point-in-time recovery snapshot. Do not force the rollback.

After step 29 verifies, the window is closed. `rr_record_executor` no longer holds `CREATE` on `public` or `private`. The upload flag in `src/lib/document-content-sha.ts` stays false until a separate rebuild turns it on. `IDENTITY_VERIFICATION_ENABLED` stays false the same way. This procedure does not change either constant.
