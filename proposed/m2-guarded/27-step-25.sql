-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Apply aft', 'er HOSTED-INSTALL step 24: proposed/m2-packet/19b.sql, and before HOSTED-INSTALL step 26: proposed/m2-packet/20.sql. A hosted run follows proposed/HOSTED-INSTALL.md.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'cb207e07ceadb4d78b04d4039b4d316340b9759795539233b2b05652b1033f62', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'cb207e07ceadb4d78b04d4039b4d316340b9759795539233b2b05652b1033f62';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 4324), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '7d7ce32780f39cf93721f66f68e52ab24db334767fcafa26d4e8a2fafa69ae8c';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 4324) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- Apply after HOSTED-INSTALL step 24: proposed/m2-packet/19b.sql, and before HOSTED-INSTALL step 26: proposed/m2-packet/20.sql. A hosted run follows proposed/HOSTED-INSTALL.md.
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;
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
  OR doc.storage_bucket IS DISTINCT FROM 'rental-agreements'
  OR doc.storage_path IS DISTINCT FROM ('immutable-v1/'||doc.id::text||'/'||ag.sha256||'.pdf')
 THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 -- The object must be in the rental-agreements bucket, at that path, and its
 -- user_metadata sha must be the agreement sha. supabase-js stores the upload
 -- metadata option there. The metadata column is system data and is not a
 -- fallback. A path with no hash, or a hash in another bucket, is not the file.
 IF (SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id='rental-agreements' AND o.name=doc.storage_path
       AND lower(btrim(coalesce(o.user_metadata->>'sha256', o.user_metadata->>'content_sha256')))=ag.sha256)<>1
 THEN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END IF;
 RETURN ag.id;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) TO rr_record_executor;
COMMIT;
