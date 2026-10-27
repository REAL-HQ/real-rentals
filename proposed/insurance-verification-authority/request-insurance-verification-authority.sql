-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Insurance verification authority v1: Manager/Owner-only, audited insurance verification decisions. Single statement.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'fa086021aabe39b983a49ef81403d5d1e7d4a9e37d46f79aac681e63d9b962e0', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'fa086021aabe39b983a49ef81403d5d1e7d4a9e37d46f79aac681e63d9b962e0';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 24144), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '4b74a27baaf385a970491dc312d6b488f4530a048e9fdfc89413c3905e0a55a5';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 24144) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Insurance verification authority v1: Manager/Owner-only, audited insurance verification decisions. Single statement.
-- Send only as request-insurance-verification-authority.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one SECURITY INVOKER trigger function + trigger (zz_insurance_decision_guard) on public.driver_screenings, one
-- SECURITY DEFINER setter (public.set_insurance_verification), one audit_log evidence row.
-- Untouched: public.applications (its triggers, ACLs and policies are fingerprinted before and after), every grant and policy,
-- Security 0031, Security S1, the M2 packages, both ledgers, every stored screening value.
DO $rriva$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvediva$-- Insurance verification authority v1 inner DDL. Runner owns the transaction.
-- The final insurance verification decision (driver_screenings.insurance_verified and its
-- insurance_verified_at / insurance_verified_by stamps) becomes Manager/Owner only:
-- 1. public.set_insurance_verification verifies or revokes, checks private.is_manager() for the
--    caller's own JWT, and writes the insurance.verified / insurance.verification_revoked audit
--    row in the same transaction (actor, time, insurance document id + SHA-256 + path, insurer,
--    policy number last 4 + SHA-256, policy expiry). An audit failure refuses the decision.
-- 2. A row trigger on public.driver_screenings refuses any other change to those three columns
--    from authenticated, anon or service_role (Coordinators, Managers and Owners writing the
--    table directly, and server code). Every other column, including the insurance information
--    fields (carrier, policy number, carrier phone, policy active, name match), stays writable
--    exactly as today.
-- Nothing on public.applications, no grant and no policy changes.

CREATE FUNCTION private.insurance_decision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $ivguardfn$
BEGIN
 IF current_user OPERATOR(pg_catalog.=) ANY (ARRAY['authenticated', 'anon', 'service_role']::pg_catalog.name[]) THEN
  IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
   IF NEW.insurance_verified IS TRUE OR NEW.insurance_verified_at IS NOT NULL OR NEW.insurance_verified_by IS NOT NULL THEN
    RAISE EXCEPTION 'insurance_decision_manager_rpc_only' USING ERRCODE = '42501';
   END IF;
  ELSIF NEW.insurance_verified IS DISTINCT FROM OLD.insurance_verified
   OR NEW.insurance_verified_at IS DISTINCT FROM OLD.insurance_verified_at
   OR NEW.insurance_verified_by IS DISTINCT FROM OLD.insurance_verified_by THEN
   RAISE EXCEPTION 'insurance_decision_manager_rpc_only' USING ERRCODE = '42501';
  END IF;
 END IF;
 RETURN NEW;
END $ivguardfn$;
REVOKE ALL ON FUNCTION private.insurance_decision_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_insurance_decision_guard BEFORE INSERT OR UPDATE ON public.driver_screenings
 FOR EACH ROW EXECUTE FUNCTION private.insurance_decision_guard();

CREATE FUNCTION public.set_insurance_verification(_application_id uuid, _verified boolean, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $ivsetfn$
DECLARE
 actor uuid := auth.uid();
 actor_role text;
 actor_email text;
 screening uuid;
 old_verified boolean;
 old_at timestamptz;
 old_by text;
 decided_at timestamptz := pg_catalog.clock_timestamp();
 doc_id uuid;
 doc_sha text;
 doc_path text;
 doc_expires date;
 doc_review text;
 carrier text;
 policy text;
 policy_expires date;
 audit_id uuid;
BEGIN
 IF _application_id IS NULL OR _verified IS NULL THEN RAISE EXCEPTION 'decision_required' USING ERRCODE = '22004'; END IF;
 IF actor IS NULL OR private.is_manager() IS NOT TRUE THEN RAISE EXCEPTION 'manager_required' USING ERRCODE = '42501'; END IF;
 SELECT r.role::text INTO actor_role FROM public.user_roles r
  WHERE r.user_id = actor AND r.role::text = ANY (ARRAY['admin', 'team']) ORDER BY (r.role::text = 'admin') DESC LIMIT 1;
 PERFORM 1 FROM public.applications a WHERE a.id = _application_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT sc.id, sc.insurance_verified IS TRUE, sc.insurance_verified_at, sc.insurance_verified_by
  INTO screening, old_verified, old_at, old_by
  FROM public.driver_screenings sc WHERE sc.lead_id = _application_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public.driver_screenings (lead_id) VALUES (_application_id) RETURNING id INTO screening;
  old_verified := false;
 END IF;
 SELECT u.email INTO actor_email FROM auth.users u WHERE u.id = actor;
 UPDATE public.driver_screenings SET insurance_verified = _verified,
  insurance_verified_at = CASE WHEN _verified THEN decided_at END,
  insurance_verified_by = CASE WHEN _verified THEN COALESCE(actor_email, actor::text) END
  WHERE id = screening;
 SELECT d.id, d.content_sha256, d.storage_path, d.expires_at, d.review_status INTO doc_id, doc_sha, doc_path, doc_expires, doc_review
  FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE AND d.category = 'insurance'
  ORDER BY d.created_at DESC LIMIT 1;
 SELECT COALESCE(NULLIF(sc.insurance_carrier, ''), a.insurance_carrier), COALESCE(NULLIF(sc.insurance_policy_number, ''), a.insurance_policy_number), a.insurance_expires_on
  INTO carrier, policy, policy_expires
  FROM public.applications a LEFT JOIN public.driver_screenings sc ON sc.lead_id = a.id WHERE a.id = _application_id;
 policy := pg_catalog.upper(pg_catalog.regexp_replace(policy, '\s', '', 'g'));
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (actor, actor_email, actor_role,
  CASE WHEN _verified THEN 'insurance.verified' ELSE 'insurance.verification_revoked' END, 'application', _application_id::text,
  CASE WHEN _verified THEN 'Insurance verified' ELSE 'Insurance verification revoked' END,
  pg_catalog.jsonb_build_object('decision', CASE WHEN _verified THEN 'verified' ELSE 'revoked' END,
   'from', old_verified, 'to', _verified, 'decided_at', decided_at, 'decided_by', actor, 'note', pg_catalog.left(_note, 500),
   'screening_id', screening, 'previous_verified_at', old_at, 'previous_verified_by', old_by,
   'document', CASE WHEN doc_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('id', doc_id, 'content_sha256', doc_sha,
     'storage_path', doc_path, 'expires_at', doc_expires, 'review_status', doc_review) END,
   'insurer', carrier,
   'policy_number_last4', CASE WHEN policy IS NULL OR policy = '' THEN NULL ELSE pg_catalog.right(policy, 4) END,
   'policy_number_sha256', CASE WHEN policy IS NULL OR policy = '' THEN NULL ELSE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(policy, 'UTF8')), 'hex') END,
   'policy_expires_on', policy_expires, 'source', 'set_insurance_verification'),
  decided_at)
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('verified', _verified, 'previous', old_verified, 'decided_at', decided_at, 'audit_id', audit_id,
  'document_id', doc_id);
END $ivsetfn$;
REVOKE ALL ON FUNCTION public.set_insurance_verification(uuid, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_insurance_verification(uuid, boolean, text) TO authenticated;
$approvediva$;
 journal jsonb; receipts integer; p0031 text; apps_before jsonb; apps_after jsonb; scr_before jsonb; scr_after jsonb; n integer;
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
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM '0e5cfa4160b159a2469dda72c83b672a38db89272a297a0d1d302e8c72795983'
 THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310303);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.driver_screenings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j;
 IF journal IS DISTINCT FROM '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 apps_before := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass);
 scr_before := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> 'zz_insurance_decision_guard'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.driver_screenings'::pg_catalog.regclass);
 IF pg_catalog.to_regprocedure('private.is_manager()') IS NULL OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'HELPER_MISSING'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE NOT a.attisdropped AND a.attnum > 0 AND (
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'insurance_verified' AND a.atttypid = 'boolean'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'insurance_verified_at' AND a.atttypid = 'timestamptz'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'insurance_verified_by' AND a.atttypid = 'text'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname IN ('id','lead_id','insurance_carrier','insurance_policy_number')) OR
      (a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attname IN ('insurance_carrier','insurance_policy_number','insurance_expires_on')) OR
      (a.attrelid = 'public.documents'::pg_catalog.regclass AND a.attname IN ('id','driver_id','category','is_current','content_sha256','storage_path','expires_at','review_status','created_at')) OR
      (a.attrelid = 'public.user_roles'::pg_catalog.regclass AND a.attname IN ('user_id','role')))) <> 21
 THEN RAISE EXCEPTION 'COLUMN_SHAPE_DRIFT'; END IF;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1') THEN
  RAISE EXCEPTION 'IVA_EVIDENCE_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('public.set_insurance_verification(uuid, boolean, text)') IS NOT NULL OR pg_catalog.to_regprocedure('private.insurance_decision_guard()') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'IVA_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'f8c7e72c1fbfa53134b22e10cc6805127b16af7451877f704978736f695fd9f0'
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.set_insurance_verification(uuid, boolean, text)'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_SETTER_MISMATCH'; END IF;
 IF (SELECT NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '6f16d1876d9765962b4b3f2d4c409a59db0620a656d0a92534443bbfe084b080'
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'private.insurance_decision_guard()'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_GUARD_FUNCTION_MISMATCH'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard'
      AND NOT t.tgisinternal AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgfoid = 'private.insurance_decision_guard()'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
 apps_after := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass);
 IF apps_after IS DISTINCT FROM apps_before THEN RAISE EXCEPTION 'POST_APPLICATIONS_CHANGED'; END IF;
 scr_after := (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> 'zz_insurance_decision_guard'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.driver_screenings'::pg_catalog.regclass);
 IF scr_after IS DISTINCT FROM scr_before THEN RAISE EXCEPTION 'POST_SCREENINGS_UNEXPECTED_CHANGE'; END IF;
 IF (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
     FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) IS DISTINCT FROM p0031
 THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;

 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', 'insurance_verification_authority_v1',
  'Insurance verification authority v1 postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'insurance-verification-authority v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', '0e5cfa4160b159a2469dda72c83b672a38db89272a297a0d1d302e8c72795983', 'setter_prosrc_sha256', 'f8c7e72c1fbfa53134b22e10cc6805127b16af7451877f704978736f695fd9f0',
   'guard_prosrc_sha256', '6f16d1876d9765962b4b3f2d4c409a59db0620a656d0a92534443bbfe084b080', 'applications_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(apps_before::text, 'UTF8')), 'hex'),
   'policies_0031_md5', p0031, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rriva$;
