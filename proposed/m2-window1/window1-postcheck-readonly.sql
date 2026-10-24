-- READ-ONLY. Window 1 post-check (after steps 1-2, the hash-only publish, the backfill and the gate report).
-- One SELECT; counts, flags and md5 hashes only. Expected values are in docs/release/M2-WINDOW1-RUNBOOK.md.
SELECT jsonb_build_object(
 'at', now(),
 'policies_0031', (SELECT jsonb_build_array(count(*), md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)))
     FROM pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')),
 'policies_total', (SELECT count(*) FROM pg_policies),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 -- Window 1 installed, Window 2 not: the approval path is still the legacy one.
 'step2_recorder_present', to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz,uuid)') IS NOT NULL,
 'approval_rpc_absent', to_regprocedure('public.approve_application_checked(uuid,integer,uuid,text)') IS NULL,
 'approval_version_column_absent', NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.applications'::regclass AND attname = 'approval_evidence_version' AND NOT attisdropped),
 'approval_boundary_trigger_absent', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.applications'::regclass AND tgname = 'approval_boundary'),
 -- Hash coverage: every current licence document in scope is hashed and bound.
 'licence_docs_in_scope', (SELECT count(*) FROM public.documents d WHERE d.is_current IS TRUE AND d.category IN ('license_front','license_back')
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)),
 'licence_docs_unhashed', (SELECT count(*) FROM public.documents d WHERE d.is_current IS TRUE AND d.category IN ('license_front','license_back')
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL) AND d.content_sha256 IS NULL),
 'licence_docs_hash_without_binding', (SELECT count(*) FROM public.documents d WHERE d.is_current IS TRUE AND d.category IN ('license_front','license_back') AND d.content_sha256 IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM private.uploaded_content_sha b WHERE b.bucket_id = d.storage_bucket AND b.name = d.storage_path AND b.sha256 = d.content_sha256)),
 'bindings', (SELECT count(*) FROM private.uploaded_content_sha),
 -- Uploads since the hash-only publish: any document of any category created in the last 24 hours without a hash.
 'recent_uploads_24h', (SELECT count(*) FROM public.documents WHERE created_at > now() - interval '24 hours'),
 'recent_uploads_24h_unhashed', (SELECT count(*) FROM public.documents WHERE created_at > now() - interval '24 hours' AND content_sha256 IS NULL),
 'approval_audit_rows', (SELECT count(*) FROM public.audit_log WHERE action = 'application.approved'),
 'executor_role_present', to_regrole('rr_approval_executor') IS NOT NULL,
 'transaction_read_only', current_setting('transaction_read_only')
) AS window1_postcheck;
