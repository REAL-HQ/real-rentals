-- READ-ONLY. Activation insurance setting v1 preflight. One SELECT; names, counts, flags, md5 hashes and ACL text only.
-- No customer data. Each row mirrors a refusal gate of activation_insurance_setting_v1.sql; submit the request only if
-- every row has ok = true. Informational rows (ok always true) record M2 / S1 state for the run log.
WITH a AS (
 SELECT 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::text AS activate,
        'public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)'::text AS wrapper,
        'public.set_rental_activation_insurance_exception(boolean)'::text AS setter,
        'private.rental_activation_setting_guard()'::text AS guardfn
), c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database,
  current_user::text AS executor,
  (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) AS journal23_md5,
  (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations)::text AS receipts,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  (pg_catalog.to_regprocedure((SELECT activate FROM a)) IS NOT NULL)::text AS activate_present,
  (SELECT (NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))::text FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure((SELECT activate FROM a))) AS activate_acl_ok,
  (SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure((SELECT activate FROM a))) AS activate_def_md5,
  (SELECT (pg_catalog.pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock(710026,2)%')::text FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure((SELECT activate FROM a))) AS m2_window2_activate,
  (pg_catalog.to_regprocedure('private.application_write_guard()') IS NOT NULL)::text AS s1_installed,
  (SELECT (c.relkind = 'r' AND c.relrowsecurity)::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass) AS app_settings_rls,
  (EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname = 'Admins manage settings' AND po.polpermissive))::text AS app_settings_owner_policy,
  (pg_catalog.to_regprocedure('private.is_owner()') IS NOT NULL AND pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text AS helpers,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute x WHERE NOT x.attisdropped AND x.attnum > 0 AND (
      (x.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND x.attname = 'insurance_verified' AND x.atttypid = 'boolean'::pg_catalog.regtype) OR
      (x.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND x.attname = 'lead_id' AND x.atttypid = 'uuid'::pg_catalog.regtype) OR
      (x.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND x.attname = 'interview_completed_at') OR
      (x.attrelid = 'public.inspections'::pg_catalog.regclass AND x.attname IN ('vehicle_id','inspection_type','status')) OR
      (x.attrelid = 'public.user_roles'::pg_catalog.regclass AND x.attname IN ('user_id','role')) OR
      (x.attrelid = 'public.applications'::pg_catalog.regclass AND x.attname = 'insurance_expires_on' AND x.atttypid = 'date'::pg_catalog.regtype) OR
      (x.attrelid = 'public.documents'::pg_catalog.regclass AND x.attname IN ('driver_id','category','is_current','review_status','expires_at','storage_path','reviewed_at')) OR
      (x.attrelid = 'public.agreements'::pg_catalog.regclass AND x.attname IN ('application_id','source','status','signed_at','voided_at','rental_id')) OR
      (x.attrelid = 'public.audit_log'::pg_catalog.regclass AND x.attname IN ('actor_user_id','actor_role','action','entity_type','entity_id','metadata','ip','user_agent')) OR
      (x.attrelid = 'public.app_settings'::pg_catalog.regclass AND x.attname IN ('key','value'))))::text AS columns,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id IN ('activation_insurance_setting_v1','activation_insurance_setting_v1_rollback'))::text AS evidence_rows,
  (pg_catalog.to_regprocedure((SELECT wrapper FROM a)) IS NULL AND pg_catalog.to_regprocedure((SELECT setter FROM a)) IS NULL AND pg_catalog.to_regprocedure((SELECT guardfn FROM a)) IS NULL
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%'))::text AS objects_absent,
  (NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'rental_activation'))::text AS key_absent
 FROM a
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('target.system_identifier', '7642734024280108049', system_identifier),
 ('target.database', 'postgres', database),
 ('target.executor', 'postgres', executor),
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5),
 ('drizzle.receipts (informational)', '*', receipts),
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
 ('activate_rental_tx.present', 'true', activate_present),
 ('activate_rental_tx.service_role_only', 'true', activate_acl_ok),
 ('activate_rental_tx.def_md5 (informational)', '*', activate_def_md5),
 ('m2_window2.activate_rental_tx_installed (informational)', '*', m2_window2_activate),
 ('security_s1.installed (informational)', '*', s1_installed),
 ('app_settings.rls', 'true', app_settings_rls),
 ('app_settings.owner_policy', 'true', app_settings_owner_policy),
 ('helpers.is_owner_and_auth_uid', 'true', helpers),
 ('columns.read_by_wrapper', '32', columns),
 ('audit_log.insert_for_executor', 'true', audit_insert),
 ('evidence.none_yet', '0', evidence_rows),
 ('objects.absent', 'true', objects_absent),
 ('app_settings.rental_activation_absent', 'true', key_absent)
) v(check_name, expected, actual)
ORDER BY check_name;
