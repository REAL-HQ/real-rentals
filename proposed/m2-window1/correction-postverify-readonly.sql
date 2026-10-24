-- READ-ONLY. Post-verification for request-mark-missing-licence-docs.sql. One SELECT; counts, flags and
-- md5 hashes only. Corrected set C = documents named by the correction's audit rows.
WITH c AS (
  SELECT d.* FROM public.documents d
  WHERE d.id::text IN (SELECT l.entity_id FROM public.audit_log l WHERE l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1')
), ca AS (SELECT a.* FROM public.applications a WHERE a.id IN (SELECT driver_id FROM c))
SELECT jsonb_build_object(
 'at', now(),
 'correction_audit_rows', (SELECT count(*) FROM public.audit_log l WHERE l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1'),
 'correction_audit_rows_well_formed', (SELECT count(*) FROM public.audit_log l WHERE l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1'
      AND l.entity_type = 'document' AND l.metadata ->> 'reason' = 'storage_object_missing' AND l.metadata ->> 'previous_is_current' = 'true'),
 'corrected_documents', (SELECT count(*) FROM c),
 'corrected_not_current', (SELECT count(*) FROM c WHERE is_current IS FALSE),
 'corrected_ids_md5', (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM c),
 'corrected_rows_md5_excl_current_updated', (SELECT md5(string_agg((to_jsonb(c) - 'is_current' - 'updated_at')::text, E'\n' ORDER BY id)) FROM c),
 'applications', (SELECT count(*) FROM ca),
 'applications_closed_unqualified', (SELECT count(*) FROM ca WHERE status = 'closed' AND contact_status = 'unqualified' AND deleted_at IS NULL),
 'applications_md5', (SELECT md5(string_agg(to_jsonb(ca)::text, E'\n' ORDER BY id)) FROM ca),
 'missing_object_current_licence_in_scope', (SELECT count(*) FROM public.documents d
      WHERE d.is_current IS TRUE AND d.category IN ('license_front', 'license_back')
        AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)),
 'others', jsonb_build_object(
   'documents', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(d)::text, E'\n' ORDER BY d.id))) FROM public.documents d WHERE d.id NOT IN (SELECT id FROM c)),
   'applications', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(a)::text, E'\n' ORDER BY a.id))) FROM public.applications a),
   'agreements', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(g)::text, E'\n' ORDER BY g.id))) FROM public.agreements g),
   'rentals', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(r)::text, E'\n' ORDER BY r.id))) FROM public.rentals r),
   'payments', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(p)::text, E'\n' ORDER BY p.id))) FROM public.payments p),
   'identity_reviews', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(v)::text, E'\n' ORDER BY v.id))) FROM public.application_identity_reviews v),
   'audit_log', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(l)::text, E'\n' ORDER BY l.id))) FROM public.audit_log l WHERE NOT (l.action = 'document.marked_not_current' AND l.metadata ->> 'correction' = 'm2-window1-missing-licence-v1')),
   'storage_objects', (SELECT jsonb_build_array(count(*), md5(string_agg(to_jsonb(o)::text, E'\n' ORDER BY o.id))) FROM storage.objects o)),
 'documents_total', (SELECT count(*) FROM public.documents),
 'recent_activity_15min', jsonb_build_object(
   'documents', (SELECT count(*) FROM public.documents WHERE (updated_at > now() - interval '15 minutes' OR created_at > now() - interval '15 minutes') AND id NOT IN (SELECT id FROM c)),
   'applications', (SELECT count(*) FROM public.applications WHERE updated_at > now() - interval '15 minutes'),
   'audit_log', (SELECT count(*) FROM public.audit_log WHERE created_at > now() - interval '15 minutes' AND NOT (action = 'document.marked_not_current' AND metadata ->> 'correction' = 'm2-window1-missing-licence-v1'))),
 'policies_0031', (SELECT jsonb_build_array(count(*), md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)))
     FROM pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')),
 'policies_total', (SELECT count(*) FROM pg_policies),
 'drizzle_receipts', (SELECT count(*) FROM drizzle.__drizzle_migrations),
 'supabase_receipts', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'transaction_read_only', current_setting('transaction_read_only')
) AS correction_result;
