-- Paper Agreements v1. PROPOSED ONLY. Do not execute.
-- Not a drizzle or supabase migration, so neither the app build nor Lovable's
-- drizzle journal will apply it. Owner approval is required before any install.
--
-- Does not alter purge_application, soft_delete_application, deletion_file_jobs
-- writers, eSign archive, or auth.users. Staff-account deletion is not blocked
-- here (no PAPER_AUDIT_ACTOR_RETENTION_HOLD trigger).
--
-- Registration, notes and cancellation are one transaction each, called as the
-- signed-in user. private.is_manager() is the gate. The browser cannot insert
-- the operation row or the audit row.

CREATE TABLE public.paper_upload_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path = 'paper/' || driver_id::text || '/' || operation_id::text || '.pdf'),
  file_name text NOT NULL,
  agreement_type text NOT NULL CHECK (agreement_type IN ('original', 'addendum', 'extension')),
  signed_on date,
  initial_note text CHECK (initial_note IS NULL OR length(initial_note) <= 1000),
  state text NOT NULL DEFAULT 'verified'
    CHECK (state IN ('verified', 'registered', 'duplicate', 'cancelled')),
  result_document_id uuid REFERENCES public.documents(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.paper_upload_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_upload_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.paper_upload_operations TO service_role;

-- Paper rows stay Manager-only. Existing documents have a different source, so
-- this restrictive policy does not change their staff access.
CREATE POLICY "Paper agreement rows are manager-only"
  ON public.documents
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (source IS DISTINCT FROM 'paper' OR private.is_manager())
  WITH CHECK (source IS DISTINCT FROM 'paper' OR private.is_manager());

-- One paper original per driver and byte hash. Non-paper documents are untouched.
CREATE UNIQUE INDEX paper_agreement_sha_per_driver
  ON public.documents (driver_id, content_sha256)
  WHERE source = 'paper' AND category = 'agreement' AND content_sha256 IS NOT NULL;

-- Browser sessions cannot read or write the paper/ prefix. Service-role uploads
-- used by the server are not in the authenticated role. Other rental-agreements
-- objects, including eSign archives, stay on their current policies.
CREATE POLICY "No direct paper original storage"
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (bucket_id <> 'rental-agreements' OR name NOT LIKE 'paper/%')
  WITH CHECK (bucket_id <> 'rental-agreements' OR name NOT LIKE 'paper/%');

CREATE FUNCTION public.register_paper_agreement(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  op public.paper_upload_operations%ROWTYPE;
  actor uuid := auth.uid();
  actor_role text;
  actor_email text;
  existing uuid;
  doc_id uuid;
BEGIN
  IF actor IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO op FROM public.paper_upload_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paper operation unavailable'; END IF;
  IF op.actor_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF op.state = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'cancelled', 'operation_id', op.operation_id);
  END IF;
  IF op.state IN ('registered', 'duplicate') THEN
    RETURN jsonb_build_object(
      'status', op.state,
      'operation_id', op.operation_id,
      'document_id', op.result_document_id,
      'recovered', true
    );
  END IF;

  SELECT d.id INTO existing
  FROM public.documents d
  WHERE d.driver_id = op.driver_id
    AND d.source = 'paper'
    AND d.category = 'agreement'
    AND d.content_sha256 = op.sha256
  LIMIT 1;
  IF existing IS NOT NULL THEN
    UPDATE public.paper_upload_operations
      SET state = 'duplicate', result_document_id = existing
      WHERE operation_id = op.operation_id;
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'operation_id', op.operation_id,
      'document_id', existing,
      'recovered', false
    );
  END IF;

  SELECT role::text INTO actor_role FROM public.user_roles
    WHERE user_id = actor AND role::text IN ('admin', 'team')
    ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END
    LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO actor_email FROM auth.users WHERE id = actor;

  INSERT INTO public.documents (
    driver_id, kind, category, label, storage_bucket, storage_path, visibility,
    file_name, mime_type, size_bytes, content_sha256, source, uploaded_by, uploaded_by_role, notes
  ) VALUES (
    op.driver_id, 'rental_agreement', 'agreement', op.file_name, 'rental-agreements', op.storage_path,
    ARRAY['admin']::text[], op.file_name, 'application/pdf', op.size_bytes, op.sha256, 'paper',
    actor, actor_role, NULL
  ) RETURNING id INTO doc_id;

  INSERT INTO public.audit_log (
    actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata
  ) VALUES (
    actor, actor_email, actor_role, 'paper_agreement.uploaded', 'document', doc_id::text,
    'Uploaded a paper agreement original',
    jsonb_build_object(
      'type', op.agreement_type,
      'signed_on', op.signed_on,
      'sha256', op.sha256,
      'application_id', op.driver_id,
      'internal_note', op.initial_note
    )
  );

  UPDATE public.paper_upload_operations
    SET state = 'registered', result_document_id = doc_id
    WHERE operation_id = op.operation_id;
  RETURN jsonb_build_object(
    'status', 'registered',
    'operation_id', op.operation_id,
    'document_id', doc_id,
    'recovered', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_paper_agreement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_paper_agreement(uuid) TO authenticated;

CREATE FUNCTION public.set_paper_agreement_note(
  p_document_id uuid,
  p_operation_id uuid,
  p_expected_revision integer,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  actor_email text;
  doc public.documents%ROWTYPE;
  prior jsonb;
  current_rev integer;
  next_rev integer;
BEGIN
  IF actor IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 1000 THEN
    RAISE EXCEPTION 'Note update refused';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Note update refused';
  END IF;

  SELECT metadata INTO prior
  FROM public.audit_log
  WHERE action = 'paper_agreement.note_updated'
    AND entity_type = 'document'
    AND entity_id = p_document_id::text
    AND metadata->>'operation_id' = p_operation_id::text
  ORDER BY created_at DESC
  LIMIT 1;
  IF prior IS NOT NULL THEN
    RETURN jsonb_build_object(
      'document_id', p_document_id,
      'operation_id', p_operation_id,
      'revision', (prior->>'revision')::integer,
      'recovered', true
    );
  END IF;

  SELECT * INTO doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND
    OR doc.source IS DISTINCT FROM 'paper'
    OR doc.category IS DISTINCT FROM 'agreement'
    OR doc.storage_bucket IS DISTINCT FROM 'rental-agreements'
    OR doc.driver_id IS NULL THEN
    RAISE EXCEPTION 'Note update refused';
  END IF;

  SELECT COALESCE(MAX((metadata->>'revision')::integer), 0) INTO current_rev
  FROM public.audit_log
  WHERE action = 'paper_agreement.note_updated'
    AND entity_type = 'document'
    AND entity_id = p_document_id::text;
  IF current_rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Note update refused';
  END IF;

  SELECT role::text INTO actor_role FROM public.user_roles
    WHERE user_id = actor AND role::text IN ('admin', 'team')
    ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END
    LIMIT 1;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT email INTO actor_email FROM auth.users WHERE id = actor;
  next_rev := current_rev + 1;

  INSERT INTO public.audit_log (
    actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata
  ) VALUES (
    actor, actor_email, actor_role, 'paper_agreement.note_updated', 'document', p_document_id::text,
    'Updated the internal note on a paper agreement',
    jsonb_build_object(
      'revision', next_rev,
      'note', p_note,
      'application_id', doc.driver_id,
      'operation_id', p_operation_id
    )
  );
  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'operation_id', p_operation_id,
    'revision', next_rev,
    'recovered', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_paper_agreement_note(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_paper_agreement_note(uuid, uuid, integer, text) TO authenticated;

CREATE FUNCTION public.cancel_paper_registration(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  op public.paper_upload_operations%ROWTYPE;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT private.is_manager() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO op FROM public.paper_upload_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR op.actor_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF op.state = 'verified' THEN
    UPDATE public.paper_upload_operations SET state = 'cancelled' WHERE operation_id = op.operation_id;
    op.state := 'cancelled';
  END IF;
  RETURN jsonb_build_object(
    'operation_id', op.operation_id,
    'status', op.state,
    'cleanup_allowed', op.state IS DISTINCT FROM 'registered',
    'document_id', op.result_document_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_paper_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_paper_registration(uuid) TO authenticated;
