-- PROPOSED. Historical (paper/PDF) rental agreements for Record Rental.
-- Owner approval required. Not a migration; nothing applies it automatically.
-- Prerequisites: the M2 packet (through step 29) and proposed/paper-agreements-v1.sql.
-- One transaction.
--
-- What it adds
--   private.historical_agreements_v1  one staff-verified registration per original:
--     the preserved, immutably bound paper document, the date the document was
--     signed, the verified rental start instant, weekly rate, deposit and terms,
--     who verified it and when. Immutable except two one-way transitions:
--     voided (never used), or linked to the rental Record Rental creates.
--   public.register_historical_agreement_v1  Owner/Manager registration
--   public.void_historical_agreement_v1      Owner/Manager void of an unused registration
--   public.historical_agreement_for_record_v1 Owner/Manager read for the evidence reader
--   private.record_snapshot_v1               + a paper branch, used ONLY when no eSign
--                                              agreement row has that id; the eSign
--                                              branch is unchanged
--   private.record_agreement_evidence_v1     + consumption check of paper evidence against
--                                              the registration; eSign unchanged
--   trigger on private.record_operations     links the registration to the new rental once
--   private.historical_agreements_v1_prior   the replaced definitions, for 02-rollback.sql
--
-- What it does not do
--   It never creates or backdates an eSign agreement or event. A historical agreement
--   is labelled staff_verified (evidence kind 'paper', verification 'paper-registered'),
--   never esign-verified. It does not accept a rental with no signed original:
--   missing-contract exceptions are a separate, unbuilt and disabled business decision.
--   It refuses contradictions instead of resolving them: a document signed after the
--   start, a pending eSign agreement for the same driver, a second open registration,
--   a document that is not a bound paper original of this driver, or terms that differ
--   at recording time.
BEGIN;

-- The two functions replaced below, exactly as installed now, for 02-rollback.sql.
CREATE TABLE private.historical_agreements_v1_prior (fn text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON private.historical_agreements_v1_prior FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.historical_agreements_v1_prior
SELECT f, pg_get_functiondef(f::regprocedure) FROM unnest(ARRAY[
  'private.record_snapshot_v1(uuid,uuid,uuid,uuid)',
  'private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)']) f;

CREATE TABLE private.historical_agreements_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  driver_user_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE RESTRICT,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  paper_operation_id uuid NOT NULL UNIQUE,
  signed_on date NOT NULL,
  rental_start timestamptz NOT NULL,
  weekly_cents integer NOT NULL CHECK (weekly_cents > 0 AND weekly_cents <= 10000000),
  deposit_cents integer CHECK (deposit_cents IS NULL OR deposit_cents BETWEEN 0 AND 10000000),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  terms_summary text NOT NULL CHECK (length(btrim(terms_summary)) BETWEEN 10 AND 2000),
  verification text NOT NULL DEFAULT 'staff_verified' CHECK (verification = 'staff_verified'),
  registered_by uuid NOT NULL,
  registered_role text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'voided')),
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  rental_id uuid UNIQUE REFERENCES public.rentals(id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  CHECK (isfinite(rental_start) AND signed_on >= DATE '2000-01-01'),
  CHECK (signed_on <= (rental_start AT TIME ZONE 'America/New_York')::date),
  CHECK ((status = 'voided') = (voided_at IS NOT NULL)),
  CHECK ((rental_id IS NULL) = (consumed_at IS NULL)),
  CHECK (NOT (status = 'voided' AND rental_id IS NOT NULL))
);
-- One open registration per driver: two would make the evidence ambiguous.
CREATE UNIQUE INDEX historical_agreements_v1_one_open
  ON private.historical_agreements_v1 (application_id) WHERE status = 'registered' AND rental_id IS NULL;
ALTER TABLE private.historical_agreements_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.historical_agreements_v1 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.historical_agreement_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE fixed text[] := ARRAY['status','voided_by','voided_at','void_reason','rental_id','consumed_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'historical_agreement_immutable' USING ERRCODE = '42501'; END IF;
  IF (to_jsonb(NEW) - fixed) IS DISTINCT FROM (to_jsonb(OLD) - fixed)
     OR OLD.status <> 'registered' OR OLD.rental_id IS NOT NULL THEN
    RAISE EXCEPTION 'historical_agreement_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'voided' AND NEW.rental_id IS NULL AND NEW.voided_by IS NOT NULL
     AND length(btrim(coalesce(NEW.void_reason, ''))) BETWEEN 5 AND 500 THEN RETURN NEW; END IF;
  IF NEW.status = 'registered' AND NEW.rental_id IS NOT NULL AND NEW.voided_at IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'historical_agreement_immutable' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER historical_agreement_guard_v1 BEFORE UPDATE OR DELETE ON private.historical_agreements_v1
  FOR EACH ROW EXECUTE FUNCTION private.historical_agreement_guard_v1();
CREATE FUNCTION private.historical_agreement_no_truncate_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'historical_agreement_immutable' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER historical_agreement_no_truncate_v1 BEFORE TRUNCATE ON private.historical_agreements_v1
  FOR EACH STATEMENT EXECUTE FUNCTION private.historical_agreement_no_truncate_v1();

CREATE FUNCTION private.historical_agreement_result_v1(h private.historical_agreements_v1, recovered boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', 'historical-agreement-v1', 'historicalAgreementId', h.id,
    'status', CASE WHEN h.status = 'voided' THEN 'voided' WHEN h.rental_id IS NOT NULL THEN 'recorded' ELSE 'registered' END,
    'verification', h.verification, 'applicationId', h.application_id, 'vehicleId', h.vehicle_id,
    'documentId', h.document_id, 'documentSha256', h.document_sha256, 'signedOn', h.signed_on,
    'rentalStart', h.rental_start, 'weeklyCents', h.weekly_cents, 'depositCents', h.deposit_cents,
    'currency', h.currency, 'termsSummary', h.terms_summary, 'registeredBy', h.registered_by,
    'registeredAt', h.registered_at, 'rentalId', h.rental_id, 'recovered', recovered)
$$;

CREATE FUNCTION public.register_historical_agreement_v1(
  _operation_id uuid, _application_id uuid, _vehicle_id uuid, _document_id uuid,
  _signed_on date, _rental_start timestamptz, _weekly_rate numeric, _deposit numeric, _terms_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms' AS $$
DECLARE actor uuid; rl text; em text; app record; veh record; doc public.documents%ROWTYPE;
  ops integer; h private.historical_agreements_v1; cents integer; dep integer;
BEGIN
  actor := private.approval_actor(); PERFORM private.record_session_v1();
  PERFORM private.approval_lock();
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
       OR h.weekly_cents <> cents OR h.deposit_cents IS DISTINCT FROM dep OR h.terms_summary IS DISTINCT FROM _terms_summary THEN
      RAISE EXCEPTION 'operation_conflict' USING ERRCODE = '42501';
    END IF;
    RETURN private.historical_agreement_result_v1(h, true);
  END IF;
  IF _rental_start IS NULL OR NOT isfinite(_rental_start) OR _rental_start > clock_timestamp() THEN
    RAISE EXCEPTION 'rental_start_invalid'; END IF;
  IF _signed_on IS NULL OR _signed_on < DATE '2000-01-01'
     OR _signed_on > (clock_timestamp() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'signed_on_invalid'; END IF;
  IF _signed_on > (_rental_start AT TIME ZONE 'America/New_York')::date THEN
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
  SELECT count(*) INTO ops FROM public.paper_upload_operations p
   WHERE p.result_document_id = doc.id AND p.state = 'registered' AND p.sha256 = doc.content_sha256 AND p.driver_id = _application_id;
  IF ops <> 1 THEN RAISE EXCEPTION 'paper_provenance_missing'; END IF;
  -- The upload's own attestation must agree: an original, signed on the same date if one was given.
  IF EXISTS (SELECT 1 FROM public.paper_upload_operations p WHERE p.result_document_id = doc.id
             AND (p.agreement_type IS DISTINCT FROM 'original' OR (p.signed_on IS NOT NULL AND p.signed_on <> _signed_on))) THEN
    RAISE EXCEPTION 'paper_attestation_conflict'; END IF;
  -- A pending or signed eSign agreement for this driver contradicts a paper original.
  IF EXISTS (SELECT 1 FROM public.agreements WHERE application_id = _application_id AND rental_id IS NULL) THEN
    RAISE EXCEPTION 'esign_agreement_pending'; END IF;
  IF EXISTS (SELECT 1 FROM private.historical_agreements_v1 WHERE application_id = _application_id AND status = 'registered' AND rental_id IS NULL) THEN
    RAISE EXCEPTION 'historical_agreement_open'; END IF;
  SELECT role::text INTO rl FROM public.user_roles WHERE user_id = actor AND role::text IN ('admin', 'team')
   ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END LIMIT 1;
  SELECT email INTO em FROM auth.users WHERE id = actor;
  INSERT INTO private.historical_agreements_v1 (operation_id, application_id, driver_user_id, vehicle_id, document_id,
    document_sha256, paper_operation_id, signed_on, rental_start, weekly_cents, deposit_cents, terms_summary,
    registered_by, registered_role)
  SELECT _operation_id, _application_id, app.user_id, _vehicle_id, doc.id, doc.content_sha256, p.operation_id,
    _signed_on, _rental_start, cents, dep, btrim(_terms_summary), actor, rl
  FROM public.paper_upload_operations p WHERE p.result_document_id = doc.id AND p.state = 'registered'
  RETURNING * INTO h;
  INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (actor, em, rl, 'historical_agreement.registered', 'application', _application_id::text,
    'Staff-verified historical agreement registered (not an eSign event)',
    private.historical_agreement_result_v1(h, false) - 'recovered');
  RETURN private.historical_agreement_result_v1(h, false);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'historical_agreement_contention_retry' USING ERRCODE = '40001';
END $$;

CREATE FUNCTION public.void_historical_agreement_v1(_historical_agreement_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms' AS $$
DECLARE actor uuid; rl text; em text; h private.historical_agreements_v1;
BEGIN
  actor := private.approval_actor(); PERFORM private.record_session_v1();
  PERFORM private.approval_lock();
  SELECT * INTO h FROM private.historical_agreements_v1 WHERE id = _historical_agreement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'historical_agreement_unavailable'; END IF;
  IF h.status = 'voided' THEN RETURN private.historical_agreement_result_v1(h, true); END IF;
  IF h.rental_id IS NOT NULL THEN RAISE EXCEPTION 'historical_agreement_recorded'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'void_reason_required'; END IF;
  UPDATE private.historical_agreements_v1 SET status = 'voided', voided_by = actor, voided_at = clock_timestamp(),
    void_reason = btrim(_reason) WHERE id = h.id RETURNING * INTO h;
  SELECT role::text INTO rl FROM public.user_roles WHERE user_id = actor AND role::text IN ('admin', 'team')
   ORDER BY CASE WHEN role::text = 'admin' THEN 0 ELSE 1 END LIMIT 1;
  SELECT email INTO em FROM auth.users WHERE id = actor;
  INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (actor, em, rl, 'historical_agreement.voided', 'application', h.application_id::text,
    'Unused historical agreement registration voided', jsonb_build_object('historicalAgreementId', h.id, 'reason', h.void_reason));
  RETURN private.historical_agreement_result_v1(h, false);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'historical_agreement_contention_retry' USING ERRCODE = '40001';
END $$;

CREATE FUNCTION public.historical_agreement_for_record_v1(_application_id uuid)
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

REVOKE ALL ON FUNCTION private.historical_agreement_guard_v1(), private.historical_agreement_no_truncate_v1(),
  private.historical_agreement_result_v1(private.historical_agreements_v1, boolean),
  public.register_historical_agreement_v1(uuid, uuid, uuid, uuid, date, timestamptz, numeric, numeric, text),
  public.void_historical_agreement_v1(uuid, text), public.historical_agreement_for_record_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.register_historical_agreement_v1(uuid, uuid, uuid, uuid, date, timestamptz, numeric, numeric, text),
  public.void_historical_agreement_v1(uuid, text), public.historical_agreement_for_record_v1(uuid)
  TO authenticated;

-- Snapshot: the eSign branch below is the installed text unchanged; the paper branch
-- runs only when no agreements row has id g and a registration does.
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
 FOR item IN SELECT to_jsonb(x) AS j FROM public.agreements x WHERE application_id=a AND rental_id IS NULL ORDER BY id FOR SHARE NOWAIT LOOP
 IF item.j->>'vehicle_id' IS DISTINCT FROM v::text OR item.j->>'status' IS DISTINCT FROM 'signed' THEN RAISE EXCEPTION 'legacy_agreement_conflict';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) INTO linked FROM public.agreements x WHERE application_id=a AND rental_id IS NULL;
 SELECT to_jsonb(x) INTO ag FROM public.agreements x WHERE id=g FOR SHARE NOWAIT;
 SELECT to_jsonb(x) INTO doc FROM public.documents x WHERE id=d FOR SHARE NOWAIT;
 -- Paper evidence may have no eSign row: the immutable registered document is authoritative;
 -- issuer must verify the reviewed paper registration/provenance, never invent an agreement row.
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
   OR jsonb_array_length(linked)<>0
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

-- Consumption: paper evidence must equal the registration exactly; eSign is unchanged.
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
  -- A paper original carries a signing date, not an instant: the evidence states it as
  -- the start of that day in America/New_York, exactly, and nothing finer.
  OR (g->>'signedAt')::timestamptz IS DISTINCT FROM (h.signed_on::timestamp AT TIME ZONE 'America/New_York')
  THEN RAISE EXCEPTION 'historical_agreement_mismatch';END IF;
 END IF;
 RETURN (g->>'provenanceId')::uuid;
END$function$;

-- The registration is linked to the rental in the same transaction that records it.
CREATE FUNCTION private.historical_agreement_consume_v1() RETURNS trigger
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
  INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
  VALUES (NEW.actor_id, 'historical_agreement.recorded', 'rental', NEW.rental_id::text,
    'Rental recorded from a staff-verified historical agreement (not an eSign event)',
    jsonb_build_object('historicalAgreementId', h.id, 'documentId', h.document_id, 'documentSha256', h.document_sha256,
      'signedOn', h.signed_on, 'rentalStart', h.rental_start, 'verification', h.verification, 'operation', NEW.operation_id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.historical_agreement_consume_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER historical_agreement_consume_v1 AFTER INSERT ON private.record_operations
  FOR EACH ROW EXECUTE FUNCTION private.historical_agreement_consume_v1();

COMMIT;
