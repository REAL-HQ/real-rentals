-- READ-ONLY. Preflight for request-mark-missing-licence-docs.sql. One SELECT; counts, flags, md5 hashes
-- and catalog names only. Target set T = current licence documents in backfill scope whose Storage
-- object does not exist (the correction's own predicate).
WITH t AS (
  SELECT d.* FROM public.documents d
  WHERE d.is_current IS TRUE AND d.category IN ('license_front', 'license_back')
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)
), ta AS (SELECT a.* FROM public.applications a WHERE a.id IN (SELECT driver_id FROM t))
SELECT jsonb_build_object(
 'at', now(),
 'targets', (SELECT count(*) FROM t),
 'target_ids_md5', (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM t),
 'target_rows_md5_excl_current_updated', (SELECT md5(string_agg((to_jsonb(t) - 'is_current' - 'updated_at')::text, E'\n' ORDER BY id)) FROM t),
 'target_categories', (SELECT jsonb_object_agg(category, c) FROM (SELECT category, count(*) c FROM t GROUP BY 1) z),
 'targets_match_investigation', (SELECT bool_and(storage_bucket = 'license-uploads' AND uploaded_by_role = 'staff' AND size_bytes IS NULL AND superseded_by IS NULL
      AND mime_type = 'application/pdf' AND review_status = 'verified' AND (created_at AT TIME ZONE 'UTC')::date BETWEEN DATE '2026-10-04' AND DATE '2026-10-06') FROM t),
 'applications', (SELECT count(*) FROM ta),
 'applications_closed_unqualified', (SELECT count(*) FROM ta WHERE status = 'closed' AND contact_status = 'unqualified' AND deleted_at IS NULL AND legal_hold IS NOT TRUE),
 'applications_rentals', (SELECT count(*) FROM public.rentals r JOIN ta ON r.application_id = ta.id OR (ta.user_id IS NOT NULL AND r.driver_id = ta.user_id)),
 'applications_identity_reviews', (SELECT count(*) FROM public.application_identity_reviews v WHERE v.application_id IN (SELECT id FROM ta)),
 'applications_current_licence_docs', (SELECT count(*) FROM public.documents d WHERE d.driver_id IN (SELECT id FROM ta) AND d.is_current IS TRUE AND d.category IN ('license_front','license_back')),
 'applications_licence_docs_with_object', (SELECT count(*) FROM public.documents d WHERE d.driver_id IN (SELECT id FROM ta) AND d.category IN ('license_front','license_back')
      AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)),
 'applications_doc_requests', (SELECT count(*) FROM ta WHERE doc_request_sent_at IS NOT NULL OR coalesce(requested_docs::text ILIKE '%licen%', false)),
 'applications_md5', (SELECT md5(string_agg(to_jsonb(ta)::text, E'\n' ORDER BY id)) FROM ta),
 'others', jsonb_build_object(
   'documents', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(d)::text, E'\n' ORDER BY d.id))) FROM public.documents d WHERE d.id NOT IN (SELECT id FROM t)),
   'applications', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id))) FROM public.applications a),
   'agreements', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(g)::text, E'\n' ORDER BY g.id))) FROM public.agreements g),
   'rentals', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(r)::text, E'\n' ORDER BY r.id))) FROM public.rentals r),
   'payments', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(p)::text, E'\n' ORDER BY p.id))) FROM public.payments p),
   'identity_reviews', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(v)::text, E'\n' ORDER BY v.id))) FROM public.application_identity_reviews v),
   'audit_log', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(l)::text, E'\n' ORDER BY l.id))) FROM public.audit_log l WHERE NOT (l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1')),
   'storage_objects', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(o)::text, E'\n' ORDER BY o.id))) FROM storage.objects o)),
 'correction_audit_rows', (SELECT count(*) FROM public.audit_log l WHERE l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1'),
 'recent_activity_15min', jsonb_build_object(
   'documents', (SELECT count(*) FROM public.documents WHERE updated_at > now() - interval '15 minutes' OR created_at > now() - interval '15 minutes'),
   'applications', (SELECT count(*) FROM public.applications WHERE updated_at > now() - interval '15 minutes'),
   'audit_log', (SELECT count(*) FROM public.audit_log WHERE created_at > now() - interval '15 minutes')),
 'policies_0031', (SELECT jsonb_build_array(count(*), md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)))
     FROM pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')),
 'policies_total', (SELECT count(*) FROM pg_policies),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'triggers_documents_audit', (SELECT jsonb_agg(c.relname || '.' || t.tgname || ' -> ' || p.proname ORDER BY c.relname, t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.documents'::regclass, 'public.audit_log'::regclass)),
 'audit_log_checks', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND contype = 'c'),
 'transaction_read_only', current_setting('transaction_read_only')
) AS correction_check;
