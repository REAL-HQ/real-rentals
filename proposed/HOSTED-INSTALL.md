# Hosted M2 install

Proposed procedure for a hosted database. This file does not connect to one, and it does not run the install. Take a backup, or confirm point-in-time recovery covers the start of the window, before any statement that writes. If a later rollback cannot be applied, restore from that backup.

The local rehearsal that proved these files is `docs/m2-rehearsal.md`. `SHOW server_version` there returned `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. Run the same statement on the hosted database and record what it returns. Do not assume the local string.

`proposed/m2-with-approval-boundary/approval-boundary.local.sql` is not part of this procedure.

## Deploy order

Ship the application first. Then run this migration.

`approveApplication` calls `approve_application_checked` with the manager's own JWT (`context.supabase`, not the service role). The packet grants that function to `authenticated` only. When the function is not installed yet, PostgREST returns `PGRST202` and Postgres returns `42883`. Only those two errors use the legacy service-role update of `applications.status` and the legacy `application.approved` audit insert. Any other error is returned and is not retried as a legacy write.

Installing this packet before that application is deployed breaks live Approve. `approval_application_guard` refuses a direct status change to `approved` (`approval_rpc_required`), and `approval_audit_guard` refuses a direct insert of `application.approved` (`approval_audit_rpc_required`).

The other application writes were checked against those triggers and the document, review, and role guards. The only writes they refuse are that status update and that audit insert, both in `src/lib/applications.functions.ts`. Lifecycle updates never set `approved`. Identity-review inserts are `phone_match_email_differs` with no `approval_evidence`. `identity_review.resolved` is not `identity_review.approval_%`. Document inserts do not set `integrity_v1`. `user_roles` inserts and deletes only take the serialize lock.

After the application is deployed and this packet verifies, Approve goes through the RPC. The trigger writes the `application.approved` audit as `rr_approval_executor`. The application does not insert a second one. The local rehearsal proves the legacy write on the baseline, then proves the direct service-role write is refused and `approve_application_checked` succeeds after install.

## Window

The window starts when `proposed/m2-packet/01.sql` commits and ends when `record-uploaded-content-sha.sql` verifies. Approval and signing during that window see a partial install. Stop at the first failed check. Do not start the next file. Do not open this window until the application deploy above is live.

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
6. The preflight row `public CREATE holders` lists who holds `CREATE` on `public`. Step 4 grants `CREATE` on `public` to `rr_record_executor` because PostgreSQL requires the new owner to hold `CREATE` on the schema. That step moves `public.booking_vehicle_assignments` and `public.record_existing_rental_tx` to that role. Read the `actual` column before installing. Stop if `anon` or `authenticated` is in the list.

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
| 2 | `proposed/m2-with-approval-boundary/00-approval-boundary.sql` | own `BEGIN`/`COMMIT`, no `-1` | Step 2 query below | `proposed/rollback/00-approval-boundary.sql` |
| 3 | `proposed/m2-packet/02.sql` | `-1` | Step 3 query below | `proposed/rollback/02-safe-release.sql` |
| 4 | `proposed/m2-packet/03.sql` | `-1` | Step 4 query below | `proposed/rollback/03-record-rental.sql` |
| 5 | `proposed/m2-packet/04.sql` | `-1` | Step 5 query below | `proposed/rollback/04-closeout-legacy-guard.sql` |
| 6 | `proposed/m2-packet/05.sql` | `-1` | Step 6 query below | `proposed/rollback/05-evidence.sql` |
| 7 | `proposed/m2-packet/06.sql` | `-1` | Step 7 query below | `proposed/rollback/06-document-identity.sql` |
| 8 | `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql` | own, no `-1` | Step 8 query below | `proposed/rollback/06b-approval-identity-check.sql` |
| 9 | `proposed/m2-packet/07.sql` | `-1` | Step 9 query below | `proposed/rollback/07-evidence-consumer.sql` |
| 10 | `proposed/m2-packet/08.sql` | `-1` | Step 10 query below | `proposed/rollback/08-evidence-recovery.sql` |
| 11 | `proposed/m2-packet/09.sql` | `-1` | Step 11 query below | `proposed/rollback/09-issuer-permissions.sql` |
| 12 | `proposed/m2-packet/10.sql` | `-1` | Step 12 query below | `proposed/rollback/10-approval-permissions.sql` |
| 13 | `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql` | own, no `-1` | Step 13 query below | `proposed/rollback/10b-approval-executor-writes.sql` |
| 14 | `proposed/m2-packet/11.sql` | `-1` | Step 14 query below | `proposed/rollback/11-executor-permissions.sql` |
| 15 | `proposed/m2-packet/12.sql` | `-1` | Step 15 query below | `proposed/rollback/12-deposit-nullability.sql` |
| 16 | `proposed/m2-packet/13.sql` | `-1` | Step 16 query below | `proposed/rollback/13-closeout-projection.sql` |
| 17 | `proposed/m2-packet/14.sql` | `-1` | Step 17 query below | `proposed/rollback/14-issuer-identity-permissions.sql` |
| 18 | `proposed/m2-packet/15.sql` | `-1` | Step 18 query below | `proposed/rollback/15-consumption-scope.sql` |
| 19 | `proposed/m2-packet/16.sql` | `-1` | Step 19 query below | `proposed/rollback/16-closeout-scope.sql` |
| 20 | `proposed/m2-packet/17.sql` | `-1` | Step 20 query below | `proposed/rollback/17-storage-integrity.sql` |
| 21 | `proposed/m2-packet/18.sql` | `-1` | Step 21 query below | `proposed/rollback/18-subscription-coordination.sql` |
| 22 | `proposed/m2-packet/19.sql` | `-1` | Step 22 query below | `proposed/rollback/19-signed-archive-protection.sql` |
| 23 | `proposed/m2-packet/19b.sql` | `-1` | Step 23 query below | `proposed/rollback/19b-agreement-evidence.sql` |
| 24 | `proposed/m2-with-approval-boundary/19c-agreement-contract.sql` | own, no `-1` | Step 24 query below | `proposed/rollback/19c-agreement-contract.sql` |
| 25 | `proposed/m2-packet/20.sql` | `-1` | Step 25 query below | `proposed/rollback/20-vehicle-swap.sql` |
| 26 | `proposed/m2-packet/extend.sql` | `-1` | Step 26 query below | `proposed/rollback/extend-rental.sql` |
| 27 | `proposed/m2-packet/return.sql` | `-1` | Step 27 query below | `proposed/rollback/return-checklist.sql` |
| 28 | `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql` | own, no `-1` | Step 28 query below | `proposed/rollback/record-uploaded-content-sha.sql` |

Each query returns one boolean. It keeps the step check and adds these privilege assertions: `anon` and `authenticated` have no `USAGE` on `private`; `anon` is not a member of `authenticated`; neither `anon` nor `authenticated` is a member of `service_role`, `postgres`, `authenticator`, `rr_record_executor`, `rr_approval_executor`, or `rr_evidence_issuer` (a role that does not exist yet is skipped); and every packet function that exists after that step has the `proacl` text, `prosecdef` value, and `search_path` proconfig entry recorded from the local install. `proacl::text IS NOT DISTINCT FROM` is the comparison. A null `proacl` (the default `PUBLIC EXECUTE` grant) does not match. `GRANT authenticated TO anon` does not change `proacl` and still makes the query false. `authenticated` EXECUTE is present only on `preview_approval_identity`, `verify_approval_identity`, `recover_application_approval`, `approve_application_checked`, `approval_readiness`, `record_existing_rental_evidence_v1`, `close_recorded_rental_v2`, `swap_rental_vehicle_tx`, and `list_assignment_history_v1`. `record_existing_rental_tx` and `link_replacement_agreement_v1` are `rr_record_executor` only. `extend_rental_tx(uuid,uuid,date,date,text,uuid)` is `service_role` only. Step 23 refuses with `agreement_evidence_already_installed` when `private.agreement_evidence` already exists. Do not re-run `19b.sql` after step 24. Step 25 grants `rr_record_executor` `EXECUTE` on `vehicle_rental_ready_missing(uuid)` and `UPDATE` (`id`) on `application_identity_reviews`. It does not grant rental billing columns. The swap sets `record.application_id`, `record.vehicle_id`, and `app.rental_tx` itself.

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
 AND (SELECT count(*)=22 AND coalesce(bool_and(
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
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 3

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
 AND (SELECT count(*)=28 AND coalesce(bool_and(
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
 ('private.approval_validate(uuid)','{postgres=X/postgres,rr_approval_executor=X/postgres}',true,'search_path=""'),
 ('private.approval_write_audit(uuid,text)','{rr_approval_executor=X/rr_approval_executor}',true,'search_path=""'),
 ('private.guard_safe_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.hold_vehicle_on_evidence()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.lock_vehicle_release()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.preserve_inspection_safety()','{postgres=X/postgres}',true,'search_path=""'),
 ('private.vehicle_release_reasons(uuid,uuid)','{postgres=X/postgres}',true,'search_path=""'),
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 4

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
 AND (SELECT count(*)=34 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 5

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
 AND (SELECT count(*)=36 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 6

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
 AND (SELECT count(*)=43 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 7

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
 AND (SELECT count(*)=52 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 8

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
 AND (SELECT count(*)=52 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 9

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
 AND (SELECT count(*)=53 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 10

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 11

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 12

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 13

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 14

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
 AND (SELECT count(*)=57 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 15

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
 AND (SELECT count(*)=57 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 16

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
 AND (SELECT count(*)=57 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 17

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
 AND (SELECT count(*)=57 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 18

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
 AND (SELECT count(*)=57 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 19

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
 AND (SELECT count(*)=58 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 20

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 21

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
 AND (SELECT count(*)=63 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 22

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
 AND (SELECT count(*)=66 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 23

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 24

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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 25

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
 AND (SELECT count(*)=72 AND coalesce(bool_and(
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
 ('public.recover_application_approval(uuid,uuid)','{postgres=X/postgres,authenticated=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_begin_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.rental_subscription_finish_v1(uuid,uuid,uuid,text,text,text)','{postgres=X/postgres,service_role=X/postgres}',true,'search_path=""'),
 ('public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamp with time zone,integer,integer,text,uuid)','{rr_record_executor=X/rr_record_executor,authenticated=X/rr_record_executor}',true,'search_path=""'),
 ('public.verify_approval_identity(uuid,jsonb,text)','{rr_approval_executor=X/rr_approval_executor,authenticated=X/rr_approval_executor}',true,'search_path=""')
 ) AS e(sig, acl, definer, spath)
 JOIN pg_proc p ON p.oid=to_regprocedure(e.sig));
```

### Step 26

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
 AND (SELECT count(*)=73 AND coalesce(bool_and(
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
 AND (SELECT count(*)=73 AND coalesce(bool_and(
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
SELECT to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)') IS NOT NULL
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
 AND (SELECT count(*)=74 AND coalesce(bool_and(
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

Step 8's function already exists as an invoker after step 7. The check is `SECURITY DEFINER` in `pg_get_functiondef`. Step 10 already creates `approval_scope_permissive_v3` and `approval_scope_restrictive_v3` on `public.audit_log`, so step 13 counts those two policies on `public.audit_log` only when `pg_get_expr` contains `application.approved`, and it also requires `SELECT` on `applications.approval_evidence_version`. Step 16's signature already exists after step 5. The check is the column list `pickup_reading_id,driver_id INTO r`, which step 5's body does not have. Step 18's signature already exists after step 6. The check is `record.application_id`. Step 23 leaves the four-argument `record_agreement_evidence` as a deny-all. Step 24's check is `record_rental_terms_v1` in that body. Step 26 installs `public.extend_rental_tx(uuid,uuid,date,date,text,uuid)`, revokes `PUBLIC`, `anon`, and `authenticated`, grants `EXECUTE` to `service_role`, checks the actor id is a manager before `private.approval_lock`, repeats that check with `FOR SHARE` after the rental lock, and does not call `private.approval_actor`.

Roll `record-uploaded-content-sha.sql` back before the return checklist when undoing a committed prefix. Then roll back return, extend, 20, 19c, 19b, 19 through 2, 00, and 01. Do not skip backward over a later committed step.

## Stop points

- Preflight `ok` is not true, versioning is on, or `storage.objects one row per path` is `duplicated`. Stop. No rollback.
- A file errors inside its transaction. Stop. That file did not commit. Do not roll back earlier steps unless the verification of an earlier step is also wrong.
- A file commits and its verification fails. Stop. Run only that step's rollback, then stop. Do not continue the install in the same window.
- `06b-approval-identity-check.sql` rollback raises `06b_rollback_unused_install_only` when a verified `approval_identity` row exists. `00-approval-boundary.sql` rollback raises `00_rollback_unused_install_only` when any `approval_identity` or `verified` row exists. Export with `proposed/rollback/00-approval-data-export.sql` (read-only, no `-1`), move those rows, and remove them before that rollback. If they cannot be moved, restore the backup or the point-in-time recovery snapshot. Do not force the rollback.

After step 28 verifies, the window is closed. The upload flag in `src/lib/document-content-sha.ts` stays false until a separate rebuild turns it on. This procedure does not change that constant.
