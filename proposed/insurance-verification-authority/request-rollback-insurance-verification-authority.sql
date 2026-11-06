-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Rollback of insurance verification authority v1. Single statement. Separate owner approval required.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'a43947a725007c7b3abc83c76b8c20f1d0529036efbec2ce4e6dc1f0778d473e', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'a43947a725007c7b3abc83c76b8c20f1d0529036efbec2ce4e6dc1f0778d473e';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 14055), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '7525ab3a65bfffd976306c8e4258d86d249ccfddb59be02ec726396def2b45c3';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 14055) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Rollback of insurance verification authority v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-insurance-verification-authority.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Removes exactly the trigger, its function and the setter. Screening values and audit rows are kept. The app falls back to
-- its server path (Manager+, audit written first, refusing on audit failure) when the setter is absent.
DO $rrivarb$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedivarb$-- Insurance verification authority v1 rollback inner DDL. Runner owns the transaction.
-- Removes exactly the objects v1 created. Stored screening values and audit rows stay.
DROP FUNCTION public.set_insurance_verification(uuid, boolean, text);
DROP TRIGGER zz_insurance_decision_guard ON public.driver_screenings;
DROP FUNCTION private.insurance_decision_guard();
$approvedivarb$;
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
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM 'e4fd96389116d934c976eb48b5dcb0cc59fcda237b276f3d38638db9efc43a3e'
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
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' AND p0031 IS NOT NULL THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
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
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1')
 THEN RAISE EXCEPTION 'IVA_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1_rollback')
 THEN RAISE EXCEPTION 'IVA_ROLLBACK_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('public.set_insurance_verification(uuid, boolean, text)') IS NULL OR pg_catalog.to_regprocedure('private.insurance_decision_guard()') IS NULL
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'IVA_PARTIAL_STATE'; END IF;
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = 'public.set_insurance_verification(uuid, boolean, text)'::pg_catalog.regprocedure) IS DISTINCT FROM 'f8c7e72c1fbfa53134b22e10cc6805127b16af7451877f704978736f695fd9f0'
 THEN RAISE EXCEPTION 'IVA_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF pg_catalog.to_regprocedure('public.set_insurance_verification(uuid, boolean, text)') IS NOT NULL OR pg_catalog.to_regprocedure('private.insurance_decision_guard()') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
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
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', 'insurance_verification_authority_v1_rollback',
  'Insurance verification authority v1 removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'insurance-verification-authority v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', 'e4fd96389116d934c976eb48b5dcb0cc59fcda237b276f3d38638db9efc43a3e', 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrivarb$;
