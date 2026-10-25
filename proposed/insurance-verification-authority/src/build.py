#!/usr/bin/env python3
# Builds the insurance-verification-authority package from src/inner.sql and src/rollback-inner.sql.
#   python3 proposed/insurance-verification-authority/src/build.py          (writes the files)
#   python3 proposed/insurance-verification-authority/src/build.py --check  (byte-for-byte compare)
# One statement (a DO block) each for install and rollback; guarded requests are guard v3
# (scripts/sql-guard/gen-guard3.py, byte-identical to the reviewed generator) + the exact bytes.
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(PKG, "..", ".."))
GUARD = os.path.join(ROOT, "scripts", "sql-guard", "gen-guard3.py")
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

PROFILE = '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'
JOURNAL23 = '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'
P0031 = "d33877618a9f40924d14e49b6653d7fa"
SETTER = "public.set_insurance_verification(uuid, boolean, text)"
GUARDFN = "private.insurance_decision_guard()"

# Fingerprints the other packages gate on. public.applications must be byte-for-byte unchanged
# (S1 and M2 fingerprint its triggers and ACLs); driver_screenings gains exactly one trigger.
FP = r"""(SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal@EXCL@),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = '@TABLE@'::pg_catalog.regclass)"""
def fp(table, excl=False):
    return FP.replace("@TABLE@", table).replace("@EXCL@", " AND t.tgname <> 'zz_insurance_decision_guard'" if excl else "")

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
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310303);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.driver_screenings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j;
 IF journal IS DISTINCT FROM '@JOURNAL23@'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 @P0031_CHECK@
 apps_before := @FP_APPS@;
 scr_before := @FP_SCR_EXCL@;
"""

INSTALL = r"""-- PREPARATION ONLY. Insurance verification authority v1: Manager/Owner-only, audited insurance verification decisions. Single statement.
-- Send only as request-insurance-verification-authority.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one SECURITY INVOKER trigger function + trigger (zz_insurance_decision_guard) on public.driver_screenings, one
-- SECURITY DEFINER setter (public.set_insurance_verification), one audit_log evidence row.
-- Untouched: public.applications (its triggers, ACLs and policies are fingerprinted before and after), every grant and policy,
-- Security 0031, Security S1, the M2 packages, both ledgers, every stored screening value.
DO $rriva$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvediva$@INNER@$approvediva$;
 journal jsonb; receipts integer; p0031 text; apps_before jsonb; apps_after jsonb; scr_before jsonb; scr_after jsonb; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
@COMMON_PRE@
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
 IF pg_catalog.to_regprocedure('@SETTER@') IS NOT NULL OR pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'IVA_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

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
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard'
      AND NOT t.tgisinternal AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgfoid = '@GUARDFN@'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
 apps_after := @FP_APPS@;
 IF apps_after IS DISTINCT FROM apps_before THEN RAISE EXCEPTION 'POST_APPLICATIONS_CHANGED'; END IF;
 scr_after := @FP_SCR_EXCL@;
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
   'session_executor', session_user, 'inner_sql_sha256', '@INNER_SHA@', 'setter_prosrc_sha256', '@SETTER_SHA@',
   'guard_prosrc_sha256', '@GUARD_SHA@', 'applications_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(apps_before::text, 'UTF8')), 'hex'),
   'policies_0031_md5', p0031, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rriva$;
"""

ROLLBACK = r"""-- PREPARATION ONLY. Rollback of insurance verification authority v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-insurance-verification-authority.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Removes exactly the trigger, its function and the setter. Screening values and audit rows are kept. The app falls back to
-- its server path (Manager+, audit written first, refusing on audit failure) when the setter is absent.
DO $rrivarb$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedivarb$@INNER@$approvedivarb$;
 journal jsonb; receipts integer; p0031 text; apps_before jsonb; apps_after jsonb; scr_before jsonb; scr_after jsonb; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
@COMMON_PRE@
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1')
 THEN RAISE EXCEPTION 'IVA_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1_rollback')
 THEN RAISE EXCEPTION 'IVA_ROLLBACK_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('@SETTER@') IS NULL OR pg_catalog.to_regprocedure('@GUARDFN@') IS NULL
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'IVA_PARTIAL_STATE'; END IF;
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = '@SETTER@'::pg_catalog.regprocedure) IS DISTINCT FROM '@SETTER_SHA@'
 THEN RAISE EXCEPTION 'IVA_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF pg_catalog.to_regprocedure('@SETTER@') IS NOT NULL OR pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard')
 THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
 apps_after := @FP_APPS@;
 IF apps_after IS DISTINCT FROM apps_before THEN RAISE EXCEPTION 'POST_APPLICATIONS_CHANGED'; END IF;
 scr_after := @FP_SCR_EXCL@;
 IF scr_after IS DISTINCT FROM scr_before THEN RAISE EXCEPTION 'POST_SCREENINGS_UNEXPECTED_CHANGE'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', 'insurance_verification_authority_v1_rollback',
  'Insurance verification authority v1 removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'insurance-verification-authority v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', '@INNER_SHA@', 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrivarb$;
"""

VERIFY = r"""-- READ-ONLY. Insurance verification authority v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true.
WITH c AS (
 SELECT
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@SETTER_SHA@'
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('@SETTER@')) AS setter,
  (SELECT (NOT p.prosecdef AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@GUARD_SHA@'
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('@GUARDFN@')) AS guard,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard' AND t.tgtype = 23 AND t.tgenabled = 'O')::text AS trigger_rows,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.applications'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard')::text AS no_trigger_on_applications,
  (SELECT metadata->>'applications_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1') AS evidence_apps_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(@FP_APPS@::text, 'UTF8')), 'hex') AS apps_fp,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1')::text AS evidence_rows,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE action IN ('insurance.verified','insurance.verification_revoked'))::text AS decisions,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('setter.definition_and_acl', 'true', setter),
 ('guard.definition_and_no_api_execute', 'true', guard),
 ('guard.trigger_on_driver_screenings', '1', trigger_rows),
 ('applications.no_new_trigger', '0', no_trigger_on_applications),
 ('applications.fingerprint_unchanged_since_install (S1/M2 may change it later)', evidence_apps_fp, apps_fp),
 ('evidence.one_row', '1', evidence_rows),
 ('decisions.audited (informational)', '*', decisions),
 ('security_0031.policies_md5', '@P0031@', p0031)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

PREFLIGHT = r"""-- READ-ONLY. Insurance verification authority v1 preflight. One SELECT; names, counts, flags and md5 hashes only. No customer data.
-- Submit the request only if every row has ok = true. Informational rows record S1 / M2 / activation-package state.
WITH c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database, current_user::text AS executor,
  (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) AS journal23_md5,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  (pg_catalog.to_regprocedure('private.is_manager()') IS NOT NULL AND pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text AS helpers,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE 'insurance_verification_authority_v1%')::text AS evidence_rows,
  (pg_catalog.to_regprocedure('@SETTER@') IS NULL AND pg_catalog.to_regprocedure('@GUARDFN@') IS NULL
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND tgname = 'zz_insurance_decision_guard'))::text AS objects_absent,
  (SELECT pg_catalog.string_agg(t.tgname, ',' ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND NOT t.tgisinternal) AS screening_triggers,
  (pg_catalog.to_regprocedure('private.application_write_guard()') IS NOT NULL)::text AS s1_installed,
  (pg_catalog.to_regprocedure('private.approval_serialize()') IS NOT NULL)::text AS m2_window2_installed,
  (pg_catalog.to_regprocedure('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)') IS NOT NULL)::text AS activation_package_installed
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('target.system_identifier', '7642734024280108049', system_identifier),
 ('target.database', 'postgres', database),
 ('target.executor', 'postgres', executor),
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5),
 ('security_0031.policies_md5', '@P0031@', p0031),
 ('helpers.is_manager_and_auth_uid', 'true', helpers),
 ('audit_log.insert_for_executor', 'true', audit_insert),
 ('evidence.none_yet', '0', evidence_rows),
 ('objects.absent', 'true', objects_absent),
 ('driver_screenings.triggers', 'driver_screenings_active_renter_guard,driver_screenings_pipeline,driver_screenings_set_updated_at', screening_triggers),
 ('security_s1.installed (informational)', '*', s1_installed),
 ('m2_window2.installed (informational)', '*', m2_window2_installed),
 ('activation_insurance_setting.installed (informational)', '*', activation_package_installed)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

def bodies(inner):
    out = {}
    for tag, name in (("ivguardfn", "guard"), ("ivsetfn", "setter")):
        m = re.search(r"\$%s\$(.*?)\$%s\$" % (tag, tag), inner, re.S)
        out[name] = sha(m.group(1))
    return out

def fill(t, inner, inner_sha, b, rollback=False):
    t = t.replace("@COMMON_PRE@", COMMON_PRE.strip("\n"))
    t = t.replace("@P0031_CHECK@", "IF p0031 IS DISTINCT FROM '@P0031@'" + (" AND p0031 IS NOT NULL" if rollback else "") + " THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;")
    t = t.replace("@FP_APPS@", fp("public.applications")).replace("@FP_SCR_EXCL@", fp("public.driver_screenings", excl=True))
    for k, v in {"@PROFILE@": PROFILE, "@JOURNAL23@": JOURNAL23, "@P0031@": P0031, "@SETTER@": SETTER, "@GUARDFN@": GUARDFN,
                 "@INNER_SHA@": inner_sha, "@SETTER_SHA@": b["setter"], "@GUARD_SHA@": b["guard"]}.items():
        t = t.replace(k, v)
    return t.replace("@INNER@", inner)

def main():
    check = "--check" in sys.argv
    inner = open(os.path.join(HERE, "inner.sql")).read()
    rb_inner = open(os.path.join(HERE, "rollback-inner.sql")).read()
    b = bodies(inner)
    outs = {
        "insurance_verification_authority_v1.sql": fill(INSTALL, inner, sha(inner), b),
        "rollback.sql": fill(ROLLBACK, rb_inner, sha(rb_inner), b, rollback=True),
        "verify-after-readonly.sql": fill(VERIFY, "", "", b),
        "preflight-readonly.sql": fill(PREFLIGHT, "", "", b),
    }
    for name, text in outs.items():
        assert all(ord(c) < 128 for c in text), name + " must be ASCII"
        assert not re.search(r"@[A-Z0-9_]+@", text), name + " has an unfilled placeholder"
    tmp = {name: text.encode() for name, text in outs.items()}
    for name, req in (("insurance_verification_authority_v1.sql", "request-insurance-verification-authority.sql"),
                      ("rollback.sql", "request-rollback-insurance-verification-authority.sql")):
        p = os.path.join(PKG, ".build-" + name)
        open(p, "wb").write(tmp[name])
        guard = subprocess.check_output([sys.executable, GUARD, p])
        os.unlink(p)
        tmp[req] = guard + tmp[name]
    tmp["build-meta.json"] = (json.dumps({"inner_sql_sha256": sha(inner), "rollback_inner_sql_sha256": sha(rb_inner), "prosrc_sha256": b}, indent=2, sort_keys=True) + "\n").encode()
    bad = []
    for name, data in tmp.items():
        p = os.path.join(PKG, name)
        if check:
            if not os.path.exists(p) or open(p, "rb").read() != data: bad.append(name)
        else:
            open(p, "wb").write(data)
    if check:
        if bad: print("MISMATCH: " + ", ".join(bad)); sys.exit(1)
        print("all generated files reproduce byte for byte")
    else:
        for name in sorted(tmp): print(sha(tmp[name]), name, len(tmp[name]))

if __name__ == "__main__":
    main()
