-- READ-ONLY. Insurance verification authority v1 preflight. One SELECT; names, counts, flags and md5 hashes only. No customer data.
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
  (pg_catalog.to_regprocedure('public.set_insurance_verification(uuid, boolean, text)') IS NULL AND pg_catalog.to_regprocedure('private.insurance_decision_guard()') IS NULL
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
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
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
