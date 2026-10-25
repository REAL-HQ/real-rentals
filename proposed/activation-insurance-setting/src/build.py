#!/usr/bin/env python3
# Builds the activation-insurance-setting package from src/inner.sql and src/rollback-inner.sql.
#   python3 proposed/activation-insurance-setting/src/build.py          (writes the files)
#   python3 proposed/activation-insurance-setting/src/build.py --check  (byte-for-byte compare)
# The package and rollback are each ONE statement (a DO block) for the Lovable query_database
# route, which owns the outer transaction. The guarded requests are guard v3
# (scripts/sql-guard/gen-guard3.py, byte-identical to the reviewed generator) + the exact bytes.
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(PKG, "..", ".."))
GUARD = os.path.join(ROOT, "scripts", "sql-guard", "gen-guard3.py")
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

PROFILE = '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'
# The 23 Drizzle receipts production holds since Security 0031 (same list Security S1 pins).
# Pinned as a PREFIX: a later receipt (pending Drizzle 0023, or a route receipt) does not
# refuse; any change to these 23 does. The package never writes the ledger.
JOURNAL23 = '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'
P0031 = "d33877618a9f40924d14e49b6653d7fa"
WRAPPER = "public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean)"
SETTER = "public.set_rental_activation_insurance_exception(boolean)"
GUARDFN = "private.rental_activation_setting_guard()"
ACTIVATE = "public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)"
POLICIES = ["rental_activation_setting_no_client_delete", "rental_activation_setting_no_client_insert", "rental_activation_setting_no_client_update"]


def bodies(inner):
    out = {}
    for tag, name in (("guardfn", "guard"), ("setfn", "setter"), ("checkedfn", "wrapper")):
        m = re.search(r"\$%s\$(.*?)\$%s\$" % (tag, tag), inner, re.S)
        out[name] = sha(m.group(1))
    return out


COMMON_PRE = r"""
 IF profile->>'project_ref' IS DISTINCT FROM 'yuyzdsnrbfhkmfzpvhwx'
 OR profile->>'lovable_project_id' IS DISTINCT FROM '8cf1f99e-71ad-4a93-a47c-bfbe833616d6'
 OR profile->>'system_identifier' IS NULL OR profile->>'execution_role' IS NULL OR profile->>'database' IS NULL
 THEN RAISE EXCEPTION 'UNSEALED_TARGET_PROFILE'; END IF;
 IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM profile->>'system_identifier'
 OR pg_catalog.current_database() IS DISTINCT FROM profile->>'database'
 OR current_user IS DISTINCT FROM profile->>'execution_role'
 THEN RAISE EXCEPTION 'TARGET_MISMATCH'; END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM '@INNER_SHA@'
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
 IF journal IS DISTINCT FROM '@JOURNAL23@'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 -- Security 0031: the five containment policies exactly as installed on 2026-10-24. Never touched here.
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM '@P0031@' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 -- The existing activation transaction: present, service-role only, and never changed by this package.
 IF pg_catalog.to_regprocedure('@ACTIVATE@') IS NULL THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_MISSING'; END IF;
 IF pg_catalog.has_function_privilege('authenticated', '@ACTIVATE@', 'EXECUTE')
 OR pg_catalog.has_function_privilege('anon', '@ACTIVATE@', 'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role', '@ACTIVATE@', 'EXECUTE')
 THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_ACL_DRIFT'; END IF;
 activate_def := pg_catalog.md5(pg_catalog.pg_get_functiondef('@ACTIVATE@'::pg_catalog.regprocedure));
 activate_acl := (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = '@ACTIVATE@'::pg_catalog.regprocedure);
 -- app_settings: the reviewed shape (RLS on, the Owner-only permissive policy).
 policies_before := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass);
 acl_before := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
"""

INSTALL = r"""-- PREPARATION ONLY. Activation insurance setting v1: Owner exception setting, audited setter, checked activation wrapper. Single statement.
-- Send only as request-activation-insurance-setting.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one app_settings row (key rental_activation, OFF), one SECURITY INVOKER trigger function + trigger on public.app_settings,
-- three RESTRICTIVE write policies on public.app_settings for that key, two SECURITY DEFINER functions, one audit_log evidence row.
-- Untouched: activate_rental_tx, end_rental_tx, every other policy (including the five Security 0031 policies), both ledgers.
DO $rrais$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedais$@INNER@$approvedais$;
 journal jsonb; receipts integer; p0031 text; activate_def text; activate_acl text;
 policies_before jsonb; policies_after jsonb; acl_before text; acl_after text; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
@COMMON_PRE@
 IF (SELECT c.relkind = 'r' AND c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass) IS NOT TRUE
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname = 'Admins manage settings' AND po.polpermissive)
 THEN RAISE EXCEPTION 'APP_SETTINGS_DRIFT'; END IF;
 IF pg_catalog.to_regprocedure('private.is_owner()') IS NULL OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
 THEN RAISE EXCEPTION 'HELPER_MISSING'; END IF;
 -- Columns the wrapper and setter read, with their types.
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE NOT a.attisdropped AND a.attnum > 0 AND (
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'insurance_verified' AND a.atttypid = 'boolean'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'lead_id' AND a.atttypid = 'uuid'::pg_catalog.regtype) OR
      (a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attname = 'insurance_expires_on' AND a.atttypid = 'date'::pg_catalog.regtype) OR
      (a.attrelid = 'public.documents'::pg_catalog.regclass AND a.attname IN ('driver_id','category','is_current','review_status','expires_at','storage_path','reviewed_at')) OR
      (a.attrelid = 'public.agreements'::pg_catalog.regclass AND a.attname IN ('application_id','source','status','signed_at','voided_at','rental_id')) OR
      (a.attrelid = 'public.audit_log'::pg_catalog.regclass AND a.attname IN ('actor_user_id','actor_role','action','entity_type','entity_id','metadata')) OR
      (a.attrelid = 'public.app_settings'::pg_catalog.regclass AND a.attname IN ('key','value')))) <> 24
 THEN RAISE EXCEPTION 'COLUMN_SHAPE_DRIFT'; END IF;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 -- Idempotence: one install per evidence row; a re-run, or a partial install, is refused.
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1') THEN
  RAISE EXCEPTION 'AIS_EVIDENCE_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('@WRAPPER@') IS NOT NULL OR pg_catalog.to_regprocedure('@SETTER@') IS NOT NULL
 OR pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%')
 OR EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'rental_activation')
 THEN RAISE EXCEPTION 'AIS_PARTIAL_INSTALL_OR_KEY_EXISTS'; END IF;

 -- Native permission checks remain authoritative; no role elevation.
 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 -- Post: the three functions are exactly the reviewed objects.
 IF (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@WRAPPER_SHA@'
      AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = '@WRAPPER@'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_WRAPPER_MISMATCH'; END IF;
 IF (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@SETTER_SHA@'
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = '@SETTER@'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_SETTER_MISMATCH'; END IF;
 IF (SELECT NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@GUARD_SHA@'
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = '@GUARDFN@'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_GUARD_FUNCTION_MISMATCH'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.app_settings'::pg_catalog.regclass AND t.tgname = 'rental_activation_setting_guard'
      AND NOT t.tgisinternal AND t.tgtype = 31 AND t.tgenabled = 'O' AND t.tgfoid = '@GUARDFN@'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
 -- Post: app_settings policies = before + exactly the three restrictive ones; ACL unchanged.
 policies_after := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname NOT LIKE 'rental_activation_setting_%');
 IF policies_after IS DISTINCT FROM policies_before THEN RAISE EXCEPTION 'POST_UNEXPECTED_POLICY_CHANGE'; END IF;
 IF (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname LIKE 'rental_activation_setting_%')
  IS DISTINCT FROM '[["rental_activation_setting_no_client_delete", "d", false, "{authenticated}"], ["rental_activation_setting_no_client_insert", "a", false, "{authenticated}"], ["rental_activation_setting_no_client_update", "w", false, "{authenticated}"]]'::jsonb
 THEN RAISE EXCEPTION 'POST_POLICY_MISMATCH'; END IF;
 acl_after := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF acl_after IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'POST_ACL_CHANGED'; END IF;
 -- Post: the seeded setting is OFF, and only that one row was added.
 IF (SELECT value FROM public.app_settings WHERE key = 'rental_activation') IS DISTINCT FROM '{"allow_activation_without_insurance_verification": false}'::jsonb
 THEN RAISE EXCEPTION 'POST_SETTING_NOT_OFF'; END IF;
 -- Post: activate_rental_tx byte-identical (definition and ACL), 0031 and the ledger unchanged.
 IF pg_catalog.md5(pg_catalog.pg_get_functiondef('@ACTIVATE@'::pg_catalog.regprocedure)) IS DISTINCT FROM activate_def
 OR (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = '@ACTIVATE@'::pg_catalog.regprocedure) IS DISTINCT FROM activate_acl
 THEN RAISE EXCEPTION 'POST_ACTIVATE_RENTAL_TX_CHANGED'; END IF;
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM '@P0031@' THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;

 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', 'activation_insurance_setting_v1',
  'Activation insurance setting v1 postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'activation-insurance-setting v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', '@INNER_SHA@', 'wrapper_prosrc_sha256', '@WRAPPER_SHA@',
   'setter_prosrc_sha256', '@SETTER_SHA@', 'guard_prosrc_sha256', '@GUARD_SHA@', 'activate_rental_tx_def_md5', activate_def,
   'policies_0031_md5', p0031, 'drizzle_receipts', receipts, 'setting_seeded', false),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrais$;
"""

ROLLBACK = r"""-- PREPARATION ONLY. Rollback of activation insurance setting v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-activation-insurance-setting.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Removes exactly what v1 added (two functions, the trigger and its function, three policies, the setting row) and records
-- one evidence row. The app then fails closed: no wrapper means insurance verification is required (PGRST202 path).
-- Audit rows written while v1 was installed (setting changes, checked activations) are kept.
DO $rraisrb$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedaisrb$@INNER@$approvedaisrb$;
 journal jsonb; receipts integer; p0031 text; activate_def text; activate_acl text;
 policies_before jsonb; policies_after jsonb; acl_before text; acl_after text; n integer; last_value jsonb;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
@COMMON_PRE@
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1')
 THEN RAISE EXCEPTION 'AIS_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1_rollback')
 THEN RAISE EXCEPTION 'AIS_ROLLBACK_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('@WRAPPER@') IS NULL OR pg_catalog.to_regprocedure('@SETTER@') IS NULL OR pg_catalog.to_regprocedure('@GUARDFN@') IS NULL
 OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%') <> 3
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 THEN RAISE EXCEPTION 'AIS_PARTIAL_STATE'; END IF;
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = '@WRAPPER@'::pg_catalog.regprocedure) IS DISTINCT FROM '@WRAPPER_SHA@'
 OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = '@SETTER@'::pg_catalog.regprocedure) IS DISTINCT FROM '@SETTER_SHA@'
 THEN RAISE EXCEPTION 'AIS_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;
 SELECT value INTO last_value FROM public.app_settings WHERE key = 'rental_activation';

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF pg_catalog.to_regprocedure('@WRAPPER@') IS NOT NULL OR pg_catalog.to_regprocedure('@SETTER@') IS NOT NULL OR pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%')
 OR EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'rental_activation')
 THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
 policies_after := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass);
 IF policies_after IS DISTINCT FROM (SELECT pg_catalog.jsonb_agg(x ORDER BY (x->>0) COLLATE "C") FROM pg_catalog.jsonb_array_elements(policies_before) x WHERE x->>0 NOT LIKE 'rental_activation_setting_%')
 THEN RAISE EXCEPTION 'POST_UNEXPECTED_POLICY_CHANGE'; END IF;
 acl_after := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF acl_after IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'POST_ACL_CHANGED'; END IF;
 IF pg_catalog.md5(pg_catalog.pg_get_functiondef('@ACTIVATE@'::pg_catalog.regprocedure)) IS DISTINCT FROM activate_def
 OR (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = '@ACTIVATE@'::pg_catalog.regprocedure) IS DISTINCT FROM activate_acl
 THEN RAISE EXCEPTION 'POST_ACTIVATE_RENTAL_TX_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;

 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', 'activation_insurance_setting_v1_rollback',
  'Activation insurance setting v1 removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'activation-insurance-setting v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', '@INNER_SHA@', 'last_setting_value', last_value, 'activate_rental_tx_def_md5', activate_def, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rraisrb$;
"""


VERIFY = r"""-- READ-ONLY. Activation insurance setting v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true. The setting row is reported, not asserted OFF,
-- because the Owner may have changed it since; setting_changes counts the audited changes.
WITH n AS (
 SELECT pg_catalog.to_regprocedure('@WRAPPER@') AS wrapper, pg_catalog.to_regprocedure('@SETTER@') AS setter,
        pg_catalog.to_regprocedure('@GUARDFN@') AS guardfn, pg_catalog.to_regprocedure('@ACTIVATE@') AS activate
), c AS (
 SELECT
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@WRAPPER_SHA@')::text FROM pg_catalog.pg_proc p WHERE p.oid = n.wrapper) AS wrapper_body,
  (SELECT (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.wrapper) AS wrapper_acl,
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@SETTER_SHA@')::text FROM pg_catalog.pg_proc p WHERE p.oid = n.setter) AS setter_body,
  (SELECT (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.setter) AS setter_acl,
  (SELECT (NOT p.prosecdef AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@GUARD_SHA@'
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.guardfn) AS guard_body,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.app_settings'::pg_catalog.regclass AND t.tgname = 'rental_activation_setting_guard' AND t.tgtype = 31 AND t.tgenabled = 'O')::text AS trigger_rows,
  (SELECT pg_catalog.string_agg(po.polname::text || ':' || po.polcmd::text || ':' || po.polpermissive::text, ',' ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname LIKE 'rental_activation_setting_%') AS policies,
  (SELECT (NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.activate) AS activate_acl,
  (SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) FROM pg_catalog.pg_proc p WHERE p.oid = n.activate) AS activate_def_md5,
  (SELECT metadata->>'activate_rental_tx_def_md5' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1') AS evidence_activate_md5,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1')::text AS evidence_rows,
  (SELECT pg_catalog.jsonb_typeof(value->'allow_activation_without_insurance_verification') FROM public.app_settings WHERE key = 'rental_activation') AS setting_type,
  (SELECT (value->>'allow_activation_without_insurance_verification') FROM public.app_settings WHERE key = 'rental_activation') AS setting_value,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE action = 'settings.rental_activation_updated')::text AS setting_changes,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) AS journal23_md5
 FROM n
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('wrapper.definition', 'true', wrapper_body),
 ('wrapper.service_role_only', 'true', wrapper_acl),
 ('setter.definition', 'true', setter_body),
 ('setter.authenticated_only', 'true', setter_acl),
 ('guard.definition_and_no_api_execute', 'true', guard_body),
 ('guard.trigger', '1', trigger_rows),
 ('app_settings.restrictive_policies', 'rental_activation_setting_no_client_delete:d:false,rental_activation_setting_no_client_insert:a:false,rental_activation_setting_no_client_update:w:false', policies),
 ('activate_rental_tx.service_role_only', 'true', activate_acl),
 ('activate_rental_tx.unchanged_since_install', evidence_activate_md5, activate_def_md5),
 ('evidence.one_row', '1', evidence_rows),
 ('setting.value_is_boolean', 'boolean', setting_type),
 ('setting.value (informational)', '*', setting_value),
 ('setting.audited_changes (informational)', '*', setting_changes),
 ('security_0031.policies_md5', '@P0031@', p0031),
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5)
) v(check_name, expected, actual)
ORDER BY check_name;
"""


def fill(t, inner, inner_sha, b):
    t = t.replace("@COMMON_PRE@", COMMON_PRE.strip("\n"))
    for k, v in {"@PROFILE@": PROFILE, "@JOURNAL23@": JOURNAL23, "@P0031@": P0031, "@ACTIVATE@": ACTIVATE,
                 "@WRAPPER@": WRAPPER, "@SETTER@": SETTER, "@GUARDFN@": GUARDFN, "@INNER_SHA@": inner_sha,
                 "@WRAPPER_SHA@": b["wrapper"], "@SETTER_SHA@": b["setter"], "@GUARD_SHA@": b["guard"]}.items():
        t = t.replace(k, v)
    return t.replace("@INNER@", inner)


def main():
    check = "--check" in sys.argv
    inner = open(os.path.join(HERE, "inner.sql")).read()
    rb_inner = open(os.path.join(HERE, "rollback-inner.sql")).read()
    b = bodies(inner)
    outs = {}
    outs["activation_insurance_setting_v1.sql"] = fill(INSTALL, inner, sha(inner), b)
    outs["rollback.sql"] = fill(ROLLBACK, rb_inner, sha(rb_inner), b)
    outs["verify-after-readonly.sql"] = fill(VERIFY, "", "", b)
    for name in list(outs):
        assert all(ord(c) < 128 for c in outs[name]), name + " must be ASCII"
        assert not re.search(r"@[A-Z0-9_]+@", outs[name]), name + " has an unfilled placeholder"
    tmp = {name: text.encode() for name, text in outs.items()}
    for name, req in (("activation_insurance_setting_v1.sql", "request-activation-insurance-setting.sql"),
                      ("rollback.sql", "request-rollback-activation-insurance-setting.sql")):
        p = os.path.join(PKG, ".build-" + name)
        open(p, "wb").write(tmp[name])
        guard = subprocess.check_output([sys.executable, GUARD, p])
        os.unlink(p)
        tmp[req] = guard + tmp[name]
    meta = {"inner_sql_sha256": sha(inner), "rollback_inner_sql_sha256": sha(rb_inner), "prosrc_sha256": b}
    tmp["build-meta.json"] = (json.dumps(meta, indent=2, sort_keys=True) + "\n").encode()
    bad = []
    for name, data in tmp.items():
        p = os.path.join(PKG, name)
        if check:
            if not os.path.exists(p) or open(p, "rb").read() != data:
                bad.append(name)
        else:
            open(p, "wb").write(data)
    if check:
        if bad:
            print("MISMATCH: " + ", ".join(bad)); sys.exit(1)
        print("all generated files reproduce byte for byte")
    else:
        for name in sorted(tmp):
            print(sha(tmp[name]), name, len(tmp[name]))


if __name__ == "__main__":
    main()
