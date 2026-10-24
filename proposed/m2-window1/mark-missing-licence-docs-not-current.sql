-- RR Window 1 correction v1: the 4 current licence documents with no stored object become not current.
-- PROPOSED. Not executed. Production use needs separate owner approval (customer-data modification).
-- Submitted only as request-mark-missing-licence-docs.sql (guard v3 + these exact bytes).
--
-- What it changes: documents.is_current true -> false on exactly the 4 rows the 2026-10-24 read-only
-- investigation found (proposed/m2-window1/README.md), plus one audit_log row per document.
-- documents_set_updated_at stamps updated_at. Nothing is deleted. No path, file, hash, application,
-- agreement, rental, identity review, payment, Storage object or policy changes.
-- Why it is legitimate: the backfill and its gate already exclude non-current documents. A row that
-- names a file that does not exist is not a current licence. Approval stays closed for both
-- applications until a new licence is uploaded: step 3 requires exactly one current front and back
-- with verified bytes, and refuses with license_documents_ambiguous_or_missing.
-- Every precondition below must still hold at execution time, or nothing changes.
DO $rrfix$
DECLARE
  ids uuid[];
  apps uuid[];
  n integer;
BEGIN
  -- Lock the candidates so a concurrent re-upload (which supersedes them) waits or wins cleanly.
  PERFORM 1 FROM public.documents d
  WHERE d.is_current IS TRUE AND d.category IN ('license_front', 'license_back')
  FOR UPDATE;

  SELECT array_agg(d.id ORDER BY d.id), array_agg(DISTINCT d.driver_id)
    INTO ids, apps
  FROM public.documents d
  WHERE d.is_current IS TRUE
    AND d.category IN ('license_front', 'license_back')
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path);

  IF coalesce(array_length(ids, 1), 0) <> 4 THEN
    RAISE EXCEPTION 'RRFIX_TARGET_COUNT: expected 4 missing-object licence documents, found %', coalesce(array_length(ids, 1), 0);
  END IF;
  IF array_length(apps, 1) <> 2 THEN
    RAISE EXCEPTION 'RRFIX_APPLICATION_COUNT: expected 2 applications, found %', array_length(apps, 1);
  END IF;
  -- The documents are exactly as investigated.
  IF EXISTS (
    SELECT 1 FROM public.documents d WHERE d.id = ANY (ids) AND NOT (
      d.storage_bucket = 'license-uploads' AND d.uploaded_by_role = 'staff' AND d.size_bytes IS NULL
      AND d.superseded_by IS NULL AND d.mime_type = 'application/pdf' AND d.review_status = 'verified'
      AND (d.created_at AT TIME ZONE 'UTC')::date BETWEEN DATE '2026-10-04' AND DATE '2026-10-06')
  ) THEN
    RAISE EXCEPTION 'RRFIX_DOCUMENT_STATE_CHANGED';
  END IF;
  -- Each application: closed, not deleted, not on legal hold, exactly these two current licence
  -- documents (one front, one back), no rental, no identity review.
  IF EXISTS (
    SELECT 1 FROM public.applications a WHERE a.id = ANY (apps) AND NOT (
      a.status = 'closed' AND a.deleted_at IS NULL AND a.legal_hold IS NOT TRUE
      AND (SELECT count(*) FROM public.documents d WHERE d.driver_id = a.id AND d.is_current IS TRUE AND d.category = 'license_front' AND d.id = ANY (ids)) = 1
      AND (SELECT count(*) FROM public.documents d WHERE d.driver_id = a.id AND d.is_current IS TRUE AND d.category = 'license_back' AND d.id = ANY (ids)) = 1
      AND (SELECT count(*) FROM public.documents d WHERE d.driver_id = a.id AND d.is_current IS TRUE AND d.category IN ('license_front', 'license_back')) = 2
      AND NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.application_id = a.id OR (a.user_id IS NOT NULL AND r.driver_id = a.user_id))
      AND NOT EXISTS (SELECT 1 FROM public.application_identity_reviews v WHERE v.application_id = a.id))
  ) THEN
    RAISE EXCEPTION 'RRFIX_APPLICATION_STATE_CHANGED';
  END IF;

  UPDATE public.documents SET is_current = false WHERE id = ANY (ids) AND is_current IS TRUE;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'RRFIX_UPDATE_COUNT: %', n; END IF;

  INSERT INTO public.audit_log (actor_role, action, entity_type, entity_id, summary, metadata)
  SELECT 'owner_approved_sql', 'document.marked_not_current', 'document', d.id::text,
         'Licence document marked not current: its Storage object does not exist',
         jsonb_build_object('correction', 'm2-window1-missing-licence-v1', 'reason', 'storage_object_missing',
                            'category', d.category, 'previous_is_current', true)
  FROM public.documents d WHERE d.id = ANY (ids);

  -- Post-condition: no current licence document in backfill scope names a missing object.
  IF EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.is_current IS TRUE AND d.category IN ('license_front', 'license_back')
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path)
  ) THEN
    RAISE EXCEPTION 'RRFIX_POSTCONDITION';
  END IF;
END
$rrfix$;
