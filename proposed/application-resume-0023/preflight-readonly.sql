SET TRANSACTION READ ONLY;
-- READ-ONLY. Drizzle 0023 application resume preflight. One SELECT; names, counts, flags and md5 hashes only. No applicant data.
-- Submit the request only if every row has ok = true.
WITH c AS (
 SELECT
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
  pg_catalog.current_database()::text AS database, current_user::text AS executor,
  (SELECT pg_catalog.md5((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j)::text)) AS journal23_md5,
  (SELECT pg_catalog.count(*) FROM drizzle.__drizzle_migrations)::text AS receipts,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname))
    FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')) AS p0031,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.applications'::pg_catalog.regclass AND tgname = 'zz_application_write_guard' AND tgenabled = 'O')::text AS s1_trigger,
  pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT')::text AS audit_insert,
  (pg_catalog.to_regclass('public.applications') IS NOT NULL AND pg_catalog.to_regclass('public.application_resume_tokens') IS NOT NULL
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
        AND attname IN ('actor_user_id','actor_email','actor_role','action','entity_type','entity_id','summary','metadata','created_at')) = 9)::text AS deps,
  (pg_catalog.to_regclass('public.application_recovery_attempts') IS NULL AND pg_catalog.to_regprocedure('public.reserve_application_recovery(uuid, text)') IS NULL
   AND pg_catalog.to_regprocedure('public.finish_application_recovery(uuid, text, text)') IS NULL AND pg_catalog.to_regprocedure('public.resolve_application_identity_review(uuid, text, text)') IS NULL)::text AS absent,
  (SELECT pg_catalog.count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE 'application_resume_0023_v1%')::text AS evidence_rows,
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
 ('drizzle.first_23_receipts_md5', '5cfa7e88ccac860637339bd9bdaab72c', journal23_md5),
 ('drizzle.receipts', '23', receipts),
 ('security_0031.policies_md5', 'd33877618a9f40924d14e49b6653d7fa', p0031),
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
