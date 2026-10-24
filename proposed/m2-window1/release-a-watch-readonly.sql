-- READ-ONLY. Release A publication watch: counts only. Run at publish time and at the end of the
-- 24-hour watch; compare. Observes natural activity, never creates any.
SELECT jsonb_build_object(
 'at', now(),
 'applications', (SELECT count(*) FROM public.applications),
 'approved_applications', (SELECT count(*) FROM public.applications WHERE status = 'approved'),
 'approval_audit_rows', (SELECT count(*) FROM public.audit_log WHERE action = 'application.approved'),
 'approvals_24h', (SELECT count(*) FROM public.audit_log WHERE action = 'application.approved' AND created_at > now() - interval '24 hours'),
 'apps_with_multiple_approvals_24h', (SELECT count(*) FROM (SELECT entity_id FROM public.audit_log WHERE action = 'application.approved' AND created_at > now() - interval '24 hours' GROUP BY entity_id HAVING count(*) > 1) x),
 'documents', (SELECT count(*) FROM public.documents),
 'uploads_24h', (SELECT count(*) FROM public.documents WHERE created_at > now() - interval '24 hours'),
 'uploads_24h_without_object', (SELECT count(*) FROM public.documents d WHERE d.created_at > now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)),
 'storage_objects', (SELECT count(*) FROM storage.objects),
 'audit_rows_24h', (SELECT count(*) FROM public.audit_log WHERE created_at > now() - interval '24 hours'),
 'policies_0031', (SELECT jsonb_build_array(count(*), md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)))
     FROM pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')),
 'policies_total', (SELECT count(*) FROM pg_policies),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'm2_step2_present', to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz,uuid)') IS NOT NULL,
 'transaction_read_only', current_setting('transaction_read_only')
) AS release_a_watch;
