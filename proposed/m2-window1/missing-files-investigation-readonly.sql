-- READ-ONLY. One SELECT. Investigates the current licence documents in backfill scope whose Storage object
-- does not exist. Returns, per document, a label (m1..mN by created_at) and non-sensitive metadata only:
-- statuses, dates (day precision), booleans and counts. No ids, names, emails, paths, file names,
-- licence numbers, hashes or image bytes are returned.
WITH miss AS (
  SELECT d.*, row_number() OVER (ORDER BY d.created_at, d.id) AS n
  FROM public.documents d
  WHERE d.is_current IS TRUE
    AND d.category IN ('license_front', 'license_back')
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)
)
SELECT jsonb_build_object(
 'missing_total', (SELECT count(*) FROM miss),
 'docs', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'label') FROM (
  SELECT jsonb_build_object(
   'label', 'm' || m.n,
   'category', m.category, 'kind', m.kind, 'source', m.source, 'uploaded_by_role', m.uploaded_by_role,
   'review_status', m.review_status, 'mime_type', m.mime_type, 'size_bytes_recorded', m.size_bytes IS NOT NULL,
   'created_on', m.created_at::date, 'updated_on', m.updated_at::date,
   'superseded_by_set', m.superseded_by IS NOT NULL,
   'has_driver', m.driver_id IS NOT NULL, 'has_vehicle_or_partner', (m.vehicle_id IS NOT NULL OR m.partner_id IS NOT NULL),
   'bucket', m.storage_bucket,
   'bucket_exists', EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = m.storage_bucket),
   'path_blank', nullif(btrim(m.storage_path), '') IS NULL,
   'path_leading_slash', m.storage_path LIKE '/%',
   'path_starts_with_bucket', m.storage_path LIKE m.storage_bucket || '/%',
   'path_has_space_or_percent', m.storage_path ~ '[[:space:]%]',
   'path_segments', array_length(string_to_array(m.storage_path, '/'), 1),
   'path_first_segment_is_driver', split_part(m.storage_path, '/', 1) = m.driver_id::text,
   'object_same_name_other_bucket', EXISTS (SELECT 1 FROM storage.objects o WHERE o.name = m.storage_path AND o.bucket_id <> m.storage_bucket),
   'object_case_or_slash_variant', EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = m.storage_bucket
        AND (lower(o.name) = lower(m.storage_path) OR o.name = ltrim(m.storage_path, '/') OR o.name = substr(m.storage_path, length(m.storage_bucket) + 2))),
   'objects_in_same_folder', (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = m.storage_bucket
        AND strpos(m.storage_path, '/') > 0 AND o.name LIKE replace(replace(left(m.storage_path, length(m.storage_path) - strpos(reverse(m.storage_path), '/') + 1), '_', '\_'), '%', '\%') || '%'),
   'same_category_docs_total', (SELECT count(*) FROM public.documents d2 WHERE d2.driver_id = m.driver_id AND d2.category = m.category),
   'same_category_current', (SELECT count(*) FROM public.documents d2 WHERE d2.driver_id = m.driver_id AND d2.category = m.category AND d2.is_current IS TRUE),
   'same_category_newer', (SELECT count(*) FROM public.documents d2 WHERE d2.driver_id = m.driver_id AND d2.category = m.category AND d2.created_at > m.created_at),
   'same_category_with_object', (SELECT count(*) FROM public.documents d2 WHERE d2.driver_id = m.driver_id AND d2.category = m.category AND d2.id <> m.id
        AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d2.storage_bucket AND o.name = d2.storage_path)),
   'other_licence_category_with_object', (SELECT count(*) FROM public.documents d2 WHERE d2.driver_id = m.driver_id AND d2.category IN ('license_front','license_back') AND d2.category <> m.category
        AND d2.is_current IS TRUE AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d2.storage_bucket AND o.name = d2.storage_path)),
   'application_found', a.id IS NOT NULL,
   'application_status', a.status, 'contact_status', a.contact_status, 'current_step', a.current_step,
   'application_created_on', a.created_at::date, 'application_updated_on', a.updated_at::date,
   'application_reviewed', a.reviewed_at IS NOT NULL, 'has_user_account', a.user_id IS NOT NULL,
   'duplicate_of_other', a.primary_application_id IS NOT NULL, 'purged', a.purged_at IS NOT NULL, 'legal_hold', a.legal_hold,
   'licence_expired', (a.license_expiration IS NOT NULL AND a.license_expiration < current_date),
   'legacy_licence_photo_set', nullif(btrim(a.license_photo_url), '') IS NOT NULL,
   'legacy_licence_photo_object_exists', EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'license-uploads' AND o.name = a.license_photo_url),
   'doc_request_sent', a.doc_request_sent_at IS NOT NULL,
   'licence_requested', COALESCE(a.requested_docs::text ILIKE '%licen%', false),
   'rentals_by_status', (SELECT jsonb_object_agg(status, c) FROM (SELECT r.status, count(*) c FROM public.rentals r WHERE r.application_id = m.driver_id OR (a.user_id IS NOT NULL AND r.driver_id = a.user_id) GROUP BY r.status) z),
   'agreements_by_status', (SELECT jsonb_object_agg(coalesce(status, 'null'), c) FROM (SELECT g.status, count(*) c FROM public.agreements g WHERE g.application_id = m.driver_id GROUP BY g.status) z),
   'identity_reviews_by_kind_status', (SELECT jsonb_object_agg(k, c) FROM (SELECT r.kind || ':' || r.status AS k, count(*) c FROM public.application_identity_reviews r WHERE r.application_id = m.driver_id GROUP BY 1) z),
   'doc_audit_actions', (SELECT jsonb_object_agg(action, c) FROM (SELECT l.action, count(*) c FROM public.audit_log l WHERE l.entity_id = m.id::text GROUP BY l.action) z),
   'application_document_audit_actions', (SELECT jsonb_object_agg(action, c) FROM (SELECT l.action, count(*) c FROM public.audit_log l
        WHERE l.entity_id = m.driver_id::text AND (l.action ILIKE '%doc%' OR l.action ILIKE '%licen%' OR l.action ILIKE '%upload%' OR l.action ILIKE '%storage%') GROUP BY l.action) z)
  ) AS x
  FROM miss m LEFT JOIN public.applications a ON a.id = m.driver_id
 ) q), '[]'::jsonb),
 'transaction_read_only', current_setting('transaction_read_only')
) AS missing_licence_files;
