ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS applications_deleted_at_idx ON public.applications (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE public.deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('deleted','restored','purged','hold_on','hold_off')),
  actor uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deletion_events TO authenticated;
GRANT ALL ON public.deletion_events TO service_role;
ALTER TABLE public.deletion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads deletion events" ON public.deletion_events FOR SELECT TO authenticated USING (private.is_owner());

CREATE TABLE public.deletion_file_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, path)
);
GRANT SELECT ON public.deletion_file_jobs TO authenticated;
GRANT ALL ON public.deletion_file_jobs TO service_role;
ALTER TABLE public.deletion_file_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads file jobs" ON public.deletion_file_jobs FOR SELECT TO authenticated USING (private.is_owner());

CREATE OR REPLACE FUNCTION public.soft_delete_application(_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; uid uuid := auth.uid();
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF EXISTS (SELECT 1 FROM rentals WHERE application_id = _id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_rental');
  END IF;
  UPDATE applications SET deleted_at = now(), deleted_by = uid, deleted_reason = left(_reason, 500) WHERE id = _id;
  UPDATE application_waitlist_holds SET removed_at = now(), removed_by = uid WHERE application_id = _id AND removed_at IS NULL;
  DELETE FROM application_resume_tokens WHERE application_id = _id;
  DELETE FROM applicant_upload_grants WHERE application_id = _id;
  DELETE FROM automation_enrollments WHERE application_id = _id;
  INSERT INTO deletion_events (application_id, action, actor) VALUES (_id, 'deleted', uid);
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

CREATE OR REPLACE FUNCTION public.restore_application(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at, purged_at INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.purged_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'purged'); END IF;
  IF a.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  UPDATE applications SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = _id;
  INSERT INTO deletion_events (application_id, action, actor) VALUES (_id, 'restored', auth.uid());
  RETURN jsonb_build_object('ok', true, 'already', false);
END $$;

CREATE OR REPLACE FUNCTION public.set_legal_hold(_id uuid, _on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE applications SET legal_hold = _on WHERE id = _id AND legal_hold IS DISTINCT FROM _on;
  IF FOUND THEN
    INSERT INTO deletion_events (application_id, action, actor) VALUES (_id, CASE WHEN _on THEN 'hold_on' ELSE 'hold_off' END, auth.uid());
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.purge_application(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; removed jsonb; kept jsonb; n int;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at, purged_at, legal_hold INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.purged_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF a.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_soft_deleted'); END IF;
  IF a.legal_hold THEN RETURN jsonb_build_object('ok', false, 'error', 'legal_hold'); END IF;
  IF EXISTS (SELECT 1 FROM rentals WHERE application_id = _id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_rental');
  END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE driver_id = _id AND lower(coalesce(status,'')) NOT IN
      ('paid','succeeded','refunded','partially_refunded','void','voided','waived','cancelled','canceled','resolved')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'open_charge');
  END IF;

  -- Only identity documents, and only when nothing else depends on them.
  WITH gone AS (
    DELETE FROM documents d
    WHERE d.driver_id = _id
      AND d.category IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history')
      AND NOT EXISTS (SELECT 1 FROM financial_transaction_evidence e WHERE e.document_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM document_vehicle_links l WHERE l.document_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM documents s WHERE s.superseded_by = d.id)
    RETURNING storage_bucket, storage_path, category),
  q AS (
    INSERT INTO deletion_file_jobs (application_id, bucket, path)
    SELECT _id, storage_bucket, storage_path FROM gone
    ON CONFLICT (bucket, path) DO NOTHING RETURNING 1)
  SELECT coalesce(jsonb_object_agg(category, c), '{}'::jsonb) INTO removed
    FROM (SELECT category, count(*) c FROM gone GROUP BY category) x;
  SELECT coalesce(jsonb_object_agg(category, c), '{}'::jsonb) INTO kept
    FROM (SELECT category, count(*) c FROM documents WHERE driver_id = _id GROUP BY category) y;

  -- Screening: anonymize personal free text / identifiers, keep decisions and dates.
  UPDATE driver_screenings SET interview_notes = NULL, insurance_policy_number = NULL,
    insurance_carrier_phone = NULL, verification_recording_url = NULL, disqualification_reason = NULL,
    interviewed_by = NULL, insurance_verified_by = NULL
  WHERE lead_id = _id;

  UPDATE applications SET
    full_name = 'Deleted Driver', email = 'deleted+' || id || '@invalid.example', phone = '0000000',
    dob = NULL, address = NULL, zip = NULL, license_number = NULL, license_state = NULL,
    license_expiration = NULL, license_photo_url = NULL, notes = NULL, profile_screenshot_url = NULL,
    trip_screenshots = '{}', resubmission_history = '[]'::jsonb, requested_docs = '[]'::jsonb,
    doc_request_note = NULL, insurance_doc_url = NULL, insurance_carrier = NULL, insurance_policy_number = NULL,
    ai_summary = NULL, ai_flags = NULL, stripe_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL,
    card_exp_month = NULL, card_exp_year = NULL, sms_consent_phone = NULL, sms_consent_text = NULL,
    user_id = NULL, deleted_reason = NULL, purged_at = now()
  WHERE id = _id;

  UPDATE waitlist SET full_name = 'Deleted Driver', email = 'deleted+' || id || '@invalid.example', phone = NULL
  WHERE promoted_application_id = _id;

  INSERT INTO deletion_events (application_id, action, actor, details)
  VALUES (_id, 'purged', auth.uid(), jsonb_build_object('removed', removed, 'retained_documents', kept));
  RETURN jsonb_build_object('ok', true, 'already', false, 'removed', removed, 'retained_documents', kept);
END $$;

REVOKE ALL ON FUNCTION public.soft_delete_application(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_legal_hold(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_application(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_legal_hold(uuid, boolean) TO authenticated;