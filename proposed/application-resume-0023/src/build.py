#!/usr/bin/env python3
# Builds the application-resume-0023 package from src/inner.sql and src/rollback-inner.sql.
#   python3 -I proposed/application-resume-0023/src/build.py          (writes the files)
#   python3 -I proposed/application-resume-0023/src/build.py --check  (byte-for-byte compare)
# Same structure as proposed/payments-delete-guard and payments-write-guard: one statement (a DO block) each
# for install and rollback; guarded requests are guard v3 (scripts/sql-guard/gen-guard3.py) + the exact bytes.
# inner.sql must stay a byte copy of drizzle/migrations/0023 after its two header lines (checked below).
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(PKG, "..", ".."))
GUARD = os.path.join(ROOT, "scripts", "sql-guard", "gen-guard3.py")
MIGRATION = os.path.join(ROOT, "drizzle", "migrations", "0023_application_resume_atomic_security.sql")
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

PROFILE = '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'
JOURNAL23_MD5 = "5cfa7e88ccac860637339bd9bdaab72c"
P0031 = "d33877618a9f40924d14e49b6653d7fa"
EVIDENCE = "application_resume_0023_v1"
S1_TRIGGER = "zz_application_write_guard"
FNS = ["reserve_application_recovery(uuid, text)", "finish_application_recovery(uuid, text, text)", "resolve_application_identity_review(uuid, text, text)"]

# Catalog fingerprint of a table (owner, RLS, ACL, columns, non-internal triggers, policies). Must be equal before and after.
def FP(rel):
    return r"""(SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = '""" + rel + """'::pg_catalog.regclass)"""

FPS = "pg_catalog.jsonb_build_object('applications', " + FP("public.applications") + ", 'application_resume_tokens', " + FP("public.application_resume_tokens") + \
      ", 'application_identity_reviews', " + FP("public.application_identity_reviews") + ", 'payments', " + FP("public.payments") + ", 'audit_log', " + FP("public.audit_log") + ")"
ROWS = r"""pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.count(*) FROM public.applications), 'application_resume_tokens', (SELECT pg_catalog.count(*) FROM public.application_resume_tokens),
   'application_identity_reviews', (SELECT pg_catalog.count(*) FROM public.application_identity_reviews), 'payments', (SELECT pg_catalog.count(*) FROM public.payments))"""

P0031_SQL = r"""(SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment'))"""
JOURNAL_SQL = r"""(SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text))"""

# Every object 0023 needs that it does not create (names and column shapes only).
DEPS_SQL = r"""(pg_catalog.to_regclass('public.applications') IS NOT NULL AND pg_catalog.to_regclass('public.application_resume_tokens') IS NOT NULL
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
        AND attname IN ('actor_user_id','actor_email','actor_role','action','entity_type','entity_id','summary','metadata','created_at')) = 9)"""
ABSENT_SQL = r"""(pg_catalog.to_regclass('public.application_recovery_attempts') IS NULL AND pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)') IS NULL
   AND pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)') IS NULL AND pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)') IS NULL)"""
S1_SQL = r"""(SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.applications'::pg_catalog.regclass AND tgname = '@S1_TRIGGER@' AND tgenabled = 'O')"""

# Postconditions on what 0023 created: definer functions with empty search_path, exact bodies, exact EXECUTE grants; RLS table with no API access but service_role.
POST_SQL = r"""(
  (SELECT pg_catalog.bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = current_user)
     FROM pg_catalog.pg_proc p WHERE p.oid IN (pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)'), pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)'), pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)')))
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p WHERE p.oid IN (pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)'), pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)'), pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)'))) = 3
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)')) = '@SHA_RESERVE@'
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)')) = '@SHA_FINISH@'
  AND (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)')) = '@SHA_RESOLVE@'
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
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.application_recovery_attempts'::pg_catalog.regclass AND NOT tgisinternal) = 0)"""

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
 PERFORM pg_catalog.set_config('statement_timeout', '60s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310423);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.applications IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.application_resume_tokens IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.application_identity_reviews IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF @JOURNAL_SQL@ IS DISTINCT FROM '@JOURNAL23_MD5@' THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 p0031 := @P0031_SQL@;
 IF p0031 IS DISTINCT FROM '@P0031@' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 IF @S1_SQL@ <> 1 THEN RAISE EXCEPTION 'S1_GUARD_MISSING'; END IF;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 fp_before := @FPS@;
 rows_before := @ROWS@;
"""

COMMON_POST = r"""
 IF @FPS@ IS DISTINCT FROM fp_before THEN RAISE EXCEPTION 'POST_EXISTING_TABLES_CHANGED'; END IF;
 IF @ROWS@ IS DISTINCT FROM rows_before THEN RAISE EXCEPTION 'POST_EXISTING_ROWS_CHANGED'; END IF;
 IF @P0031_SQL@ IS DISTINCT FROM p0031 THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 IF @S1_SQL@ <> 1 THEN RAISE EXCEPTION 'POST_S1_GUARD_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
"""

DECL = r""" receipts integer; p0031 text; fp_before jsonb; rows_before jsonb; n integer; backfilled integer;
 prev_search_path text := pg_catalog.current_setting('search_path');"""

INSTALL = r"""-- PREPARATION ONLY. Drizzle 0023 application resume atomic security v1. Single statement.
-- Send only as request-application-resume-0023.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Creates: table public.application_recovery_attempts (RLS on, no policies, service_role only) with up to 24h of backfilled
-- recorded sends; definer functions reserve_application_recovery, finish_application_recovery (service_role only) and
-- resolve_application_identity_review (authenticated; manager-checked inside); one audit_log evidence row.
-- Untouched (fingerprinted before and after): applications, application_resume_tokens, application_identity_reviews,
-- payments and audit_log catalog shape and row counts (audit_log gains only the evidence row), Security 0031, S1, both ledgers.
DO $rrar23$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedar23$@INNER@$approvedar23$;
@DECL@
BEGIN
@COMMON_PRE@
 IF NOT @DEPS_SQL@ THEN RAISE EXCEPTION 'AR23_DEPENDENCY_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE '@EVIDENCE@%') THEN
  RAISE EXCEPTION 'AR23_EVIDENCE_REPLAY'; END IF;
 IF NOT @ABSENT_SQL@ THEN RAISE EXCEPTION 'AR23_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF @POST_SQL@ IS NOT TRUE THEN RAISE EXCEPTION 'POST_0023_OBJECTS_MISMATCH'; END IF;
 SELECT pg_catalog.count(*) INTO backfilled FROM public.application_recovery_attempts;
 IF EXISTS (SELECT 1 FROM public.application_recovery_attempts WHERE status <> 'sent' OR token_id IS NOT NULL OR provider_id IS NOT NULL)
 THEN RAISE EXCEPTION 'POST_BACKFILL_SHAPE'; END IF;
@COMMON_POST@
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', '@EVIDENCE@',
  'Drizzle 0023 application resume atomic security postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'application-resume-0023 v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', '@INNER_SHA@',
   'prosrc_sha256', pg_catalog.jsonb_build_object('reserve', '@SHA_RESERVE@', 'finish', '@SHA_FINISH@', 'resolve', '@SHA_RESOLVE@'),
   'existing_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(fp_before::text, 'UTF8')), 'hex'),
   'row_counts', rows_before, 'backfilled_attempts', backfilled, 'policies_0031_md5', p0031, 'drizzle_receipts', receipts,
   'drizzle_receipt_written', false),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrar23$;
"""

ROLLBACK = r"""-- PREPARATION ONLY. Rollback of Drizzle 0023 application resume atomic security v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-application-resume-0023.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Precondition outside the database: APPLICATION_RESUME_ATOMIC_ENABLED is not "true" in the app (the code would call missing RPCs).
-- Removes exactly the three functions and the attempts table (its rows are rate-limit history only). Everything else is kept.
DO $rrar23rb$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedar23rb$@INNER@$approvedar23rb$;
@DECL@
BEGIN
@COMMON_PRE@
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@')
 THEN RAISE EXCEPTION 'AR23_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@_rollback')
 THEN RAISE EXCEPTION 'AR23_ROLLBACK_REPLAY'; END IF;
 IF @POST_SQL@ IS NOT TRUE THEN RAISE EXCEPTION 'AR23_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.refobjid = 'public.application_recovery_attempts'::pg_catalog.regclass AND d.deptype = 'n'
            AND d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE confrelid = 'public.application_recovery_attempts'::pg_catalog.regclass)
 THEN RAISE EXCEPTION 'AR23_DEPENDENTS_EXIST'; END IF;
 SELECT pg_catalog.count(*) INTO backfilled FROM public.application_recovery_attempts;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF NOT @ABSENT_SQL@ THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
@COMMON_POST@
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', '@EVIDENCE@_rollback',
  'Drizzle 0023 application resume atomic security removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'application-resume-0023 v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', '@INNER_SHA@', 'attempt_rows_dropped', backfilled, 'row_counts', rows_before, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrar23rb$;
"""

PREFLIGHT = r"""SET TRANSACTION READ ONLY;
-- READ-ONLY. Drizzle 0023 application resume preflight. One SELECT; names, counts, flags and md5 hashes only. No applicant data.
-- Submit the request only if every row has ok = true.
WITH c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database, current_user::text AS executor,
  @JOURNAL_SQL@ AS journal23_md5,
  (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations)::text AS receipts,
  @P0031_SQL@ AS p0031,
  @S1_SQL@::text AS s1_trigger,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  @DEPS_SQL@::text AS deps,
  @ABSENT_SQL@::text AS absent,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE '@EVIDENCE@%')::text AS evidence_rows,
  (SELECT pg_catalog.string_agg(r, ',' ORDER BY r) FROM (SELECT DISTINCT role::text AS r FROM public.user_roles) x) AS role_values,
  (SELECT pg_catalog.count(*) FROM public.applications)::text AS application_rows,
  (SELECT pg_catalog.count(*) FROM public.applications WHERE pg_catalog.jsonb_typeof(resubmission_history) = 'array'
     AND resubmission_history::text OPERATOR(pg_catalog.~~) '%link_sent%')::text AS apps_with_link_history,
  (SELECT pg_catalog.count(*) FROM public.application_resume_tokens)::text AS token_rows
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('target.system_identifier', '7642734024280108049', system_identifier),
 ('target.database', 'postgres', database),
 ('target.executor', 'postgres', executor),
 ('drizzle.first_23_receipts_md5', '@JOURNAL23_MD5@', journal23_md5),
 ('drizzle.receipts', '23', receipts),
 ('security_0031.policies_md5', '@P0031@', p0031),
 ('s1.application_write_guard_trigger', '1', s1_trigger),
 ('audit_log.insert_for_executor', 'true', audit_insert),
 ('deps.tables_columns_functions_present', 'true', deps),
 ('objects.0023_absent', 'true', absent),
 ('evidence.none_yet', '0', evidence_rows),
 ('user_roles.values (informational)', '*', role_values),
 ('applications.rows (informational)', '*', application_rows),
 ('applications.with_link_history (informational)', '*', apps_with_link_history),
 ('application_resume_tokens.rows (informational)', '*', token_rows)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

VERIFY = r"""SET TRANSACTION READ ONLY;
-- READ-ONLY. Drizzle 0023 application resume verify-after. One SELECT; names, flags, hashes and counts only.
-- Run after the request commits. Every row must have ok = true. Catalog checks only; behaviour is proven by the local test.
WITH c AS (
 SELECT
  @POST_SQL@::text AS objects,
  (SELECT metadata->>'existing_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@') AS evidence_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT @FPS@)::text, 'UTF8')), 'hex') AS current_fp,
  (SELECT metadata->>'backfilled_attempts' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@') AS backfilled,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@')::text AS evidence_rows,
  @P0031_SQL@ AS p0031,
  @S1_SQL@::text AS s1_trigger,
  (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations)::text AS receipts
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('0023.objects_definition_and_grants', 'true', objects),
 ('existing_tables.fingerprint_unchanged_since_install (applications, tokens, reviews, payments, audit_log)', evidence_fp, current_fp),
 ('attempts.backfilled_at_install (informational)', '*', backfilled),
 ('evidence.one_row', '1', evidence_rows),
 ('security_0031.policies_md5', '@P0031@', p0031),
 ('s1.application_write_guard_trigger', '1', s1_trigger),
 ('drizzle.receipts_unchanged', '23', receipts)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

def bodies(inner):
    out = {}
    for name, body in re.findall(r"CREATE FUNCTION public\.(\w+)\(.*?AS \$\$(.*?)\$\$;", inner, re.S):
        out[name] = sha(body)
    assert set(out) == {"reserve_application_recovery", "finish_application_recovery", "resolve_application_identity_review"}, out
    return out

def fill(t, inner, inner_sha, b):
    for _ in range(3):
        t = t.replace("@COMMON_PRE@", COMMON_PRE.strip("\n")).replace("@COMMON_POST@", COMMON_POST.strip("\n")).replace("@DECL@", DECL)
        t = t.replace("@FPS@", FPS).replace("@ROWS@", ROWS).replace("@P0031_SQL@", P0031_SQL).replace("@JOURNAL_SQL@", JOURNAL_SQL)
        t = t.replace("@DEPS_SQL@", DEPS_SQL).replace("@ABSENT_SQL@", ABSENT_SQL).replace("@S1_SQL@", S1_SQL).replace("@POST_SQL@", POST_SQL)
    for k, v in {"@PROFILE@": PROFILE, "@JOURNAL23_MD5@": JOURNAL23_MD5, "@P0031@": P0031, "@EVIDENCE@": EVIDENCE, "@S1_TRIGGER@": S1_TRIGGER,
                 "@INNER_SHA@": inner_sha, "@SHA_RESERVE@": b["reserve_application_recovery"], "@SHA_FINISH@": b["finish_application_recovery"],
                 "@SHA_RESOLVE@": b["resolve_application_identity_review"]}.items():
        t = t.replace(k, v)
    return t.replace("@INNER@", inner)

def main():
    check = "--check" in sys.argv
    inner = open(os.path.join(HERE, "inner.sql")).read()
    rb_inner = open(os.path.join(HERE, "rollback-inner.sql")).read()
    mig = open(MIGRATION).read()
    assert inner.split("\n", 2)[2] == mig, "inner.sql must be the two header lines + the exact bytes of drizzle 0023"
    b = bodies(inner)
    outs = {
        "application_resume_0023_v1.sql": fill(INSTALL, inner, sha(inner), b),
        "rollback.sql": fill(ROLLBACK, rb_inner, sha(rb_inner), b),
        "verify-after-readonly.sql": fill(VERIFY, "", "", b),
        "preflight-readonly.sql": fill(PREFLIGHT, "", "", b),
    }
    for name, text in outs.items():
        assert all(ord(c) < 128 for c in text), name + " must be ASCII"
        assert not re.search(r"@[A-Z0-9_]+@", text), name + " has an unfilled placeholder"
    tmp = {name: text.encode() for name, text in outs.items()}
    for name, req in (("application_resume_0023_v1.sql", "request-application-resume-0023.sql"),
                      ("rollback.sql", "request-rollback-application-resume-0023.sql")):
        p = os.path.join(PKG, ".build-" + name)
        open(p, "wb").write(tmp[name])
        guard = subprocess.check_output([sys.executable, GUARD, p])
        os.unlink(p)
        tmp[req] = guard + tmp[name]
    tmp["build-meta.json"] = (json.dumps({"inner_sql_sha256": sha(inner), "rollback_inner_sql_sha256": sha(rb_inner), "migration_0023_sha256": sha(mig),
                                          "prosrc_sha256": b}, indent=2, sort_keys=True) + "\n").encode()
    tmp["SHA256SUMS"] = "".join(f"{sha(tmp[n])}  {n}\n" for n in sorted(tmp)).encode()
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
