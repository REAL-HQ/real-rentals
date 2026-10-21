-- LOCAL REHEARSAL ONLY. Apply after packet step 19b and before step 20.
-- Step 3 and step 19b leave private.record_agreement_evidence(uuid, uuid,
-- timestamptz, numeric) as a deny-all. record_existing_rental_tx calls that
-- signature before it activates the rental and stores the returned uuid as the
-- agreement evidence. Returning an unattached uuid is not verification.
-- This body locks the application's unlinked agreements, requires exactly one,
-- and returns that agreement id only when the signed archived document, the
-- storage object, the vehicle, and the recorded terms match the call.
-- Anything else still raises agreement_contract_unverified. The two-argument
-- overload from step 19b is not replaced.

CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE app_id uuid := $1; veh_id uuid := $2; started timestamptz := $3; rate numeric := $4;
 n integer; ag public.agreements%ROWTYPE; doc public.documents%ROWTYPE; terms jsonb; cents numeric;
BEGIN
 IF app_id IS NULL OR veh_id IS NULL OR started IS NULL OR NOT isfinite(started) OR rate IS NULL OR rate<=0 THEN
  RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
 END IF;
 PERFORM private.approval_lock();
 PERFORM 1 FROM public.agreements WHERE application_id=app_id AND rental_id IS NULL FOR SHARE NOWAIT;
 SELECT count(*) INTO n FROM public.agreements WHERE application_id=app_id AND rental_id IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 SELECT * INTO ag FROM public.agreements WHERE application_id=app_id AND rental_id IS NULL;
 terms:=ag.merge_data->'record_rental_terms_v1';
 cents:=round(rate*100);
 IF ag.vehicle_id IS DISTINCT FROM veh_id OR ag.status IS DISTINCT FROM 'signed' OR ag.voided_at IS NOT NULL
  OR ag.archive_status IS DISTINCT FROM 'archived' OR ag.signed_at IS NULL OR NOT isfinite(ag.signed_at) OR ag.signed_at>started
  OR ag.sha256 IS NULL OR ag.sha256 !~ '^[a-f0-9]{64}$' OR ag.body_sha256 IS NULL OR ag.body_sha256 !~ '^[a-f0-9]{64}$'
  OR ag.document_id IS NULL OR ag.completed_document_id IS DISTINCT FROM ag.document_id
  OR ag.application_id IS DISTINCT FROM app_id OR jsonb_typeof(terms) IS DISTINCT FROM 'object'
  OR (terms->>'weeklyCents') !~ '^[0-9]+$' OR (terms->>'weeklyCents')::numeric IS DISTINCT FROM cents
  OR terms->>'currency' IS DISTINCT FROM 'usd'
  OR terms->>'effectiveAt' IS NULL OR (terms->>'effectiveAt')::timestamptz IS DISTINCT FROM started
 THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 SELECT * INTO doc FROM public.documents WHERE id=ag.document_id FOR SHARE NOWAIT;
 IF NOT FOUND OR doc.driver_id IS DISTINCT FROM app_id OR doc.content_sha256 IS DISTINCT FROM ag.sha256
  OR doc.storage_bucket IS NULL OR doc.storage_path IS DISTINCT FROM ('immutable-v1/'||doc.id::text||'/'||ag.sha256||'.pdf')
 THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM storage.objects WHERE bucket_id=doc.storage_bucket AND name=doc.storage_path;
 IF NOT FOUND THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 RETURN ag.id;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) TO rr_record_executor;
