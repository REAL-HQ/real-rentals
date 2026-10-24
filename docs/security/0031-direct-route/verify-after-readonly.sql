-- READ-ONLY. Run immediately after the 0031 direct submission returns (success, error or no response).
-- Installed: policy_count 5, evidence_rows 1, drizzle 23, supabase 105, executed_text one row
--   {len 22487, sha 6cf64c7e2802f30a874bb0ed9750bf1c99f78e57d1defb78ceac96de8ff8f8cb}.
-- Not installed: policy_count 0, evidence_rows 0, receipts unchanged. Anything else: stop and report.
SELECT jsonb_build_object(
 'policy_count', (SELECT count(*) FROM pg_policies WHERE policyname = ANY (ARRAY['coordinator_application_containment','coordinator_review_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_agreement_containment'])),
 'policies', (SELECT jsonb_agg(jsonb_build_object('table', schemaname || '.' || tablename, 'policy', policyname, 'permissive', permissive, 'cmd', cmd, 'roles', roles) ORDER BY policyname) FROM pg_policies WHERE policyname LIKE 'coordinator\_%\_containment'),
 'evidence_rows', (SELECT count(*) FROM public.audit_log WHERE action = 'security_migration_verified' AND entity_type = 'database_migration' AND entity_id = '0031_coordinator_containment'),
 'evidence', (SELECT jsonb_build_object('created_at', created_at, 'executor', metadata->>'database_executor', 'session', metadata->>'session_executor', 'txid', metadata->>'transaction_id', 'sql_sha256', metadata->>'original_sql_sha256') FROM public.audit_log WHERE action = 'security_migration_verified' AND entity_id = '0031_coordinator_containment'),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 -- The database's own record of the statement text it executed (pg_stat_statements omits the final ';' and newline).
 'executed_text', (SELECT jsonb_agg(jsonb_build_object('len', octet_length(query), 'sha', encode(sha256(convert_to(query, 'UTF8')), 'hex'), 'calls', calls)) FROM pg_stat_statements WHERE query LIKE '-- PREPARATION ONLY. Single statement;%')
) AS after_0031;
