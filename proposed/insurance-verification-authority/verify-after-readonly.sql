-- READ-ONLY. Insurance verification authority v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true.
WITH c AS (
 SELECT
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = 'f8c7e72c1fbfa53134b22e10cc6805127b16af7451877f704978736f695fd9f0'
     AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.set_insurance_verification(uuid, boolean, text)')) AS setter,
  (SELECT (NOT p.prosecdef AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '6f16d1876d9765962b4b3f2d4c409a59db0620a656d0a92534443bbfe084b080'
     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('private.insurance_decision_guard()')) AS guard,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.driver_screenings'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard' AND t.tgtype = 23 AND t.tgenabled = 'O')::text AS trigger_rows,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.applications'::pg_catalog.regclass AND t.tgname = 'zz_insurance_decision_guard')::text AS no_trigger_on_applications,
  (SELECT metadata->>'applications_fingerprint_sha256' FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'insurance_verification_authority_v1') AS evidence_apps_fp,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT pg_catalog.jsonb_build_object('owner', pg_catalog.pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'relacl', c.relacl::text,
   'columns', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
   'triggers', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(t.tgname, pn.nspname, p.proname, t.tgtype, t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
   'policies', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = c.oid))
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.applications'::pg_catalog.regclass)::text, 'UTF8')), 'hex') AS apps_fp,
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
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031)
) v(check_name, expected, actual)
ORDER BY check_name;
