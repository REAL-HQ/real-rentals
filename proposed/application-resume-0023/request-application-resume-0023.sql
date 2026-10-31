-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Drizzle 0023 application resume atomic security v1. Single statement.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'f316bf9cc0298a92ece5d4dd6570402d9fde5e954cdebf2ff73a57001b3c5899', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'f316bf9cc0298a92ece5d4dd6570402d9fde5e954cdebf2ff73a57001b3c5899';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 34861), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'b125768282689d3edf81937fa28f2f91b4b5b2d907b171cb10b426ec98195f88';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 34861) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Drizzle 0023 application resume atomic security v1. Single statement.
-- Send only as request-application-resume-0023.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Creates: table public.application_recovery_attempts (RLS on, no policies, service_role only) with up to 24h of backfilled
-- recorded sends; definer functions reserve_application_recovery, finish_application_recovery (service_role only) and
-- resolve_application_identity_review (authenticated; manager-checked inside); one audit_log evidence row.
-- Untouched (fingerprinted before and after): applications, application_resume_tokens, application_identity_reviews,
-- payments and audit_log catalog shape and row counts (audit_log gains only the evidence row), Security 0031, S1, both ledgers.
DO $rrar23$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedar23$-- Drizzle 0023 application resume atomic security, inner DDL (byte copy of drizzle/migrations/0023_application_resume_atomic_security.sql).
-- Runner owns the transaction.
-- Additive, release-only repair. Never run automatically during an app build.
-- Existing migrations remain unchanged. Requires application_identity_reviews
-- (0019/0020), resume tokens, staff helpers, and the canonical audit_log.
CREATE TABLE public.application_recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.application_resume_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'sent', 'failed', 'unknown')),
  provider_id text,
  finished_at timestamptz
);
CREATE INDEX application_recovery_attempts_quota_idx
  ON public.application_recovery_attempts(application_id, created_at DESC);
ALTER TABLE public.application_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_recovery_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.application_recovery_attempts TO service_role;

-- Carry forward recorded successful sends so rollout does not reset an active
-- cooldown. Malformed display metadata is skipped; applicant rows are untouched.
DO $$
DECLARE historical record; entry jsonb; sent_at timestamptz;
BEGIN
  FOR historical IN SELECT id, resubmission_history FROM public.applications
    WHERE jsonb_typeof(resubmission_history) = 'array' LOOP
    FOR entry IN SELECT value FROM jsonb_array_elements(historical.resubmission_history) LOOP
      IF entry->>'link_sent' IS DISTINCT FROM 'true' THEN CONTINUE; END IF;
      BEGIN sent_at := (entry->>'at')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
      END;
      IF sent_at > clock_timestamp() - interval '24 hours' AND sent_at <= clock_timestamp() THEN
        INSERT INTO public.application_recovery_attempts(application_id, created_at, status, finished_at)
          VALUES (historical.id, sent_at, 'sent', sent_at);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- This lock covers every public recovery entry point and every server instance.
-- Count reservations (including failed/unknown delivery), not just successes.
-- No email or raw credential is stored in the attempt ledger.
CREATE FUNCTION public.reserve_application_recovery(_application_id uuid, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.applications%ROWTYPE;
  stamp timestamptz;
  last_attempt timestamptz;
  sixth_latest timestamptz;
  wait_seconds integer;
  attempt_id uuid;
  recovery_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid credential hash'; END IF;
  SELECT * INTO a FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR a.deleted_at IS NOT NULL OR a.purged_at IS NOT NULL OR nullif(btrim(a.email), '') IS NULL THEN
    RETURN jsonb_build_object('reserved', false, 'retry_after_seconds', 120);
  END IF;
  -- Compute time after obtaining the lock, including when another request waited.
  stamp := clock_timestamp();
  SELECT max(created_at) INTO last_attempt FROM public.application_recovery_attempts WHERE application_id = a.id;
  SELECT created_at INTO sixth_latest FROM public.application_recovery_attempts
    WHERE application_id = a.id AND created_at > stamp - interval '24 hours'
    ORDER BY created_at DESC OFFSET 5 LIMIT 1;
  wait_seconds := greatest(0,
    coalesce(ceil(extract(epoch FROM (last_attempt + interval '120 seconds' - stamp)))::integer, 0),
    coalesce(ceil(extract(epoch FROM (sixth_latest + interval '24 hours' - stamp)))::integer, 0));
  IF wait_seconds > 0 THEN
    RETURN jsonb_build_object('reserved', false, 'retry_after_seconds', wait_seconds);
  END IF;
  -- Token and quota reservation commit together. Recovery sends never trim or
  -- revoke an applicant's existing session tokens, including on provider failure.
  INSERT INTO public.application_resume_tokens(application_id, token_hash, created_at, expires_at)
    VALUES (a.id, _token_hash, stamp, stamp + interval '30 minutes') RETURNING id INTO recovery_id;
  INSERT INTO public.application_recovery_attempts(application_id, token_id, created_at)
    VALUES (a.id, recovery_id, stamp) RETURNING id INTO attempt_id;
  RETURN jsonb_build_object('reserved', true, 'attempt_id', attempt_id,
    'email', a.email, 'full_name', a.full_name, 'retry_after_seconds', 120);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_application_recovery(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_application_recovery(uuid, text) TO service_role;

-- Finalization is idempotent; it never frees the reserved quota. An uncertain
-- network result keeps the token valid (the provider may have accepted it).
CREATE FUNCTION public.finish_application_recovery(_attempt_id uuid, _status text, _provider_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE attempt public.application_recovery_attempts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _status IS NULL OR _status NOT IN ('sent', 'failed', 'unknown') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  SELECT * INTO attempt FROM public.application_recovery_attempts WHERE id = _attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery attempt not found'; END IF;
  IF attempt.status <> 'reserved' THEN RETURN; END IF;
  UPDATE public.application_recovery_attempts SET status = _status,
    provider_id = left(_provider_id, 200), finished_at = clock_timestamp() WHERE id = attempt.id;
  IF _status = 'failed' THEN
    UPDATE public.application_resume_tokens SET revoked_at = clock_timestamp()
      WHERE id = attempt.token_id AND revoked_at IS NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_application_recovery(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_application_recovery(uuid, text, text) TO service_role;

-- Called using the authenticated caller, never an actor supplied in a payload.
-- Both writes belong to one transaction: any audit failure rolls back resolution.
CREATE FUNCTION public.resolve_application_identity_review(_review_id uuid, _resolution text, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
  actor_email text;
  review public.application_identity_reviews%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT private.is_manager() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _resolution IS NULL OR _resolution NOT IN ('same_person', 'different_person', 'dismissed')
    OR _note IS NULL OR length(btrim(_note)) < 3 OR length(btrim(_note)) > 500 THEN
    RAISE EXCEPTION 'Invalid resolution';
  END IF;
  SELECT role::text INTO actor_role FROM public.user_roles
    WHERE user_id = actor_id AND role::text IN ('admin', 'team')
    ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO actor_email FROM auth.users WHERE id = actor_id;
  SELECT * INTO review FROM public.application_identity_reviews WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND OR review.status <> 'open' THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  UPDATE public.application_identity_reviews SET status = 'resolved', resolution = _resolution,
    resolution_note = btrim(_note), resolved_by = actor_id, resolved_at = clock_timestamp() WHERE id = review.id;
  INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
    VALUES (actor_id, actor_email, actor_role, 'identity_review.resolved', 'application', review.application_id::text,
      'Resolved identity review (' || replace(_resolution, '_', ' ') || ')',
      jsonb_build_object('review_id', review.id, 'kind', review.kind, 'resolution', _resolution, 'note', btrim(_note)));
  RETURN jsonb_build_object('ok', true, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_application_identity_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_application_identity_review(uuid, text, text) TO authenticated;
$approvedar23$;
 receipts integer; p0031 text; fp_before jsonb; rows_before jsonb; n integer; backfilled integer;
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
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM 'f2c6f4949367cfa9b3cf9d60451dd20f0d0be56c9a98ce1aeced3a08afa6859e'
 THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '60s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310423);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.applications IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.application_resume_tokens IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.application_identity_reviews IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) IS DISTINCT FROM '5cfa7e88ccac860637339bd9bdaab72c' THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 p0031 := (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment'));
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.applications'::pg_catalog.regclass AND tgname = 'zz_application_write_guard' AND tgenabled = 'O') <> 1 THEN RAISE EXCEPTION 'S1_GUARD_MISSING'; END IF;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 fp_before := pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass), 'application_resume_tokens', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.application_resume_tokens'::pg_catalog.regclass), 'application_identity_reviews', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.application_identity_reviews'::pg_catalog.regclass), 'payments', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass), 'audit_log', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.audit_log'::pg_catalog.regclass));
 rows_before := pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.count(*) FROM public.applications), 'application_resume_tokens', (SELECT pg_catalog.count(*) FROM public.application_resume_tokens),
   'application_identity_reviews', (SELECT pg_catalog.count(*) FROM public.application_identity_reviews), 'payments', (SELECT pg_catalog.count(*) FROM public.payments));
 IF NOT (pg_catalog.to_regclass('public.applications') IS NOT NULL AND pg_catalog.to_regclass('public.application_resume_tokens') IS NOT NULL
   AND pg_catalog.to_regclass('public.application_identity_reviews') IS NOT NULL AND pg_catalog.to_regclass('public.user_roles') IS NOT NULL
   AND pg_catalog.to_regclass('public.audit_log') IS NOT NULL AND pg_catalog.to_regprocedure('private.is_manager()') IS NOT NULL
   AND pg_catalog.to_regprocedure('auth.role()') IS NOT NULL AND pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL AND pg_catalog.to_regclass('auth.users') IS NOT NULL
   AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.applications') AND NOT attisdropped
        AND attname IN ('id','email','full_name','deleted_at','purged_at','resubmission_history')) = 6
   AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.application_resume_tokens') AND NOT attisdropped
        AND attname IN ('id','application_id','token_hash','created_at','expires_at','revoked_at')) = 6
   AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.application_identity_reviews') AND NOT attisdropped
        AND attname IN ('id','application_id','kind','status','resolution','resolution_note','resolved_by','resolved_at')) = 8
   AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.audit_log') AND NOT attisdropped
        AND attname IN ('actor_user_id','actor_email','actor_role','action','entity_type','entity_id','summary','metadata','created_at')) = 9) THEN RAISE EXCEPTION 'AR23_DEPENDENCY_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE 'application_resume_0023_v1%') THEN
  RAISE EXCEPTION 'AR23_EVIDENCE_REPLAY'; END IF;
 IF NOT (pg_catalog.to_regclass('public.application_recovery_attempts') IS NULL AND pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)') IS NULL
   AND pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)') IS NULL AND pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)') IS NULL) THEN RAISE EXCEPTION 'AR23_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF (
  (SELECT pg_catalog.bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = current_user)
     FROM pg_catalog.pg_proc p WHERE p.oid IN (pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)'), pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)'), pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)')))
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN (pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)'), pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)'), pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)'))) = 3
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)')) = '1fd353d6e68db25e81a2960428e2422daa80a89a85d8abb2433515c0b11e97d7'
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)')) = '467ad253b466dcfb2961cd860cc8d8690529e92367c1df3d9909bfc97a1d4026'
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)')) = 'ce020abe6b88fa12cb1b96f14e5b334a944f1a29f359619451e5865ec3ad99f7'
  AND NOT pg_catalog.has_function_privilege('anon', 'public.reserve_application_recovery(uuid, text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.reserve_application_recovery(uuid, text)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('service_role', 'public.reserve_application_recovery(uuid, text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.finish_application_recovery(uuid, text, text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.finish_application_recovery(uuid, text, text)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('service_role', 'public.finish_application_recovery(uuid, text, text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.resolve_application_identity_review(uuid, text, text)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.resolve_application_identity_review(uuid, text, text)', 'EXECUTE')
  AND (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.application_recovery_attempts'::pg_catalog.regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.application_recovery_attempts'::pg_catalog.regclass)
  AND NOT pg_catalog.has_table_privilege('anon', 'public.application_recovery_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.application_recovery_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND pg_catalog.has_table_privilege('service_role', 'public.application_recovery_attempts', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.application_recovery_attempts', 'INSERT')
  AND pg_catalog.has_table_privilege('service_role', 'public.application_recovery_attempts', 'UPDATE')
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.application_recovery_attempts'::pg_catalog.regclass AND NOT tgisinternal) = 0) IS NOT TRUE THEN RAISE EXCEPTION 'POST_0023_OBJECTS_MISMATCH'; END IF;
 SELECT pg_catalog.count(*) INTO backfilled FROM public.application_recovery_attempts;
 IF EXISTS (SELECT 1 FROM public.application_recovery_attempts WHERE status <> 'sent' OR token_id IS NOT NULL OR provider_id IS NOT NULL)
 THEN RAISE EXCEPTION 'POST_BACKFILL_SHAPE'; END IF;
 IF pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass), 'application_resume_tokens', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.application_resume_tokens'::pg_catalog.regclass), 'application_identity_reviews', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.application_identity_reviews'::pg_catalog.regclass), 'payments', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass), 'audit_log', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.audit_log'::pg_catalog.regclass)) IS DISTINCT FROM fp_before THEN RAISE EXCEPTION 'POST_EXISTING_TABLES_CHANGED'; END IF;
 IF pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.count(*) FROM public.applications), 'application_resume_tokens', (SELECT pg_catalog.count(*) FROM public.application_resume_tokens),
   'application_identity_reviews', (SELECT pg_catalog.count(*) FROM public.application_identity_reviews), 'payments', (SELECT pg_catalog.count(*) FROM public.payments)) IS DISTINCT FROM rows_before THEN RAISE EXCEPTION 'POST_EXISTING_ROWS_CHANGED'; END IF;
 IF (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) IS DISTINCT FROM p0031 THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.applications'::pg_catalog.regclass AND tgname = 'zz_application_write_guard' AND tgenabled = 'O') <> 1 THEN RAISE EXCEPTION 'POST_S1_GUARD_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', 'application_resume_0023_v1',
  'Drizzle 0023 application resume atomic security postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'application-resume-0023 v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', 'f2c6f4949367cfa9b3cf9d60451dd20f0d0be56c9a98ce1aeced3a08afa6859e',
   'prosrc_sha256', pg_catalog.jsonb_build_object('reserve', '1fd353d6e68db25e81a2960428e2422daa80a89a85d8abb2433515c0b11e97d7', 'finish', '467ad253b466dcfb2961cd860cc8d8690529e92367c1df3d9909bfc97a1d4026', 'resolve', 'ce020abe6b88fa12cb1b96f14e5b334a944f1a29f359619451e5865ec3ad99f7'),
   'existing_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(fp_before::text, 'UTF8')), 'hex'),
   'row_counts', rows_before, 'backfilled_attempts', backfilled, 'policies_0031_md5', p0031, 'drizzle_receipts', receipts,
   'drizzle_receipt_written', false),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'application_resume_0023_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrar23$;
