-- Insurance is no longer a gate on screening status or rental activation.
--
-- enforce_screening_pipeline
--   Base: supabase/migrations/20260926210000_retire_lead_documents.sql
--   (the latest definition). Interview, disqualification, and the verification
--   recording are unchanged. An insurance document is not required for any
--   status, and insurance_verified no longer blocks a status change.
--   search_path stays public. The function stays SECURITY INVOKER. The existing
--   trigger and grants are left in place; CREATE OR REPLACE keeps them.
--
-- activate_rental_checked_tx
--   Base: drizzle/migrations/0024_checklist_evidence_checkoffs.sql, the latest
--   body of the installed wrapper (checklist check-offs included). Only the
--   insurance refusal is removed. SECURITY DEFINER, search_path '', the actor
--   check, licence and agreement checks, soft-blocker overrides, the call to
--   activate_rental_tx, the audit insert, and existing grants stay as they are.
--   If this signature is not installed, the wrapper is not created.
--
-- Idempotent. Does not change rental-agreement text, RLS, or other functions.
-- Not applied by this change; apply it when ready.

CREATE OR REPLACE FUNCTION public.enforce_screening_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  doc_count int;
  rec_count int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('docs_pending','insurance_verified','approved','pickup_scheduled','active_renter') THEN
    IF NEW.interview_completed_at IS NULL THEN
      RAISE EXCEPTION 'Cannot advance to %: interview must be completed first', NEW.status;
    END IF;
    IF NEW.disqualified THEN
      RAISE EXCEPTION 'Cannot advance to %: driver is disqualified', NEW.status;
    END IF;
  END IF;

  IF NEW.status IN ('insurance_verified','approved','pickup_scheduled','active_renter') THEN
    SELECT count(DISTINCT category) INTO doc_count
      FROM public.documents
      WHERE driver_id = NEW.lead_id
        AND is_current
        AND coalesce(review_status, 'uploaded') <> 'rejected'
        AND category IN ('license_front','license_back','gig_profile');
    IF doc_count < 3 THEN
      RAISE EXCEPTION 'Cannot advance to %: licence front, licence back, and gig profile are required (have %)', NEW.status, doc_count;
    END IF;

    SELECT count(*) INTO rec_count
      FROM public.documents
      WHERE driver_id = NEW.lead_id
        AND is_current
        AND coalesce(review_status, 'uploaded') <> 'rejected'
        AND category = 'verification_recording';
    IF rec_count < 1 THEN
      RAISE EXCEPTION 'Cannot advance to %: verification call recording required', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DO $migration$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)'
  ) IS NULL THEN
    RAISE NOTICE 'activate_rental_checked_tx is not installed; activation stays on activate_rental_tx';
    RETURN;
  END IF;

  EXECUTE $fn$
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
 -- 4. Renter insurance does not block activation. Missing, expired, and unverified
 --    policies continue. Status is still stored on the rental.activated audit row.
 --    exception_used stays false: this is no longer an exception.
 -- 5. Soft blockers (the only overridable ones): an override may name only no_interview,
 --    no_passed_inspection and the saved Not Collected marks, needs a written reason, and must
 --    cover every one that is unmet now.
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
$fn$;
END
$migration$;
