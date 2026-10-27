-- READ-ONLY. Payments write guard v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true. Catalog checks only: it does not
-- attempt a write (the refusals themselves are proven by scripts/payments-write-guard.db.test.mjs).
WITH c AS (
 SELECT
  (SELECT (NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'ae7accbdb2fd34bd8bf683ed3b06f13f369899ac9c0b458f3abacfd50a62a84b'
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('private.payments_write_guard()')) AS guard,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND t.tgname = 'zz_payments_write_guard' AND t.tgtype = 23 AND t.tgenabled = 'O')::text AS trigger_rows,
  (SELECT metadata->>'payments_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1') AS evidence_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgname <> 'zz_payments_write_guard'),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.payments'::pg_catalog.regclass)::text, 'UTF8')), 'hex') AS payments_fp,
  (SELECT metadata->>'payment_rows' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1') AS evidence_rows_at_install,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'payments_write_guard_v1')::text AS evidence_rows,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('guard.definition_and_no_api_execute', 'true', guard),
 ('guard.before_insert_update_row_trigger_on_payments', '1', trigger_rows),
 ('payments.fingerprint_unchanged_since_install', evidence_fp, payments_fp),
 ('payments.rows_at_install (informational)', '*', evidence_rows_at_install),
 ('evidence.one_row', '1', evidence_rows),
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031)
) v(check_name, expected, actual)
ORDER BY check_name;
