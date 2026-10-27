-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Payments write guard v1: refuse direct API changes to the money fields of public.payments. Single statement.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '37c967cc1008f2ac2fcb661b5d4bb4319e19835fb220de80ee581213660b711b', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '37c967cc1008f2ac2fcb661b5d4bb4319e19835fb220de80ee581213660b711b';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 12931), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'e87b39d8140edee42f0a565c4c7b11a9f5777fee6be7ad8fcfc5636660417e9b';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 12931) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Payments write guard v1: refuse direct API changes to the money fields of public.payments. Single statement.
-- Send only as request-payments-write-guard.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one SECURITY INVOKER trigger function + one BEFORE INSERT OR UPDATE row trigger on public.payments, one audit_log evidence row.
-- Untouched: every payments row, policy, grant and column (fingerprinted before and after), Security 0031, S1, both ledgers.
DO $rrpwg$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedpwg$-- Payments write guard v1 inner DDL. Runner owns the transaction.
-- The money fields of a payment row change only through audited server code (service_role: the
-- staff status actions, Charge Card / Pay Now collection, the Stripe webhook) or approved SQL.
-- A signed-in user's own session (authenticated) and anon may not change them directly, whatever
-- RLS allows: a Manager can still edit notes, due date, method, type and links, and can still add
-- a charge, but only one that starts owed. No policy, grant or row changes.

CREATE FUNCTION private.payments_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $pwgfn$
BEGIN
 IF current_user OPERATOR(pg_catalog.<>) ALL (ARRAY['authenticated', 'anon']::pg_catalog.name[]) THEN
  RETURN NEW;
 END IF;
 IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
  IF NEW.status IS NULL
  OR NOT (NEW.status OPERATOR(pg_catalog.=) ANY (ARRAY['upcoming', 'current', 'overdue', 'past_due', 'late', 'failed', 'unpaid', 'collections']::pg_catalog.text[]))
  OR NEW.amount IS NULL OR NEW.amount OPERATOR(pg_catalog.<) 0
  OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.<) 0 OR COALESCE(NEW.balance_due, 0) OPERATOR(pg_catalog.>) NEW.amount
  OR COALESCE(NEW.late_fees, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.late_fee_applied_through IS NOT NULL
  OR NEW.paid_date IS NOT NULL OR COALESCE(NEW.refunded_amount, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.refunded_at IS NOT NULL
  OR NEW.stripe_payment_intent_id IS NOT NULL OR NEW.stripe_invoice_id IS NOT NULL OR NEW.stripe_subscription_id IS NOT NULL
  OR COALESCE(NEW.attempt_count, 0) OPERATOR(pg_catalog.<>) 0 OR NEW.last_attempt_at IS NOT NULL
  OR NEW.notified_status IS NOT NULL OR NEW.failure_reason IS NOT NULL
  THEN
   RAISE EXCEPTION 'payments_new_charge_must_start_owed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.status, NEW.amount, NEW.balance_due, NEW.late_fees, NEW.late_fee_applied_through, NEW.paid_date,
        NEW.refunded_amount, NEW.refunded_at, NEW.stripe_payment_intent_id, NEW.stripe_invoice_id, NEW.stripe_subscription_id,
        NEW.attempt_count, NEW.last_attempt_at, NEW.notified_status, NEW.failure_reason)
    IS DISTINCT FROM
    ROW(OLD.status, OLD.amount, OLD.balance_due, OLD.late_fees, OLD.late_fee_applied_through, OLD.paid_date,
        OLD.refunded_amount, OLD.refunded_at, OLD.stripe_payment_intent_id, OLD.stripe_invoice_id, OLD.stripe_subscription_id,
        OLD.attempt_count, OLD.last_attempt_at, OLD.notified_status, OLD.failure_reason) THEN
  RAISE EXCEPTION 'payments_money_fields_change_only_through_audited_server' USING ERRCODE = '42501';
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
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM '88fc635b01567e9146a0d770e11ce5cd03c3f111ac8632e5a349e882134f2809'
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
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '11d6ad5ab436af7e35cfb01068b13b6a430e0bc7f4fa2268e4bf8be5558e0b84'
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
   'session_executor', session_user, 'inner_sql_sha256', '88fc635b01567e9146a0d770e11ce5cd03c3f111ac8632e5a349e882134f2809', 'guard_prosrc_sha256', '11d6ad5ab436af7e35cfb01068b13b6a430e0bc7f4fa2268e4bf8be5558e0b84',
   'payments_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pay_before::text, 'UTF8')), 'hex'),
   'payment_rows', rows_before, 'policies_0031_md5', p0031, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrpwg$;
