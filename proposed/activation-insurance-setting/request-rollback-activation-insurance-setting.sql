-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Rollback of activation insurance setting v1. Single statement. Separate owner approval required.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '0b73c3a81ea68c1ed7767c24ad783a90deed5c513b624d9f19d3495259617d38', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '0b73c3a81ea68c1ed7767c24ad783a90deed5c513b624d9f19d3495259617d38';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 14205), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '31fed9cfb393d1f6344dc358e1a7cc0916e0e547d66102ddb4e5af933573b9e5';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 14205) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Rollback of activation insurance setting v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-activation-insurance-setting.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Removes exactly what v1 added (two functions, the trigger and its function, three policies, the setting row) and records
-- one evidence row. The app then fails closed: no wrapper means insurance verification is required (PGRST202 path).
-- Audit rows written while v1 was installed (setting changes, checked activations) are kept.
DO $rraisrb$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedaisrb$-- Activation insurance setting v1 rollback inner DDL. Runner owns the transaction.
-- Removes exactly the objects v1 created. The trigger goes first so the setting row can be removed.
DROP FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb);
DROP FUNCTION public.set_rental_activation_insurance_exception(boolean);
DROP TRIGGER rental_activation_setting_guard ON public.app_settings;
DROP FUNCTION private.rental_activation_setting_guard();
DROP POLICY rental_activation_setting_no_client_insert ON public.app_settings;
DROP POLICY rental_activation_setting_no_client_update ON public.app_settings;
DROP POLICY rental_activation_setting_no_client_delete ON public.app_settings;
DELETE FROM public.app_settings WHERE key = 'rental_activation';
$approvedaisrb$;
 journal jsonb; receipts integer; p0031 text; activate_def text; activate_acl text;
 policies_before jsonb; policies_after jsonb; acl_before text; acl_after text; n integer; last_value jsonb;
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
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM 'ece5d70b42f09c81273fa6eb2912323c68076293421581ce8f097d60f6089646'
 THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 -- Everything below is schema-qualified or resolves in pg_catalog; no session search_path applies.
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310202);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.app_settings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 -- Ledger: the 23 receipts production holds since Security 0031, as a prefix. Read only.
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j;
 IF journal IS DISTINCT FROM '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 -- Security 0031: the five containment policies exactly as installed on 2026-10-24. Never touched here.
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' AND p0031 IS NOT NULL THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 -- The existing activation transaction: present, service-role only, and never changed by this package.
 IF pg_catalog.to_regprocedure('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_MISSING'; END IF;
 IF pg_catalog.has_function_privilege('authenticated', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 OR pg_catalog.has_function_privilege('anon', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_ACL_DRIFT'; END IF;
 activate_def := pg_catalog.md5(pg_catalog.pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure));
 activate_acl := (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure);
 -- app_settings: the reviewed shape (RLS on, the Owner-only permissive policy).
 policies_before := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass);
 acl_before := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1')
 THEN RAISE EXCEPTION 'AIS_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1_rollback')
 THEN RAISE EXCEPTION 'AIS_ROLLBACK_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb)') IS NULL OR pg_catalog.to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') IS NULL OR pg_catalog.to_regprocedure('private.rental_activation_setting_guard()') IS NULL
 OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%') <> 3
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 THEN RAISE EXCEPTION 'AIS_PARTIAL_STATE'; END IF;
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = 'public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb)'::pg_catalog.regprocedure) IS DISTINCT FROM '669338378bd3bab69f756e923665fc3a690669fc8ed3a9b9f5c32e4f2c81298a'
 OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = 'public.set_rental_activation_insurance_exception(boolean)'::pg_catalog.regprocedure) IS DISTINCT FROM '39ff1d560ff33a22c416857840b2c6185e94876699cb0aee26d0301e2095fd97'
 THEN RAISE EXCEPTION 'AIS_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;
 SELECT value INTO last_value FROM public.app_settings WHERE key = 'rental_activation';

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF pg_catalog.to_regprocedure('public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb)') IS NOT NULL OR pg_catalog.to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') IS NOT NULL OR pg_catalog.to_regprocedure('private.rental_activation_setting_guard()') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%')
 OR EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'rental_activation')
 THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
 policies_after := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass);
 IF policies_after IS DISTINCT FROM (SELECT pg_catalog.jsonb_agg(x ORDER BY (x->>0) COLLATE "C") FROM pg_catalog.jsonb_array_elements(policies_before) x WHERE x->>0 NOT LIKE 'rental_activation_setting_%')
 THEN RAISE EXCEPTION 'POST_UNEXPECTED_POLICY_CHANGE'; END IF;
 acl_after := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF acl_after IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'POST_ACL_CHANGED'; END IF;
 IF pg_catalog.md5(pg_catalog.pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure)) IS DISTINCT FROM activate_def
 OR (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure) IS DISTINCT FROM activate_acl
 THEN RAISE EXCEPTION 'POST_ACTIVATE_RENTAL_TX_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;

 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', 'activation_insurance_setting_v1_rollback',
  'Activation insurance setting v1 removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'activation-insurance-setting v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', 'ece5d70b42f09c81273fa6eb2912323c68076293421581ce8f097d60f6089646', 'last_setting_value', last_value, 'activate_rental_tx_def_md5', activate_def, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rraisrb$;
