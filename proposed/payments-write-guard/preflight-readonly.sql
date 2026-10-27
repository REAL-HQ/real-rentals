-- READ-ONLY. Payments write guard v1 preflight. One SELECT; names, counts, flags and md5 hashes only. No customer data.
-- Submit the request only if every row has ok = true.
WITH c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database, current_user::text AS executor,
  (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) AS journal23_md5,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  (pg_catalog.to_regnamespace('private') IS NOT NULL)::text AS private_schema,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE 'payments_write_guard_v1%')::text AS evidence_rows,
  (pg_catalog.to_regprocedure('private.payments_write_guard()') IS NULL
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.payments'::pg_catalog.regclass AND tgname = 'zz_payments_write_guard'))::text AS objects_absent,
  (SELECT pg_catalog.string_agg(t.tgname, ',' ORDER BY t.tgname COLLATE "C") FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.payments'::pg_catalog.regclass AND NOT t.tgisinternal) AS payment_triggers,
  (SELECT pg_catalog.string_agg(pg_catalog.concat(con.conname, ':', con.confdeltype), ',' ORDER BY con.conname COLLATE "C") FROM pg_catalog.pg_constraint con WHERE con.conrelid = 'public.payments'::pg_catalog.regclass AND con.contype = 'f') AS payment_fks,
  (SELECT pg_catalog.count(*) FROM public.payments)::text AS payment_rows,
  (SELECT COALESCE(pg_catalog.string_agg(n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname, ',' ORDER BY n.nspname, p.proname), 'none')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE NOT p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND p.prosrc OPERATOR(pg_catalog.~*) '(update|insert[[:space:]]+into)[[:space:]]+(public[.])?payments([^_a-z0-9]|$)') AS invoker_payment_writers
)
SELECT check_name, expected, actual, CASE WHEN expected = '*' THEN true ELSE actual IS NOT DISTINCT FROM expected END AS ok FROM c, LATERAL (VALUES
 ('target.system_identifier', '7642734024280108049', system_identifier),
 ('target.database', 'postgres', database),
 ('target.executor', 'postgres', executor),
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5),
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
 ('audit_log.insert_for_executor', 'true', audit_insert),
 ('private_schema.present', 'true', private_schema),
 ('evidence.none_yet', '0', evidence_rows),
 ('objects.absent', 'true', objects_absent),
 ('payments.triggers (the delete guard may already be installed)', CASE WHEN payment_triggers = 'payments_updated_at,zz_payments_delete_guard' THEN payment_triggers ELSE 'payments_updated_at' END, payment_triggers),
 ('payments.invoker_functions_writing_payments', 'none', invoker_payment_writers),
 ('payments.fks_set_null_only', 'payments_driver_id_fkey:n,payments_rental_id_fkey:n,payments_vehicle_id_fkey:n', payment_fks),
 ('payments.rows (informational)', '*', payment_rows)
) v(check_name, expected, actual)
ORDER BY check_name;
