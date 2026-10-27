-- PREPARATION ONLY. Payments write guard v1: refuse direct API changes to the money fields of public.payments. Single statement.
-- Send only as request-payments-write-guard.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one SECURITY INVOKER trigger function + one BEFORE INSERT OR UPDATE row trigger on public.payments, one audit_log evidence row.
-- Untouched: every payments row, policy, grant and column (fingerprinted before and after), Security 0031, S1, both ledgers.
DO $rrpwg$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedpwg$-- Payments write guard v1 inner DDL. Runner owns the transaction.
-- A payment row changes only through audited server code (service_role: the staff status actions,
-- Charge Card / Pay Now collection, the Stripe webhook, the crons) or approved SQL. A signed-in
-- user's own session (authenticated) and anon may, whatever RLS allows, only:
--   * edit notes on an existing row, and payment_method while it is still owed (an allowlist: every
--     other column, present or added later, is frozen, including amounts, balances, statuses,
--     dates, links and type; a settled row's method is what the accountant export reports);
--   * add a charge that starts owed: an open status, no paid date, refund, Stripe link or attempt
--     state, and a balance no larger than the amount; any column outside the add-a-charge set
--     must be empty or zero.
-- No policy, grant or row changes.

CREATE FUNCTION private.payments_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $pwgfn$
DECLARE
 open_statuses pg_catalog.text[] := ARRAY['upcoming', 'current', 'overdue', 'past_due', 'late', 'failed', 'unpaid', 'collections'];
 editable pg_catalog.text[] := ARRAY['notes', 'updated_at', 'net_collected'];
 insertable pg_catalog.text[] := ARRAY['id', 'created_at', 'updated_at', 'net_collected', 'driver_id', 'vehicle_id', 'rental_id',
   'type', 'reason', 'amount', 'balance_due', 'due_date', 'status', 'payment_method', 'notes'];
BEGIN
 IF current_user OPERATOR(pg_catalog.<>) ALL (ARRAY['authenticated', 'anon']::pg_catalog.name[]) THEN
  RETURN NEW;
 END IF;
 IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
  IF NEW.status IS NULL
  OR NOT (NEW.status OPERATOR(pg_catalog.=) ANY (open_statuses))
  OR NEW.amount IS NULL OR NEW.amount OPERATOR(pg_catalog.<) 0
  OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.<) 0 OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.>) NEW.amount
  OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) insertable) e
              WHERE e.value OPERATOR(pg_catalog.<>) ALL (ARRAY['null', '0']::pg_catalog.jsonb[]))
  THEN
   RAISE EXCEPTION 'payments_new_charge_must_start_owed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.status OPERATOR(pg_catalog.=) ANY (open_statuses) THEN
  editable := pg_catalog.array_append(editable, 'payment_method');
 END IF;
 IF (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) editable) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) editable) THEN
  RAISE EXCEPTION 'payments_change_only_through_audited_server' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $pwgfn$;
REVOKE ALL ON FUNCTION private.payments_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_payments_write_guard BEFORE INSERT OR UPDATE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION private.payments_write_guard();
$approvedpwg$;
 journal_ok boolean; receipts integer; p0031 text; pay_before jsonb; pay_after jsonb; rows_before integer; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
 IF profile->>'project_ref' IS DISTINCT FROM 'yuyzdsnrbfhkmfzpvhwx'
 OR profile->>'lovable_project_id' IS DISTINCT FROM '8cf1f99e-71ad-4a93-a47c-bfbe833616d6'
 OR profile->>'system_identifier' IS NULL OR profile->>'execution_role' IS NULL OR profile->>'database' IS NULL
 THEN RAISE EXCEPTION 'UNSEALED_TARGET_PROFILE'; END IF;
 IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM profile->>'system_identifier'
 OR pg_catalog.current_database() IS DISTINCT FROM profile->>'database'
 OR current_user IS DISTINCT FROM profile->>'execution_role'
 THEN RAISE EXCEPTION 'TARGET_MISMATCH'; END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM 'c2079eda08b2e3054237f7beacd7c74b57655e64cf276a6cc15d43e516bcaa09'
 THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310405);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.payments IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) IS DISTINCT FROM '5cfa7e88ccac860637339bd9bdaab72c' THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 p0031 := (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment'));
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 pay_before := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> 'zz_payments_write_guard'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass);
 SELECT pg_catalog.count(*) INTO rows_before FROM public.payments;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 IF pg_catalog.to_regnamespace('private') IS NULL THEN RAISE EXCEPTION 'PRIVATE_SCHEMA_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1') THEN
  RAISE EXCEPTION 'PWG_EVIDENCE_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('private.payments_write_guard()') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = 'zz_payments_write_guard')
 THEN RAISE EXCEPTION 'PWG_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF (SELECT NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '48c9dc5dc16d477ff3276fae9e156b68ca9d37d2b95176f8664f40e5a4d9704e'
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'private.payments_write_guard()'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_GUARD_FUNCTION_MISMATCH'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND t.tgname = 'zz_payments_write_guard'
      AND NOT t.tgisinternal AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgfoid = 'private.payments_write_guard()'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
 pay_after := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> 'zz_payments_write_guard'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass);
 IF pay_after IS DISTINCT FROM pay_before THEN RAISE EXCEPTION 'POST_PAYMENTS_UNEXPECTED_CHANGE'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM public.payments;
 IF n IS DISTINCT FROM rows_before THEN RAISE EXCEPTION 'POST_PAYMENT_ROWS_CHANGED'; END IF;
 IF (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) IS DISTINCT FROM p0031 THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', 'payments_write_guard_v1',
  'Payments write guard v1 postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'payments-write-guard v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', 'c2079eda08b2e3054237f7beacd7c74b57655e64cf276a6cc15d43e516bcaa09', 'guard_prosrc_sha256', '48c9dc5dc16d477ff3276fae9e156b68ca9d37d2b95176f8664f40e5a4d9704e',
   'payments_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pay_before::text, 'UTF8')), 'hex'),
   'payment_rows', rows_before, 'policies_0031_md5', p0031, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrpwg$;
