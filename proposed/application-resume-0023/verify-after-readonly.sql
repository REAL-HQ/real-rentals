SET TRANSACTION READ ONLY;
-- READ-ONLY. Drizzle 0023 application resume verify-after. One SELECT; names, flags, hashes and counts only.
-- Run after the request commits. Every row must have ok = true. Catalog checks only; behaviour is proven by the local test.
WITH c AS (
 SELECT
  (
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
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.application_recovery_attempts'::pg_catalog.regclass AND NOT tgisinternal) = 0)::text AS objects,
  (SELECT metadata->>'existing_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'application_resume_0023_v1') AS evidence_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT pg_catalog.jsonb_build_object('applications', (SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
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
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.audit_log'::pg_catalog.regclass)))::text, 'UTF8')), 'hex') AS current_fp,
  (SELECT metadata->>'backfilled_attempts' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'application_resume_0023_v1') AS backfilled,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'application_resume_0023_v1')::text AS evidence_rows,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.applications'::pg_catalog.regclass AND tgname = 'zz_application_write_guard' AND tgenabled = 'O')::text AS s1_trigger,
  (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations)::text AS receipts
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('0023.objects_definition_and_grants', 'true', objects),
 ('existing_tables.fingerprint_unchanged_since_install (applications, tokens, reviews, payments, audit_log)', evidence_fp, current_fp),
 ('attempts.backfilled_at_install (informational)', '*', backfilled),
 ('evidence.one_row', '1', evidence_rows),
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
 ('s1.application_write_guard_trigger', '1', s1_trigger),
 ('drizzle.receipts_unchanged', '23', receipts)
) v(check_name, expected, actual)
ORDER BY check_name;
