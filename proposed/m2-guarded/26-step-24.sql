-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- Proposed ', 'packet step. Not a migration. A hosted run follows proposed/HOSTED-INSTALL.md.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '99a7c30408a69e6de7b96b2b747a7180800c71412b7d38f726138e4f0b72ba84', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '99a7c30408a69e6de7b96b2b747a7180800c71412b7d38f726138e4f0b72ba84';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 12933), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'af1f5b28d91b774a1bd0e39fe26668fc487b15c3f4a6ed3662b1c911b0d12384';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 12933) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- Proposed packet step. Not a migration. A hosted run follows proposed/HOSTED-INSTALL.md.
-- NOT EXECUTED.
--
-- Install after proposed/m2-packet/19.sql (HOSTED-INSTALL step 23)
-- and before proposed/m2-packet/20.sql (HOSTED-INSTALL step 26).
-- The swap SQL lives only in that file. proposed/vehicle-swap-v1.sql is a
-- pointer, not a source.
-- Requires private.record_immutable() from proposed/m2-packet/03.sql
-- (HOSTED-INSTALL step 5), and private.approval_lock() /
-- private.approval_actor() from proposed/m2-packet/01.sql
-- (HOSTED-INSTALL step 1).
-- This file does not replace those functions and does not weaken their grants.
--
-- private.record_agreement_evidence(uuid, uuid, timestamptz, numeric) stays a
-- deny-all. record_existing_rental_tx calls that signature and must keep
-- failing closed. Opening it would treat a returned uuid as verified evidence
-- with no document. CREATE OR REPLACE keeps that body, that owner, and the
-- rr_record_executor grant. The manager path is a new two-argument overload.
-- Do not grant the two-argument function to rr_record_executor.
--
-- The new function records evidence for an agreement that is already signed
-- and archived. It loads the agreement itself. The caller cannot supply a
-- hash. The recorded vehicle is the car named on that agreement, which may
-- already be the replacement while the rental still points at the previous
-- car. It does not render, send, or update the agreement or its document,
-- so signed-archive and document-integrity protections are not written here.
--
-- Lock order, same keys as the swap, source order strictly increasing.
-- One vehicle: the rental's current car. This does not certify deadlock
-- freedom against every other lifecycle writer.
--   1. private.approval_lock()                         advisory (82116,42001)
--   2. pg_catalog.pg_try_advisory_xact_lock(710026,2)  lifecycle; fail 40001, no wait
--   3. applications FOR UPDATE NOWAIT
--   4. rentals FOR UPDATE NOWAIT
--   5. the rental's current vehicle FOR UPDATE NOWAIT
--   6. agreements FOR SHARE NOWAIT, then documents FOR SHARE NOWAIT
--   7. application_identity_reviews FOR SHARE NOWAIT
--   then approval_actor() again and user_roles admin/team FOR SHARE NOWAIT
--   then existing-evidence recovery, then eligibility
-- A lock failure raises 40001. The caller retries the whole call only after
-- the transaction has rolled back. Same agreement and rental returns the
-- stored row with recovered true and does not write a second audit.
-- Does not set app.rental_tx. No charge, invoice, deposit, or subscription write.
-- Swap step 20 reads this table from private.swap_agreement_evidence.
-- This file does not replace that function.
--
-- Re-applying this file after step 19c would replace the four-argument
-- record_agreement_evidence with the deny-all stub below, then fail when
-- the table already exists. The guard runs first and refuses, so that
-- replace does not start.

DO $$ BEGIN
 IF to_regclass('private.agreement_evidence') IS NOT NULL THEN
  RAISE EXCEPTION 'agreement_evidence_already_installed';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) RETURNS uuid
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) TO rr_record_executor;

CREATE TABLE private.agreement_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agreement_id uuid NOT NULL UNIQUE REFERENCES public.agreements(id) ON DELETE RESTRICT,
 rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE RESTRICT,
 application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 signed_at timestamptz NOT NULL CHECK (isfinite(signed_at)),
 signer_user_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE private.agreement_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.agreement_evidence FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER agreement_evidence_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON private.agreement_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable();

CREATE FUNCTION private.record_agreement_evidence(_rental_id uuid, _agreement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; actor_after uuid; app_id uuid; signer_id uuid; app_deleted timestamptz;
 r record; ag record; doc_id uuid; existing private.agreement_evidence%ROWTYPE; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 IF _rental_id IS NULL OR _agreement_id IS NULL THEN RAISE EXCEPTION 'invalid_evidence_request'; END IF;
 actor:=private.approval_actor();
 -- 1 then 2. Same keys as activation, closeout, and swap. No unbounded wait.
 PERFORM private.approval_lock();
 IF NOT pg_catalog.pg_try_advisory_xact_lock(710026,2) THEN
  RAISE EXCEPTION 'agreement_evidence_contention_retry_whole_transaction' USING ERRCODE='40001';
 END IF;
 SELECT application_id INTO app_id FROM public.rentals WHERE id=_rental_id;
 IF app_id IS NULL THEN RAISE EXCEPTION 'rental_not_found'; END IF;
 -- 3 application, 4 rental, 5 the rental's current vehicle.
 PERFORM 1 FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT user_id, deleted_at INTO signer_id, app_deleted FROM public.applications WHERE id=app_id;
 SELECT id, application_id, vehicle_id, status INTO r FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR r.application_id IS DISTINCT FROM app_id OR r.vehicle_id IS NULL THEN
  RAISE EXCEPTION 'rental_not_found'; END IF;
 PERFORM 1 FROM public.vehicles WHERE id=r.vehicle_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
 -- 6 agreement, then its document. 7 identity reviews. Zero review rows is fine.
 SELECT id, application_id, vehicle_id, status, sha256, document_id, completed_document_id, signed_at, archive_status
  INTO ag FROM public.agreements WHERE id=_agreement_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'agreement_not_found'; END IF;
 SELECT id INTO doc_id FROM public.documents WHERE id=ag.document_id FOR SHARE NOWAIT;
 PERFORM 1 FROM public.application_identity_reviews WHERE application_id=app_id FOR SHARE NOWAIT;
 actor_after:=private.approval_actor();
 IF actor_after IS DISTINCT FROM actor THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 -- Committed evidence wins before any eligibility rejection. Any manager may recover.
 SELECT * INTO existing FROM private.agreement_evidence WHERE agreement_id=_agreement_id;
 IF FOUND THEN
  IF existing.rental_id IS DISTINCT FROM _rental_id THEN RAISE EXCEPTION 'evidence_conflict' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
   'contract','agreement-evidence-v1',
   'evidenceId',existing.id,
   'rentalId',existing.rental_id,
   'agreementId',existing.agreement_id,
   'applicationId',existing.application_id,
   'vehicleId',existing.vehicle_id,
   'documentId',existing.document_id,
   'sha256',existing.sha256,
   'signedAt',existing.signed_at,
   'signerUserId',existing.signer_user_id,
   'recovered',true);
 END IF;
 IF r.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
 IF app_deleted IS NOT NULL THEN RAISE EXCEPTION 'application_deleted'; END IF;
 IF signer_id IS NULL THEN RAISE EXCEPTION 'signer_identity_required' USING ERRCODE='42501'; END IF;
 IF ag.status IS DISTINCT FROM 'signed'
  OR ag.archive_status IS DISTINCT FROM 'archived'
  OR ag.sha256 IS NULL OR ag.sha256 !~ '^[a-f0-9]{64}$'
  OR ag.document_id IS NULL OR ag.completed_document_id IS DISTINCT FROM ag.document_id
  OR ag.signed_at IS NULL OR NOT isfinite(ag.signed_at)
  OR ag.application_id IS DISTINCT FROM r.application_id
  OR ag.vehicle_id IS NULL
  OR doc_id IS NULL
 THEN RAISE EXCEPTION 'agreement_evidence_required' USING ERRCODE='42501'; END IF;
 INSERT INTO private.agreement_evidence(
  agreement_id, rental_id, application_id, vehicle_id, document_id, sha256, signed_at, signer_user_id, actor_id)
 VALUES (
  ag.id, r.id, r.application_id, ag.vehicle_id, ag.document_id, ag.sha256, ag.signed_at, signer_id, actor)
 RETURNING * INTO existing;
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES (actor,
  (SELECT string_agg(role::text,',' ORDER BY role::text) FROM public.user_roles WHERE user_id=actor),
  'rental.agreement_evidence_linked','rental',r.id::text,
  'Replacement agreement evidence linked',
  jsonb_build_object('agreement',existing.agreement_id,'vehicle',existing.vehicle_id,
   'document',existing.document_id,'sha256',existing.sha256,'signer_user_id',existing.signer_user_id));
 result:=jsonb_build_object(
  'contract','agreement-evidence-v1',
  'evidenceId',existing.id,
  'rentalId',existing.rental_id,
  'agreementId',existing.agreement_id,
  'applicationId',existing.application_id,
  'vehicleId',existing.vehicle_id,
  'documentId',existing.document_id,
  'sha256',existing.sha256,
  'signedAt',existing.signed_at,
  'signerUserId',existing.signer_user_id,
  'recovered',false);
 RETURN result;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'agreement_evidence_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.link_replacement_agreement_v1(_rental_id uuid, _agreement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN
 RETURN private.record_agreement_evidence(_rental_id, _agreement_id);
END $$;
-- The app does not call this wrapper. src and the record-rental transport
-- call record_existing_rental_evidence_v1 instead. The authenticated path
-- is link_replacement_agreement_checked, which calls this function after
-- the JWT actor check. Restrict this one to rr_record_executor, same as
-- the private record helpers. The two-argument private function stays
-- ungranted to that role. This public definer runs as the installer, so
-- the installer-owned checked function can enter it and still pass
-- approval_actor under the authenticated gateway. A session whose current
-- role is only rr_record_executor cannot.
REVOKE ALL ON FUNCTION public.link_replacement_agreement_v1(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_replacement_agreement_v1(uuid,uuid) TO rr_record_executor;

-- Staff JWT path, same shape as approve_application_checked. The actor is
-- private.approval_actor(), which reads the caller JWT (sub, session, exp)
-- and requires user_roles admin or team. The lock and the second actor
-- read match that function. The explicit user_roles check is the same
-- manager gate the recorder uses. Coordinator is not a manager for this
-- write. PUBLIC, anon, and service_role have no EXECUTE. v1 stays
-- executor-only. This function stays owned by the installer so it can
-- call v1 without a new grant.
CREATE FUNCTION public.link_replacement_agreement_checked(_rental_id uuid, _agreement_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid;
BEGIN
 actor:=private.approval_actor();
 PERFORM private.approval_lock();
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 RETURN public.link_replacement_agreement_v1(_rental_id, _agreement_id);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'agreement_evidence_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.link_replacement_agreement_checked(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.link_replacement_agreement_checked(uuid,uuid) TO authenticated;
