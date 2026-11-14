ALTER TABLE public.checklist_evidence_events DROP CONSTRAINT IF EXISTS checklist_evidence_events_field_check;
ALTER TABLE public.checklist_evidence_events ADD CONSTRAINT checklist_evidence_events_field_check
  CHECK (field IN ('license_front', 'license_back', 'insurance', 'agreement', 'gig_profile', 'inspection', 'pickup'));

CREATE OR REPLACE FUNCTION public.record_checklist_evidence(
  _application_id uuid, _field text, _state text, _source text, _note text,
  _expected_revision integer, _idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  role_text text;
  existing public.checklist_evidence_events%ROWTYPE;
  current_rev integer;
  current_id uuid;
  new_id uuid;
  clean_note text := pg_catalog.btrim(COALESCE(_note, ''));
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  SELECT r.role::text INTO role_text FROM public.user_roles r
   WHERE r.user_id = actor AND r.role::text = ANY (ARRAY['admin', 'team'])
   ORDER BY CASE r.role::text WHEN 'admin' THEN 0 ELSE 1 END LIMIT 1;
  IF role_text IS NULL THEN RAISE EXCEPTION 'manager_required' USING ERRCODE = '42501'; END IF;
  IF _field IS NULL OR _field <> ALL (ARRAY['license_front', 'license_back', 'insurance', 'agreement', 'gig_profile', 'inspection', 'pickup']) THEN RAISE EXCEPTION 'invalid_field'; END IF;
  IF _state IS NULL OR _state <> ALL (ARRAY['collected', 'not_collected']) THEN RAISE EXCEPTION 'invalid_state'; END IF;
  IF _state = 'collected' AND (_source IS NULL OR _source <> ALL (ARRAY['email', 'text', 'paper', 'other'])) THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF _state = 'not_collected' AND _source IS NOT NULL THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF pg_catalog.char_length(clean_note) > 1000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  IF _idempotency_key IS NULL OR _expected_revision IS NULL OR _expected_revision < 0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  PERFORM 1 FROM public.applications a WHERE a.id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  SELECT * INTO existing FROM public.checklist_evidence_events e WHERE e.idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF existing.application_id = _application_id AND existing.field = _field AND existing.state = _state THEN
      RETURN pg_catalog.jsonb_build_object('id', existing.id, 'revision', existing.revision, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict';
  END IF;
  SELECT e.revision, e.id INTO current_rev, current_id FROM public.checklist_evidence_events e
   WHERE e.application_id = _application_id AND e.field = _field ORDER BY e.revision DESC LIMIT 1;
  IF COALESCE(current_rev, 0) <> _expected_revision THEN RAISE EXCEPTION 'evidence_changed'; END IF;
  INSERT INTO public.checklist_evidence_events (application_id, field, revision, supersedes_id, state, source, note, actor_id, actor_role, idempotency_key)
  VALUES (_application_id, _field, COALESCE(current_rev, 0) + 1, current_id, _state, CASE WHEN _state = 'collected' THEN _source END, clean_note, actor, role_text, _idempotency_key)
  RETURNING id INTO new_id;
  INSERT INTO public.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (actor, role_text, 'checklist.evidence_recorded', 'application', _application_id::text,
    CASE WHEN _state = 'collected' THEN 'Checked off ' ELSE 'Marked not collected: ' END || _field,
    pg_catalog.jsonb_build_object('event_id', new_id, 'field', _field, 'state', _state, 'source', _source,
      'revision', COALESCE(current_rev, 0) + 1, 'supersedes_id', current_id, 'note', clean_note));
  RETURN pg_catalog.jsonb_build_object('id', new_id, 'revision', COALESCE(current_rev, 0) + 1, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.record_checklist_evidence(uuid, text, text, text, text, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_checklist_evidence(uuid, text, text, text, text, integer, uuid) TO authenticated, service_role;