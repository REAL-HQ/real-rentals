-- PROPOSED. Record Rental agreement eligibility corrections. Owner approval required.
-- Prerequisites: M2, proposed/paper-agreements-v1.sql and 01-historical-agreements-v1.sql.
-- One transaction. Rollback: 05-eligibility-rollback.sql.
--
-- 1. A voided agreement no longer blocks a driver.
--    Until now any agreements row with rental_id NULL counted as "unlinked" -- including
--    a voided one -- so the snapshot raised legacy_agreement_conflict and registration
--    raised esign_agreement_pending forever. A voided agreement can never be evidence
--    (status 'voided', voided_at set; both readers already require 'signed' and no
--    void), so it is now ignored by those two checks only. The row keeps its status,
--    archive and audit history; when the rental starts, activate_rental_tx attaches it to
--    the rental exactly as it does for every activation today. An unsigned, unvoided
--    agreement still blocks; staff void it through the existing eSign flow.
--
-- 2. A legacy eSign agreement (no record_rental_terms_v1 block, archive at a legacy
--    path that M2 forbids moving) can become staff-verified evidence:
--    public.register_legacy_esign_agreement_v1. Staff confirm the start, rate, deposit
--    and terms against the signed PDF; the database proves the registered document IS
--    the eSign archive (its SHA-256 equals agreements.sha256, recorded at signing) and
--    takes the signing instant from the real eSign event (agreements.signed_at) -- never
--    staff-entered. The eSign agreement row is not modified; recording the rental links
--    it (agreements.rental_id) through activate_rental_tx, and the consume trigger
--    verifies that link in the same transaction.
--    The evidence stays kind 'paper' / verification 'paper-registered' with source
--    'legacy_esign', so it is never presented as a platform-verified eSign recording.
BEGIN;

CREATE TABLE private.historical_eligibility_v1_prior (fn text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON private.historical_eligibility_v1_prior FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.historical_eligibility_v1_prior
SELECT f, pg_get_functiondef(f::regprocedure) FROM unnest(ARRAY[
  'private.record_snapshot_v1(uuid,uuid,uuid,uuid)',
  'private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)',
  'public.register_historical_agreement_v1(uuid,uuid,uuid,uuid,date,timestamp with time zone,numeric,numeric,text)',
  'public.historical_agreement_for_record_v1(uuid)',
  'private.historical_agreement_consume_v1()']) f;

ALTER TABLE private.historical_agreements_v1
  ADD COLUMN source text NOT NULL DEFAULT 'paper' CHECK (source IN ('paper', 'legacy_esign')),
  ADD COLUMN legacy_agreement_id uuid UNIQUE REFERENCES public.agreements(id) ON DELETE RESTRICT,
  ADD COLUMN legacy_signed_at timestamptz,
  ADD CONSTRAINT historical_agreements_v1_legacy_shape CHECK (
    (source = 'paper' AND legacy_agreement_id IS NULL AND legacy_signed_at IS NULL)
    OR (source = 'legacy_esign' AND legacy_agreement_id IS NOT NULL AND legacy_signed_at IS NOT NULL
        AND legacy_signed_at <= rental_start
        AND signed_on = (legacy_signed_at AT TIME ZONE 'America/New_York')::date));

-- An agreement row that still matters for eligibility: not linked to a rental, not voided.
CREATE FUNCTION private.agreement_open_v1(rental_id uuid, status text, voided_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT rental_id IS NULL AND voided_at IS NULL AND status IS DISTINCT FROM 'voided'
$$;
REVOKE ALL ON FUNCTION private.agreement_open_v1(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.agreement_open_v1(uuid, text, timestamptz) TO rr_evidence_issuer, rr_record_executor;

CREATE OR REPLACE FUNCTION private.historical_agreement_result_v1(h private.historical_agreements_v1, recovered boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', 'historical-agreement-v1', 'historicalAgreementId', h.id,
    'status', CASE WHEN h.status = 'voided' THEN 'voided' WHEN h.rental_id IS NOT NULL THEN 'recorded' ELSE 'registered' END,
    'verification', h.verification, 'source', h.source, 'legacyAgreementId', h.legacy_agreement_id,
    'legacySignedAt', h.legacy_signed_at, 'applicationId', h.application_id, 'vehicleId', h.vehicle_id,
    'documentId', h.document_id, 'documentSha256', h.document_sha256, 'signedOn', h.signed_on,
    'rentalStart', h.rental_start, 'weeklyCents', h.weekly_cents, 'depositCents', h.deposit_cents,
    'currency', h.currency, 'termsSummary', h.terms_summary, 'registeredBy', h.registered_by,
    'registeredAt', h.registered_at, 'rentalId', h.rental_id, 'recovered', recovered)
$$;

-- The shared registration: every check of 01's register_historical_agreement_v1, with
-- voided agreements ignored, plus the legacy-eSign proof when _legacy is given.
CREATE FUNCTION private.register_historical_core_v1(
  _operation_id uuid, _application_id uuid, _vehicle_id uuid, _document_id uuid,
  _signed_on date, _rental_start timestamptz, _weekly_rate numeric, _deposit numeric, _terms_summary text,
  _legacy uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE actor uuid; rl text; em text; app record; veh record; doc public.documents%ROWTYPE; ag public.agreements%ROWTYPE;
  ops integer; h private.historical_agreements_v1; cents integer; dep integer; src text := 'paper';
BEGIN
  actor := private.approval_actor(); PERFORM private.record_session_v1();
  PERFORM private.approval_lock();
  IF _legacy IS NOT NULL THEN
    src := 'legacy_esign';
    SELECT * INTO ag FROM public.agreements WHERE id = _legacy FOR UPDATE;
    IF NOT FOUND OR ag.source IS DISTINCT FROM 'rental' OR ag.status IS DISTINCT FROM 'signed' OR ag.voided_at IS NOT NULL
       OR ag.rental_id IS NOT NULL OR ag.archive_status IS DISTINCT FROM 'archived' OR ag.signed_at IS NULL
       OR NOT isfinite(ag.signed_at) OR ag.sha256 IS NULL OR ag.sha256 !~ '^[0-9a-f]{64}$'
       OR ag.application_id IS NULL OR ag.vehicle_id IS NULL THEN
      RAISE EXCEPTION 'legacy_agreement_unavailable'; END IF;
    -- The application, vehicle and signing date come from the eSign record, never from staff.
    _application_id := ag.application_id; _vehicle_id := ag.vehicle_id;
    _signed_on := (ag.signed_at AT TIME ZONE 'America/New_York')::date;
  END IF;
  IF _operation_id IS NULL OR _application_id IS NULL OR _vehicle_id IS NULL OR _document_id IS NULL
     OR _weekly_rate IS NULL OR _weekly_rate <= 0 OR _weekly_rate > 100000 OR _weekly_rate <> round(_weekly_rate, 2)
     OR (_deposit IS NOT NULL AND (_deposit < 0 OR _deposit > 100000 OR _deposit <> round(_deposit, 2))) THEN
    RAISE EXCEPTION 'historical_agreement_invalid';
  END IF;
  cents := round(_weekly_rate * 100); dep := CASE WHEN _deposit IS NULL THEN NULL ELSE round(_deposit * 100) END;
  SELECT * INTO h FROM private.historical_agreements_v1 WHERE operation_id = _operation_id;
  IF FOUND THEN
    IF h.registered_by <> actor OR h.application_id <> _application_id OR h.vehicle_id <> _vehicle_id
       OR h.document_id <> _document_id OR h.signed_on IS DISTINCT FROM _signed_on OR h.rental_start IS DISTINCT FROM _rental_start
       OR h.weekly_cents <> cents OR h.deposit_cents IS DISTINCT FROM dep OR h.terms_summary IS DISTINCT FROM btrim(_terms_summary)
       OR h.legacy_agreement_id IS DISTINCT FROM _legacy THEN
      RAISE EXCEPTION 'operation_conflict' USING ERRCODE = '42501';
    END IF;
    RETURN private.historical_agreement_result_v1(h, true);
  END IF;
  IF _rental_start IS NULL OR NOT isfinite(_rental_start) OR _rental_start > clock_timestamp() THEN
    RAISE EXCEPTION 'rental_start_invalid'; END IF;
  IF _signed_on IS NULL OR _signed_on < DATE '2000-01-01'
     OR _signed_on > (clock_timestamp() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'signed_on_invalid'; END IF;
  IF _signed_on > (_rental_start AT TIME ZONE 'America/New_York')::date OR (src = 'legacy_esign' AND ag.signed_at > _rental_start) THEN
    RAISE EXCEPTION 'signed_after_start_unsupported'; END IF;
  IF _terms_summary IS NULL OR length(btrim(_terms_summary)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'terms_summary_required'; END IF;
  SELECT id, user_id, deleted_at INTO app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR app.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'application_unavailable'; END IF;
  IF app.user_id IS NULL THEN RAISE EXCEPTION 'driver_account_contract_required'; END IF;
  SELECT id, archived_at INTO veh FROM public.vehicles WHERE id = _vehicle_id FOR SHARE;
  IF NOT FOUND OR veh.archived_at IS NOT NULL THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
  SELECT * INTO doc FROM public.documents WHERE id = _document_id FOR SHARE;
  IF NOT FOUND OR doc.source IS DISTINCT FROM 'paper' OR doc.category IS DISTINCT FROM 'agreement'
     OR doc.driver_id IS DISTINCT FROM _application_id OR doc.storage_bucket IS DISTINCT FROM 'rental-agreements'
     OR doc.is_current IS NOT TRUE OR doc.superseded_by IS NOT NULL
     OR doc.content_sha256 IS NULL OR doc.content_sha256 !~ '^[0-9a-f]{64}$' OR doc.integrity_v1 IS NULL
     OR doc.integrity_v1->>'sha256' IS DISTINCT FROM doc.content_sha256
     OR doc.integrity_v1->>'application' IS DISTINCT FROM _application_id::text
     OR doc.integrity_v1->>'driver' IS DISTINCT FROM app.user_id::text
     OR doc.integrity_v1->>'agreement' IS NOT NULL
     OR doc.storage_path IS DISTINCT FROM ('immutable-v1/' || doc.id::text || '/' || doc.content_sha256 || '.pdf') THEN
    RAISE EXCEPTION 'paper_document_unverified';
  END IF;
  -- The registered copy must be byte-identical to the archive the eSign flow hashed at signing.
  IF src = 'legacy_esign' AND doc.content_sha256 IS DISTINCT FROM ag.sha256 THEN RAISE EXCEPTION 'legacy_document_mismatch'; END IF;
  SELECT count(*) INTO ops FROM public.paper_upload_operations p
   WHERE p.result_document_id = doc.id AND p.state = 'registered' AND p.sha256 = doc.content_sha256 AND p.driver_id = _application_id;
  IF ops <> 1 THEN RAISE EXCEPTION 'paper_provenance_missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.paper_upload_operations p WHERE p.result_document_id = doc.id
             AND (p.agreement_type IS DISTINCT FROM 'original' OR (p.signed_on IS NOT NULL AND p.signed_on <> _signed_on))) THEN
    RAISE EXCEPTION 'paper_attestation_conflict'; END IF;
  -- An open (unlinked, unvoided) eSign agreement contradicts a historical original --
  -- except, for the legacy route, the one eSign agreement being registered.
  IF EXISTS (SELECT 1 FROM public.agreements x WHERE x.application_id = _application_id
             AND private.agreement_open_v1(x.rental_id, x.status, x.voided_at) AND x.id IS DISTINCT FROM _legacy) THEN
    RAISE EXCEPTION 'esign_agreement_pending'; END IF;
  IF EXISTS (SELECT 1 FROM private.historical_agreements_v1 WHERE application_id = _application_id AND status = 'registered' AND rental_id IS NULL) THEN
    RAISE EXCEPTION 'historical_agreement_open'; END IF;
  IF _legacy IS NOT NULL AND EXISTS (SELECT 1 FROM private.historical_agreements_v1 WHERE legacy_agreement_id = _legacy AND status = 'registered') THEN
    RAISE EXCEPTION 'legacy_agreement_registered'; END IF;
  SELECT role::text INTO rl FROM public.user_roles WHERE user_id = actor AND role::text IN ('admin', 'team')
   ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END LIMIT 1;
  SELECT email INTO em FROM auth.users WHERE id = actor;
  INSERT INTO private.historical_agreements_v1 (operation_id, application_id, driver_user_id, vehicle_id, document_id,
    document_sha256, paper_operation_id, signed_on, rental_start, weekly_cents, deposit_cents, terms_summary,
    registered_by, registered_role, source, legacy_agreement_id, legacy_signed_at)
  SELECT _operation_id, _application_id, app.user_id, _vehicle_id, doc.id, doc.content_sha256, p.operation_id,
    _signed_on, _rental_start, cents, dep, btrim(_terms_summary), actor, rl, src, _legacy,
    CASE WHEN _legacy IS NULL THEN NULL ELSE ag.signed_at END
  FROM public.paper_upload_operations p WHERE p.result_document_id = doc.id AND p.state = 'registered'
  RETURNING * INTO h;
  INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (actor, em, rl, 'historical_agreement.registered', 'application', _application_id::text,
    CASE WHEN _legacy IS NULL THEN 'Staff-verified historical agreement registered (not an eSign event)'
         ELSE 'Staff-verified record of a legacy eSign agreement registered (the eSign event is unchanged)' END,
    private.historical_agreement_result_v1(h, false) - 'recovered');
  RETURN private.historical_agreement_result_v1(h, false);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'historical_agreement_contention_retry' USING ERRCODE = '40001';
END $$;
REVOKE ALL ON FUNCTION private.register_historical_core_v1(uuid, uuid, uuid, uuid, date, timestamptz, numeric, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_historical_agreement_v1(
  _operation_id uuid, _application_id uuid, _vehicle_id uuid, _document_id uuid,
  _signed_on date, _rental_start timestamptz, _weekly_rate numeric, _deposit numeric, _terms_summary text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms' AS $$
  SELECT private.register_historical_core_v1(_operation_id, _application_id, _vehicle_id, _document_id,
    _signed_on, _rental_start, _weekly_rate, _deposit, _terms_summary, NULL)
$$;

CREATE FUNCTION public.register_legacy_esign_agreement_v1(
  _operation_id uuid, _agreement_id uuid, _document_id uuid,
  _rental_start timestamptz, _weekly_rate numeric, _deposit numeric, _terms_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms' AS $$
BEGIN
  IF _agreement_id IS NULL THEN RAISE EXCEPTION 'legacy_agreement_unavailable'; END IF;
  RETURN private.register_historical_core_v1(_operation_id, NULL, NULL, _document_id,
    NULL, _rental_start, _weekly_rate, _deposit, _terms_summary, _agreement_id);
END $$;
REVOKE ALL ON FUNCTION public.register_legacy_esign_agreement_v1(uuid, uuid, uuid, timestamptz, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_legacy_esign_agreement_v1(uuid, uuid, uuid, timestamptz, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.historical_agreement_for_record_v1(_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE h private.historical_agreements_v1; doc public.documents%ROWTYPE;
BEGIN
  PERFORM private.approval_actor(); PERFORM private.record_session_v1();
  SELECT * INTO h FROM private.historical_agreements_v1
   WHERE application_id = _application_id AND status = 'registered' AND rental_id IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO doc FROM public.documents WHERE id = h.document_id;
  RETURN private.historical_agreement_result_v1(h, false) - 'recovered'
    || jsonb_build_object('driverUserId', h.driver_user_id, 'paperOperationId', h.paper_operation_id,
         'document', jsonb_build_object('id', doc.id, 'bucket', doc.storage_bucket, 'path', doc.storage_path,
           'sha256', doc.content_sha256, 'source', doc.source, 'integrity', doc.integrity_v1));
END $$;

-- Snapshot: as 01, with voided agreements ignored, and the paper branch accepting the
-- one open agreement a legacy registration names (and nothing else).
CREATE OR REPLACE FUNCTION private.record_snapshot_v1(a uuid, v uuid, g uuid, d uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET "TimeZone" TO 'UTC' AS $function$
DECLARE app jsonb; ag jsonb; doc jsonb; actor uuid; review uuid; linked jsonb; item record; hist jsonb;
BEGIN
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT to_jsonb(x) INTO app FROM public.applications x WHERE id=a FOR UPDATE NOWAIT;
 actor:=private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND OR app IS NULL OR app->>'user_id' IS NULL OR app->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'identity_unavailable';END IF;
 review:=private.validate_license_v1(a);
 IF review IS NULL THEN RAISE EXCEPTION 'positive_identity_required';END IF;
 IF nullif(app->>'license_number','') IS NULL OR nullif(app->>'license_state','') IS NULL
 OR (app->>'license_expiration')::date IS NULL OR NOT isfinite((app->>'license_expiration')::date)
 OR (app->>'license_expiration')::date<CURRENT_DATE THEN RAISE EXCEPTION 'license_unavailable';END IF;
 PERFORM 1 FROM public.vehicles WHERE id=v FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_missing';END IF;
 FOR item IN SELECT to_jsonb(x) AS j FROM public.agreements x WHERE application_id=a AND private.agreement_open_v1(x.rental_id,x.status,x.voided_at) ORDER BY id FOR SHARE NOWAIT LOOP
 IF item.j->>'vehicle_id' IS DISTINCT FROM v::text OR item.j->>'status' IS DISTINCT FROM 'signed' THEN RAISE EXCEPTION 'legacy_agreement_conflict';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) INTO linked FROM public.agreements x WHERE application_id=a AND private.agreement_open_v1(x.rental_id,x.status,x.voided_at);
 SELECT to_jsonb(x) INTO ag FROM public.agreements x WHERE id=g FOR SHARE NOWAIT;
 SELECT to_jsonb(x) INTO doc FROM public.documents x WHERE id=d FOR SHARE NOWAIT;
 IF doc IS NULL OR doc->'integrity_v1' IS NULL THEN RAISE EXCEPTION 'immutable_document_missing';END IF;
 IF ag IS NULL THEN
  SELECT to_jsonb(x) INTO hist FROM private.historical_agreements_v1 x WHERE id=g FOR SHARE NOWAIT;
  IF hist IS NOT NULL THEN
   IF hist->>'status' IS DISTINCT FROM 'registered' OR hist->>'rental_id' IS NOT NULL
   OR hist->>'application_id' IS DISTINCT FROM a::text OR hist->>'vehicle_id' IS DISTINCT FROM v::text
   OR hist->>'document_id' IS DISTINCT FROM d::text OR hist->>'driver_user_id' IS DISTINCT FROM app->>'user_id'
   OR hist->>'document_sha256' IS DISTINCT FROM doc->>'content_sha256'
   OR doc->>'source' IS DISTINCT FROM 'paper' OR doc->>'category' IS DISTINCT FROM 'agreement'
   OR doc->>'storage_bucket' IS DISTINCT FROM 'rental-agreements' OR doc->>'driver_id' IS DISTINCT FROM a::text
   OR doc->>'is_current' IS DISTINCT FROM 'true' OR doc->>'superseded_by' IS NOT NULL
   OR doc->'integrity_v1'->>'agreement' IS NOT NULL
   OR doc->'integrity_v1'->>'application' IS DISTINCT FROM a::text
   OR doc->'integrity_v1'->>'driver' IS DISTINCT FROM app->>'user_id'
   OR doc->'integrity_v1'->>'sha256' IS DISTINCT FROM doc->>'content_sha256'
   OR doc->>'storage_path' IS DISTINCT FROM ('immutable-v1/'||d::text||'/'||(doc->>'content_sha256')||'.pdf')
   OR NOT (jsonb_array_length(linked)=0
     OR (hist->>'legacy_agreement_id' IS NOT NULL AND jsonb_array_length(linked)=1
         AND linked->0->>'id' = hist->>'legacy_agreement_id'
         AND linked->0->>'sha256' = hist->>'document_sha256'
         AND linked->0->>'vehicle_id' = v::text AND linked->0->>'status' = 'signed'))
   THEN RAISE EXCEPTION 'historical_binding_mismatch'; END IF;
   doc:=doc||jsonb_build_object('version',doc->'integrity_v1'->>'version','sha256',doc->>'content_sha256');
   RETURN jsonb_build_object('application',app,'identity',private.license_snapshot_v1(a),'review',review,'agreement',ag,'document',doc,'legacy_linkable',linked,'historical',hist);
  END IF;
 END IF;
 IF ag IS NULL OR ag->>'document_id' IS DISTINCT FROM d::text OR ag->>'completed_document_id' IS DISTINCT FROM d::text
 OR ag->>'status' IS DISTINCT FROM 'signed' OR ag->>'voided_at' IS NOT NULL
 OR doc->'integrity_v1'->>'agreement' IS DISTINCT FROM g::text
 OR doc->'integrity_v1'->>'application' IS DISTINCT FROM a::text
 OR doc->'integrity_v1'->>'driver' IS DISTINCT FROM app->>'user_id'
 OR doc->'integrity_v1'->>'vehicle' IS DISTINCT FROM v::text
 OR doc->'integrity_v1'->>'sha256' IS DISTINCT FROM doc->>'content_sha256'
 OR doc->'integrity_v1'->>'sha256' IS DISTINCT FROM ag->>'sha256'
 THEN RAISE EXCEPTION 'signed_binding_mismatch'; END IF;
 doc:=doc||jsonb_build_object('version',doc->'integrity_v1'->>'version','sha256',doc->>'content_sha256');
 RETURN jsonb_build_object('application',app,'identity',private.license_snapshot_v1(a),'review',review,'agreement',ag,'document',doc,'legacy_linkable',linked);
END$function$;

-- Consumption: as 01, with the signing instant of a legacy registration being the
-- eSign record's own signed_at (a paper original keeps the start of its signing day).
CREATE OR REPLACE FUNCTION private.record_agreement_evidence_v1(a uuid, v uuid, t timestamp with time zone, rate numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE e private.record_evidence_v1; g jsonb; h private.historical_agreements_v1;BEGIN
 SELECT x.* INTO e FROM private.record_evidence_v1 x JOIN private.record_evidence_context_v1 c ON c.evidence_id=x.id WHERE c.transaction_id=txid_current();
 IF e.id IS NULL OR e.application_id<>a OR (e.request->>'vehicleId')::uuid<>v OR (e.request->>'startedAt')::timestamptz<>t OR (e.request->>'weeklyRate')::numeric<>rate THEN RAISE EXCEPTION 'evidence_context_missing';END IF;
 g:=e.verified->'agreement';
 IF g->>'kind'='paper' THEN
  SELECT * INTO h FROM private.historical_agreements_v1 WHERE id=(g->>'provenanceId')::uuid FOR UPDATE;
  IF NOT FOUND OR h.status<>'registered' OR h.rental_id IS NOT NULL OR h.application_id<>a OR h.vehicle_id<>v
  OR g->>'verification' IS DISTINCT FROM 'paper-registered' OR (g->>'id')::uuid IS DISTINCT FROM h.id
  OR h.rental_start<>t OR (g->>'effectiveAt')::timestamptz IS DISTINCT FROM h.rental_start
  OR h.weekly_cents<>round(rate*100) OR (g->>'weeklyCents')::numeric IS DISTINCT FROM h.weekly_cents
  OR g->>'currency' IS DISTINCT FROM h.currency
  OR h.deposit_cents IS DISTINCT FROM (CASE WHEN e.request->'deposit' IS NULL OR jsonb_typeof(e.request->'deposit')='null' THEN NULL ELSE round((e.request->>'deposit')::numeric*100) END)
  OR (g->>'documentId')::uuid IS DISTINCT FROM h.document_id OR g->>'signedHash' IS DISTINCT FROM h.document_sha256
  OR h.driver_user_id::text IS DISTINCT FROM g->>'driverId'
  OR (g->>'signedAt')::timestamptz IS DISTINCT FROM
     coalesce(h.legacy_signed_at, h.signed_on::timestamp AT TIME ZONE 'America/New_York')
  THEN RAISE EXCEPTION 'historical_agreement_mismatch';END IF;
 END IF;
 RETURN (g->>'provenanceId')::uuid;
END$function$;

-- Linking: as 01, plus a check that the legacy eSign agreement is linked to this rental.
CREATE OR REPLACE FUNCTION private.historical_agreement_consume_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e private.record_evidence_v1; h private.historical_agreements_v1;
BEGIN
  SELECT x.* INTO e FROM private.record_evidence_v1 x JOIN private.record_evidence_context_v1 c ON c.evidence_id = x.id
   WHERE c.transaction_id = txid_current();
  IF e.id IS NULL OR e.operation_id IS DISTINCT FROM NEW.operation_id OR e.verified->'agreement'->>'kind' IS DISTINCT FROM 'paper' THEN
    RETURN NULL; END IF;
  UPDATE private.historical_agreements_v1 SET rental_id = NEW.rental_id, consumed_at = clock_timestamp()
   WHERE id = (e.verified->'agreement'->>'provenanceId')::uuid AND status = 'registered' AND rental_id IS NULL
   RETURNING * INTO h;
  IF h.id IS NULL THEN RAISE EXCEPTION 'historical_agreement_consumed'; END IF;
  -- activate_rental_tx (the only rental start path) has already linked every unlinked
  -- agreement row of the driver to this rental; the legacy one must be among them, unchanged.
  IF h.legacy_agreement_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agreements
     WHERE id = h.legacy_agreement_id AND rental_id = NEW.rental_id AND status = 'signed' AND voided_at IS NULL
       AND sha256 = h.document_sha256) THEN
    RAISE EXCEPTION 'legacy_agreement_link_failed';
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
  VALUES (NEW.actor_id, 'historical_agreement.recorded', 'rental', NEW.rental_id::text,
    CASE WHEN h.legacy_agreement_id IS NULL THEN 'Rental recorded from a staff-verified historical agreement (not an eSign event)'
         ELSE 'Rental recorded from a staff-verified legacy eSign agreement (the eSign event is unchanged)' END,
    jsonb_build_object('historicalAgreementId', h.id, 'documentId', h.document_id, 'documentSha256', h.document_sha256,
      'signedOn', h.signed_on, 'rentalStart', h.rental_start, 'verification', h.verification, 'source', h.source,
      'legacyAgreementId', h.legacy_agreement_id, 'legacySignedAt', h.legacy_signed_at, 'operation', NEW.operation_id));
  RETURN NULL;
END $$;

COMMIT;
