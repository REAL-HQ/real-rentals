-- Saved checklist check-offs (Upload Due / Not Collected). Append-only history;
-- written only through public.record_checklist_evidence by Managers/Owners.
CREATE TABLE public.checklist_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  field text NOT NULL CHECK (field IN ('license_front', 'license_back', 'insurance', 'agreement', 'gig_profile')),
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id uuid REFERENCES public.checklist_evidence_events(id),
  state text NOT NULL CHECK (state IN ('collected', 'not_collected')),
  source text CHECK (source IS NULL OR source IN ('email', 'text', 'paper', 'other')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  actor_id uuid NOT NULL,
  actor_role text NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, field, revision),
  CHECK ((state = 'collected') = (source IS NOT NULL))
);
CREATE INDEX checklist_evidence_events_app_idx ON public.checklist_evidence_events (application_id, field, revision DESC);

GRANT SELECT ON public.checklist_evidence_events TO authenticated;
GRANT ALL ON public.checklist_evidence_events TO service_role;
ALTER TABLE public.checklist_evidence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read checklist evidence" ON public.checklist_evidence_events
  FOR SELECT TO authenticated USING (private.is_manager());

CREATE OR REPLACE FUNCTION public.checklist_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'checklist_evidence_is_append_only';
END $$;
CREATE TRIGGER checklist_evidence_events_append_only
  BEFORE UPDATE OR DELETE ON public.checklist_evidence_events
  FOR EACH ROW EXECUTE FUNCTION public.checklist_evidence_append_only();

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
  IF _field IS NULL OR _field <> ALL (ARRAY['license_front', 'license_back', 'insurance', 'agreement', 'gig_profile']) THEN RAISE EXCEPTION 'invalid_field'; END IF;
  IF _state IS NULL OR _state <> ALL (ARRAY['collected', 'not_collected']) THEN RAISE EXCEPTION 'invalid_state'; END IF;
  IF _state = 'collected' AND (_source IS NULL OR _source <> ALL (ARRAY['email', 'text', 'paper', 'other'])) THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF _state = 'not_collected' AND _source IS NOT NULL THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF pg_catalog.char_length(clean_note) > 1000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  IF _idempotency_key IS NULL OR _expected_revision IS NULL OR _expected_revision < 0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  -- Same lock activation takes, so a check-off and an activation never interleave.
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

-- Activation now accepts a saved check-off (Upload Due) for license/agreement files and
-- treats a saved Not Collected mark as a written-reason override; everything else unchanged.
CREATE OR REPLACE FUNCTION public.activate_rental_checked_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date, _pickup_miles integer, _actor uuid, _insurance_exception_ack boolean, _audit jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 today date := (pg_catalog.now() AT TIME ZONE 'America/New_York')::date;
 setting_value jsonb;
 setting_present boolean;
 setting_allow boolean;
 app_expires date;
 verified boolean;
 interview_done boolean;
 inspection_passed boolean;
 has_insurance_doc boolean;
 doc_expired boolean;
 insurance_status text;
 exception_used boolean := false;
 esign boolean;
 paper boolean;
 lic_front_file boolean;
 lic_back_file boolean;
 lic_front_state text;
 lic_back_state text;
 agr_state text;
 license_check text := 'file';
 agreement_check text;
 overrides jsonb;
 override_codes text[] := ARRAY[]::text[];
 override_reason text;
 bad_code text;
 rental uuid;
 audit_id uuid;
 decided_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
 IF _audit IS NULL OR pg_catalog.jsonb_typeof(_audit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'audit_payload_required'; END IF;
 -- M2 lock order: the shared release lock before any row lock (re-entrant inside activate_rental_tx).
 PERFORM pg_catalog.pg_advisory_xact_lock(710026, 2);
 -- 0. The acting user must be a Manager or Owner (the server already checked; this is the database's own check).
 PERFORM 1 FROM public.user_roles r WHERE r.user_id = _actor AND r.role::text = ANY (ARRAY['admin', 'team']) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'actor_not_manager' USING ERRCODE = '42501'; END IF;
 -- 1. The Owner setting, locked FOR SHARE so a concurrent Owner change waits for this transaction.
 SELECT s.value INTO setting_value FROM public.app_settings s WHERE s.key = 'rental_activation' FOR SHARE;
 setting_present := FOUND;
 setting_allow := setting_present
  AND pg_catalog.jsonb_typeof(setting_value OPERATOR(pg_catalog.->) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'boolean'
  AND (setting_value OPERATOR(pg_catalog.->>) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'true';
 -- 2. The application (FOR UPDATE: the lock activate_rental_tx takes next), the screening, the
 --    documents, agreements and passed inspections this check reads (FOR SHARE).
 SELECT a.insurance_expires_on INTO app_expires FROM public.applications a WHERE a.id = _application_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT sc.insurance_verified IS TRUE, sc.interview_completed_at IS NOT NULL INTO verified, interview_done
  FROM public.driver_screenings sc WHERE sc.lead_id = _application_id FOR SHARE;
 verified := verified IS TRUE;
 interview_done := interview_done IS TRUE;
 PERFORM 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = ANY (ARRAY['insurance', 'license_front', 'license_back', 'agreement']) FOR SHARE;
 PERFORM 1 FROM public.agreements g WHERE g.application_id = _application_id AND g.status = 'signed' FOR SHARE;
 PERFORM 1 FROM public.checklist_evidence_events e WHERE e.application_id = _application_id FOR SHARE;
 PERFORM 1 FROM public.inspections i WHERE i.vehicle_id = _vehicle_id AND i.inspection_type = 'pre_delivery' AND i.status = 'passed' FOR SHARE;
 inspection_passed := FOUND;
 has_insurance_doc := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected');
 doc_expired := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected' AND d.expires_at < today);
 insurance_status := CASE WHEN app_expires < today OR doc_expired THEN 'expired'
  WHEN verified THEN 'verified' WHEN NOT has_insurance_doc THEN 'missing' ELSE 'unverified' END;
 -- 3. License and agreement facts, re-checked under the locks above. A file on record wins;
 --    otherwise a saved Manager/Owner check-off (Upload Due) counts, and a saved Not Collected
 --    mark needs a written-reason override (step 5). No mark at all is still refused.
 lic_front_file := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
   AND d.category = 'license_front' AND d.review_status IS DISTINCT FROM 'rejected');
 lic_back_file := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
   AND d.category = 'license_back' AND d.review_status IS DISTINCT FROM 'rejected');
 SELECT e.state INTO lic_front_state FROM public.checklist_evidence_events e
  WHERE e.application_id = _application_id AND e.field = 'license_front' ORDER BY e.revision DESC LIMIT 1;
 SELECT e.state INTO lic_back_state FROM public.checklist_evidence_events e
  WHERE e.application_id = _application_id AND e.field = 'license_back' ORDER BY e.revision DESC LIMIT 1;
 SELECT e.state INTO agr_state FROM public.checklist_evidence_events e
  WHERE e.application_id = _application_id AND e.field = 'agreement' ORDER BY e.revision DESC LIMIT 1;
 esign := EXISTS (SELECT 1 FROM public.agreements g WHERE g.application_id = _application_id AND g.source = 'rental'
  AND g.status = 'signed' AND g.signed_at IS NOT NULL AND g.voided_at IS NULL AND g.rental_id IS NULL);
 -- A paper agreement counts only with its audited Manager/Owner verification of this exact file.
 paper := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.category = 'agreement'
  AND d.is_current IS TRUE AND d.review_status = 'verified' AND d.storage_path IS NOT NULL AND d.reviewed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.audit_log l WHERE l.action = 'document.verified' AND l.entity_type = 'application'
   AND l.entity_id = _application_id::text AND l.actor_role = ANY (ARRAY['admin', 'team'])
   AND l.metadata OPERATOR(pg_catalog.->>) 'paper_agreement' = 'true'
   AND l.metadata OPERATOR(pg_catalog.->>) 'documentId' = d.id::text
   AND l.metadata OPERATOR(pg_catalog.->>) 'storage_path' = d.storage_path
   AND l.metadata OPERATOR(pg_catalog.->>) 'reviewed_at_ms' = (pg_catalog.floor(EXTRACT(EPOCH FROM d.reviewed_at) * 1000))::bigint::text));
 -- 4. Insurance: verified, or the Owner exception is ON and the operator acknowledged it.
 IF insurance_status <> 'verified' THEN
  IF NOT setting_allow THEN RAISE EXCEPTION 'insurance_not_verified:%', insurance_status; END IF;
  IF _insurance_exception_ack IS NOT TRUE THEN RAISE EXCEPTION 'insurance_ack_required:%', insurance_status; END IF;
  exception_used := true;
 END IF;
 -- 5. Soft blockers (the only overridable ones): an override may name only no_interview and
 --    no_passed_inspection, needs a written reason, and must cover every one that is unmet now.
 overrides := _audit OPERATOR(pg_catalog.->) 'overrides';
 IF overrides IS NOT NULL AND pg_catalog.jsonb_typeof(overrides) <> 'null' THEN
  IF pg_catalog.jsonb_typeof(overrides) <> 'object' OR pg_catalog.jsonb_typeof(overrides OPERATOR(pg_catalog.->) 'blockers') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'override_payload_invalid';
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(b OPERATOR(pg_catalog.->>) 'code'), ARRAY[]::text[]) INTO override_codes
   FROM pg_catalog.jsonb_array_elements(overrides OPERATOR(pg_catalog.->) 'blockers') b;
  SELECT c INTO bad_code FROM pg_catalog.unnest(override_codes) c
   WHERE c IS NULL OR c <> ALL (ARRAY['no_interview', 'no_passed_inspection', 'license_not_collected', 'agreement_not_collected']) LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'override_not_allowed:%', COALESCE(bad_code, 'null'); END IF;
  override_reason := pg_catalog.btrim(overrides OPERATOR(pg_catalog.->>) 'reason');
  IF override_reason IS NULL OR pg_catalog.length(override_reason) < 5 THEN RAISE EXCEPTION 'override_reason_required'; END IF;
 ELSE
  overrides := NULL;
 END IF;
 IF NOT interview_done AND NOT ('no_interview' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:no_interview'; END IF;
 IF NOT inspection_passed AND NOT ('no_passed_inspection' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:no_passed_inspection'; END IF;
 IF NOT (lic_front_file AND lic_back_file) THEN
  IF (lic_front_file OR lic_front_state IS NOT DISTINCT FROM 'collected') AND (lic_back_file OR lic_back_state IS NOT DISTINCT FROM 'collected') THEN
   license_check := 'staff_confirmed';
  ELSIF (lic_front_file OR lic_front_state IN ('collected', 'not_collected')) AND (lic_back_file OR lic_back_state IN ('collected', 'not_collected')) THEN
   IF NOT ('license_not_collected' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:license_not_collected'; END IF;
   license_check := 'not_collected_override';
  ELSE
   RAISE EXCEPTION 'missing_documents';
  END IF;
 END IF;
 IF esign THEN agreement_check := 'esign';
 ELSIF paper THEN agreement_check := 'paper';
 ELSIF agr_state = 'collected' THEN agreement_check := 'staff_confirmed';
 ELSIF agr_state = 'not_collected' THEN
  IF NOT ('agreement_not_collected' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:agreement_not_collected'; END IF;
  agreement_check := 'not_collected_override';
 ELSE RAISE EXCEPTION 'no_signed_agreement';
 END IF;
 -- 6. The existing, unchanged activation transaction.
 rental := public.activate_rental_tx(_application_id, _vehicle_id, _driver_id, _weekly_rate, _deposit, _deposit_held,
  _start, _end, _pickup_miles, _actor);
 -- 7. The required rental.activated audit entry, in this transaction.
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, ip, user_agent)
 VALUES (_actor, pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'actor_email', 320), pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'actor_role', 40),
  'rental.activated', 'rental', rental::text,
  pg_catalog.left(COALESCE(NULLIF(_audit OPERATOR(pg_catalog.->>) 'summary', ''), 'Activated rental'), 300),
  pg_catalog.jsonb_build_object('vehicle_id', _vehicle_id, 'application_id', _application_id, 'driver_id', _driver_id,
   'account_created', (_audit OPERATOR(pg_catalog.->>) 'account_created') = 'true',
   'overrides', CASE WHEN overrides IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
     'blockers', overrides OPERATOR(pg_catalog.->) 'blockers', 'reason', override_reason, 'by', _actor, 'at', decided_at) END,
   'insurance', pg_catalog.jsonb_build_object('acting_user_id', _actor, 'at', decided_at, 'status', insurance_status,
     'exception_used', exception_used, 'setting_allow_without_verification', setting_allow, 'setting_present', setting_present,
     'setting_source', 'activation_transaction', 'acknowledged', _insurance_exception_ack IS TRUE, 'checked_in_transaction', true),
   'checks', pg_catalog.jsonb_build_object('signed_agreement', agreement_check,
     'interview_completed', interview_done, 'inspection_passed', inspection_passed, 'license_documents', license_check),
   'transaction_id', pg_catalog.txid_current()::text, 'source', 'activate_rental_checked_tx'),
  pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'ip', 100), pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'user_agent', 500))
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('rental_id', rental, 'insurance_status', insurance_status,
  'exception_used', exception_used, 'setting_present', setting_present, 'setting_allow', setting_allow,
  'acknowledged', _insurance_exception_ack IS TRUE, 'signed_agreement', agreement_check, 'license_documents', license_check,
  'audit_id', audit_id);
END $function$;
