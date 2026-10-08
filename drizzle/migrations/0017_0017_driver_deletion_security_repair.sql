DROP POLICY IF EXISTS "Managers delete applications" ON public.applications;
REVOKE DELETE, TRUNCATE ON public.applications FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.waitlist FROM anon, authenticated;
CREATE POLICY "No direct application deletes" ON public.applications AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);
CREATE POLICY "No direct waitlist deletes" ON public.waitlist AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

CREATE OR REPLACE FUNCTION public.driver_deletion_blocker(_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM rentals WHERE (application_id = _id OR driver_id = _id) AND status = 'active') THEN 'active_rental'
    WHEN EXISTS (SELECT 1 FROM payments WHERE driver_id = _id AND status NOT IN ('paid','refunded','waived','void')) THEN 'unpaid_payment'
    WHEN EXISTS (SELECT 1 FROM toll_charges WHERE application_id = _id AND status IN ('new','assigned','disputed')) THEN 'open_charge'
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.driver_deletion_blocker(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_application(_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a record; uid uuid := auth.uid(); blocker text; closed int;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  blocker := public.driver_deletion_blocker(_id);
  IF blocker IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', blocker); END IF;
  UPDATE applications SET deleted_at = now(), deleted_by = uid, deleted_reason = left(_reason, 500) WHERE id = _id;
  UPDATE application_waitlist_holds SET removed_at = now(), removed_by = uid WHERE application_id = _id AND removed_at IS NULL;
  GET DIAGNOSTICS closed = ROW_COUNT;
  DELETE FROM application_resume_tokens WHERE application_id = _id;
  DELETE FROM applicant_upload_grants WHERE application_id = _id;
  DELETE FROM automation_enrollments WHERE application_id = _id;
  INSERT INTO deletion_events (application_id, action, actor, details)
  VALUES (_id, 'deleted', uid, jsonb_build_object('waitlist_holds_closed', closed));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $function$;

CREATE OR REPLACE FUNCTION public.restore_application(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a record; reopened int := 0;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at, deleted_by, purged_at INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.purged_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'purged'); END IF;
  IF a.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF NOT EXISTS (SELECT 1 FROM application_waitlist_holds WHERE application_id = _id AND removed_at IS NULL) THEN
    INSERT INTO application_waitlist_holds (application_id, added_at, added_by)
    SELECT h.application_id, h.added_at, h.added_by FROM application_waitlist_holds h
    WHERE h.application_id = _id AND h.removed_at = a.deleted_at
    ORDER BY h.added_at LIMIT 1;
    GET DIAGNOSTICS reopened = ROW_COUNT;
  END IF;
  UPDATE applications SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL WHERE id = _id;
  INSERT INTO deletion_events (application_id, action, actor, details)
  VALUES (_id, 'restored', auth.uid(), jsonb_build_object('waitlist_hold_reopened', reopened > 0));
  RETURN jsonb_build_object('ok', true, 'already', false);
END $function$;

CREATE OR REPLACE FUNCTION public.purge_application(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a record; removed jsonb; kept jsonb; n int; blocker text;
BEGIN
  IF NOT private.is_owner() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id, deleted_at, purged_at, legal_hold INTO a FROM applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF a.purged_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  IF a.deleted_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_soft_deleted'); END IF;
  IF a.legal_hold THEN RETURN jsonb_build_object('ok', false, 'error', 'legal_hold'); END IF;
  blocker := public.driver_deletion_blocker(_id);
  IF blocker IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', blocker); END IF;

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
END $function$;