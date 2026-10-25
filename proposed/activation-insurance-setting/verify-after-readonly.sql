-- READ-ONLY. Activation insurance setting v1 verify-after. One SELECT; names, flags, hashes and ACL text only.
-- Run after the request commits. Every row must have ok = true. The setting row is reported, not asserted OFF,
-- because the Owner may have changed it since; setting_changes counts the audited changes.
WITH n AS (
 SELECT pg_catalog.to_regprocedure('public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean)') AS wrapper, pg_catalog.to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') AS setter,
        pg_catalog.to_regprocedure('private.rental_activation_setting_guard()') AS guardfn, pg_catalog.to_regprocedure('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)') AS activate
), c AS (
 SELECT
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '03d5108a342facaf3a052d3f1c83786d588c962e3d49770a48234a493106759a')::text FROM pg_catalog.pg_proc p WHERE p.oid = n.wrapper) AS wrapper_body,
  (SELECT (pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.wrapper) AS wrapper_acl,
  (SELECT (p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '39ff1d560ff33a22c416857840b2c6185e94876699cb0aee26d0301e2095fd97')::text FROM pg_catalog.pg_proc p WHERE p.oid = n.setter) AS setter_body,
  (SELECT (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0))::text FROM pg_catalog.pg_proc p WHERE p.oid = n.setter) AS setter_acl,
  (SELECT (NOT p.prosecdef AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '8723cbdee5c18629f112f0701a5035146ea7937d3e3567b2569c2d2ced73214e'
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
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5)
) v(check_name, expected, actual)
ORDER BY check_name;
