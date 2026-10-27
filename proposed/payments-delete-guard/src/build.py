#!/usr/bin/env python3
# Builds the payments-delete-guard package from src/inner.sql and src/rollback-inner.sql.
#   python3 proposed/payments-delete-guard/src/build.py          (writes the files)
#   python3 proposed/payments-delete-guard/src/build.py --check  (byte-for-byte compare)
# Same structure as proposed/insurance-verification-authority: one statement (a DO block) each for
# install and rollback; guarded requests are guard v3 (scripts/sql-guard/gen-guard3.py) + the exact bytes.
import hashlib, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(PKG, "..", ".."))
GUARD = os.path.join(ROOT, "scripts", "sql-guard", "gen-guard3.py")
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()

PROFILE = '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'
JOURNAL23_MD5 = "5cfa7e88ccac860637339bd9bdaab72c"
P0031 = "d33877618a9f40924d14e49b6653d7fa"
GUARDFN = "private.payments_delete_guard()"
TRIGGER = "zz_payments_delete_guard"
EVIDENCE = "payments_delete_guard_v1"

# public.payments fingerprint (owner, RLS, ACL, columns, triggers except ours, policies): unchanged by install/rollback.
FP = r"""(SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> '@TRIGGER@'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass)"""

P0031_SQL = r"""(SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment'))"""
JOURNAL_SQL = r"""(SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text))"""

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
 PERFORM pg_catalog.pg_advisory_xact_lock(7310404);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.payments IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 IF @JOURNAL_SQL@ IS DISTINCT FROM '@JOURNAL23_MD5@' THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 p0031 := @P0031_SQL@;
 IF p0031 IS DISTINCT FROM '@P0031@' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 pay_before := @FP@;
 SELECT pg_catalog.count(*) INTO rows_before FROM public.payments;
"""

COMMON_POST = r"""
 pay_after := @FP@;
 IF pay_after IS DISTINCT FROM pay_before THEN RAISE EXCEPTION 'POST_PAYMENTS_UNEXPECTED_CHANGE'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM public.payments;
 IF n IS DISTINCT FROM rows_before THEN RAISE EXCEPTION 'POST_PAYMENT_ROWS_CHANGED'; END IF;
 IF @P0031_SQL@ IS DISTINCT FROM p0031 THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;
"""

DECL = r""" journal_ok boolean; receipts integer; p0031 text; pay_before jsonb; pay_after jsonb; rows_before integer; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');"""

INSTALL = r"""-- PREPARATION ONLY. Payments delete guard v1: refuse DELETE on public.payments from every API role. Single statement.
-- Send only as request-payments-delete-guard.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one SECURITY INVOKER trigger function + one BEFORE DELETE row trigger on public.payments, one audit_log evidence row.
-- Untouched: every payments row, policy, grant and column (fingerprinted before and after), Security 0031, S1, both ledgers.
DO $rrpdg$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedpdg$@INNER@$approvedpdg$;
@DECL@
BEGIN
@COMMON_PRE@
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 IF pg_catalog.to_regnamespace('private') IS NULL THEN RAISE EXCEPTION 'PRIVATE_SCHEMA_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@') THEN
  RAISE EXCEPTION 'PDG_EVIDENCE_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = '@TRIGGER@')
 THEN RAISE EXCEPTION 'PDG_PARTIAL_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF (SELECT NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@GUARD_SHA@'
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = '@GUARDFN@'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_GUARD_FUNCTION_MISMATCH'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND t.tgname = '@TRIGGER@'
      AND NOT t.tgisinternal AND t.tgtype = 11 AND t.tgenabled = 'O' AND t.tgfoid = '@GUARDFN@'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
@COMMON_POST@
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', '@EVIDENCE@',
  'Payments delete guard v1 postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'payments-delete-guard v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', '@INNER_SHA@', 'guard_prosrc_sha256', '@GUARD_SHA@',
   'payments_fingerprint_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pay_before::text, 'UTF8')), 'hex'),
   'payment_rows', rows_before, 'policies_0031_md5', p0031, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrpdg$;
"""

ROLLBACK = r"""-- PREPARATION ONLY. Rollback of payments delete guard v1. Single statement. Separate owner approval required.
-- Send only as request-rollback-payments-delete-guard.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Removes exactly the trigger and its function. Every payments row, policy and grant is kept.
DO $rrpdgrb$
DECLARE
 profile jsonb := '@PROFILE@'::jsonb;
 approved_sql text := $approvedpdgrb$@INNER@$approvedpdgrb$;
@DECL@
BEGIN
@COMMON_PRE@
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@')
 THEN RAISE EXCEPTION 'PDG_NOT_INSTALLED'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@_rollback')
 THEN RAISE EXCEPTION 'PDG_ROLLBACK_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('@GUARDFN@') IS NULL
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = '@TRIGGER@')
 THEN RAISE EXCEPTION 'PDG_PARTIAL_STATE'; END IF;
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc p WHERE p.oid = '@GUARDFN@'::pg_catalog.regprocedure) IS DISTINCT FROM '@GUARD_SHA@'
 THEN RAISE EXCEPTION 'PDG_OBJECTS_CHANGED_SINCE_INSTALL'; END IF;

 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 IF pg_catalog.to_regprocedure('@GUARDFN@') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = '@TRIGGER@')
 THEN RAISE EXCEPTION 'POST_ROLLBACK_INCOMPLETE'; END IF;
@COMMON_POST@
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_rolled_back', 'database_migration', '@EVIDENCE@_rollback',
  'Payments delete guard v1 removed by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'payments-delete-guard v1 rollback',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'inner_sql_sha256', '@INNER_SHA@', 'payment_rows', rows_before, 'drizzle_receipts', receipts),
  pg_catalog.clock_timestamp());
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrpdgrb$;
"""

PREFLIGHT = r"""-- READ-ONLY. Payments delete guard v1 preflight. One SELECT; names, counts, flags and md5 hashes only. No customer data.
-- Submit the request only if every row has ok = true.
WITH c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database, current_user::text AS executor,
  @JOURNAL_SQL@ AS journal23_md5,
  @P0031_SQL@ AS p0031,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  (pg_catalog.to_regnamespace('private') IS NOT NULL)::text AS private_schema,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE '@EVIDENCE@%')::text AS evidence_rows,
  (pg_catalog.to_regprocedure('@GUARDFN@') IS NULL
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = '@TRIGGER@'))::text AS objects_absent,
  (SELECT pg_catalog.string_agg(t.tgname, ',' ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND NOT t.tgisinternal) AS payment_triggers,
  (SELECT pg_catalog.string_agg(pg_catalog.concat(con.conname, ':', con.confdeltype), ',' ORDER BY con.conname COLLATE "C") FROM pg_catalog.pg_constraint con WHERE con.conrelid = 'public.payments'::pg_catalog.regclass AND con.contype = 'f') AS payment_fks,
  (SELECT pg_catalog.count(*) FROM public.payments)::text AS payment_rows
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('target.system_identifier', '7642734024280108049', system_identifier),
 ('target.database', 'postgres', database),
 ('target.executor', 'postgres', executor),
 ('drizzle.first_23_receipts_md5', '@JOURNAL23_MD5@', journal23_md5),
 ('security_0031.policies_md5', '@P0031@', p0031),
 ('audit_log.insert_for_executor', 'true', audit_insert),
 ('private_schema.present', 'true', private_schema),
 ('evidence.none_yet', '0', evidence_rows),
 ('objects.absent', 'true', objects_absent),
 ('payments.triggers', 'payments_updated_at', payment_triggers),
 ('payments.fks_set_null_only', 'payments_driver_id_fkey:n,payments_rental_id_fkey:n,payments_vehicle_id_fkey:n', payment_fks),
 ('payments.rows (informational)', '*', payment_rows)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

VERIFY = r"""-- READ-ONLY. Payments delete guard v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true.
WITH c AS (
 SELECT
  (SELECT (NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '@GUARD_SHA@'
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('@GUARDFN@')) AS guard,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND t.tgname = '@TRIGGER@' AND t.tgtype = 11 AND t.tgenabled = 'O')::text AS trigger_rows,
  (SELECT metadata->>'payments_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@') AS evidence_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(@FP@::text, 'UTF8')), 'hex') AS payments_fp,
  (SELECT metadata->>'payment_rows' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@') AS evidence_rows_at_install,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = '@EVIDENCE@')::text AS evidence_rows,
  @P0031_SQL@ AS p0031
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('guard.definition_and_no_api_execute', 'true', guard),
 ('guard.before_delete_row_trigger_on_payments', '1', trigger_rows),
 ('payments.fingerprint_unchanged_since_install', evidence_fp, payments_fp),
 ('payments.rows_at_install (informational)', '*', evidence_rows_at_install),
 ('evidence.one_row', '1', evidence_rows),
 ('security_0031.policies_md5', '@P0031@', p0031)
) v(check_name, expected, actual)
ORDER BY check_name;
"""

def guard_body(inner):
    m = re.search(r"\$pdgfn\$(.*?)\$pdgfn\$", inner, re.S)
    return sha(m.group(1))

def fill(t, inner, inner_sha, gsha):
    t = t.replace("@COMMON_PRE@", COMMON_PRE.strip("\n")).replace("@COMMON_POST@", COMMON_POST.strip("\n")).replace("@DECL@", DECL)
    t = t.replace("@FP@", FP).replace("@P0031_SQL@", P0031_SQL).replace("@JOURNAL_SQL@", JOURNAL_SQL)
    for k, v in {"@PROFILE@": PROFILE, "@JOURNAL23_MD5@": JOURNAL23_MD5, "@P0031@": P0031, "@GUARDFN@": GUARDFN, "@TRIGGER@": TRIGGER,
                 "@EVIDENCE@": EVIDENCE, "@INNER_SHA@": inner_sha, "@GUARD_SHA@": gsha}.items():
        t = t.replace(k, v)
    return t.replace("@INNER@", inner)

def main():
    check = "--check" in sys.argv
    inner = open(os.path.join(HERE, "inner.sql")).read()
    rb_inner = open(os.path.join(HERE, "rollback-inner.sql")).read()
    gsha = guard_body(inner)
    outs = {
        "payments_delete_guard_v1.sql": fill(INSTALL, inner, sha(inner), gsha),
        "rollback.sql": fill(ROLLBACK, rb_inner, sha(rb_inner), gsha),
        "verify-after-readonly.sql": fill(VERIFY, "", "", gsha),
        "preflight-readonly.sql": fill(PREFLIGHT, "", "", gsha),
    }
    for name, text in outs.items():
        assert all(ord(c) < 128 for c in text), name + " must be ASCII"
        assert not re.search(r"@[A-Z0-9_]+@", text), name + " has an unfilled placeholder"
    tmp = {name: text.encode() for name, text in outs.items()}
    for name, req in (("payments_delete_guard_v1.sql", "request-payments-delete-guard.sql"),
                      ("rollback.sql", "request-rollback-payments-delete-guard.sql")):
        p = os.path.join(PKG, ".build-" + name)
        open(p, "wb").write(tmp[name])
        guard = subprocess.check_output([sys.executable, GUARD, p])
        os.unlink(p)
        tmp[req] = guard + tmp[name]
    tmp["build-meta.json"] = (json.dumps({"inner_sql_sha256": sha(inner), "rollback_inner_sql_sha256": sha(rb_inner), "guard_prosrc_sha256": gsha}, indent=2, sort_keys=True) + "\n").encode()
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
