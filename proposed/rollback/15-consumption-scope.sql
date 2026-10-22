-- Rollback for HOSTED-INSTALL step 19: proposed/m2-packet/15.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
CREATE OR REPLACE FUNCTION public.record_existing_rental_evidence_v1(token uuid, req jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e private.record_evidence_v1; actor uuid; sess uuid; snap jsonb; result jsonb; g jsonb;
BEGIN
 actor:=private.approval_actor();sess:=private.record_session_v1();
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT * INTO e FROM private.record_evidence_v1 WHERE id=token FOR UPDATE NOWAIT;
 IF e.id IS NULL OR e.actor_id<>actor OR e.session_id<>sess OR e.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'evidence_binding_invalid';END IF;
 -- Recover immutable committed result before checking current mutable documents/freshness.
 SELECT c.result INTO result FROM private.record_evidence_consumed_v1 c WHERE c.evidence_id=token;
 IF FOUND THEN RETURN result || jsonb_build_object('recovered',true);END IF;
 IF e.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'evidence_expired';END IF;
 snap:=private.record_snapshot_v1(e.application_id,(req->>'vehicleId')::uuid,(e.verified->'agreement'->>'id')::uuid,(e.verified->'agreement'->>'documentId')::uuid);
 IF snap IS DISTINCT FROM e.snapshot THEN RAISE EXCEPTION 'evidence_changed';END IF;
 g:=e.verified->'agreement';
 IF (snap->'document'->>'id'=g->>'documentId'
 AND nullif(snap->'document'->>'version','')=g->>'signedVersion'
 AND snap->'document'->>'version'=g->>'currentVersion'
 AND (snap->'document'->>'sha256') ~ '^[a-f0-9]{64}$'
 AND snap->'document'->>'sha256'=g->>'signedHash'
 AND snap->'document'->>'sha256'=g->>'currentHash') IS NOT TRUE
 THEN RAISE EXCEPTION 'authoritative_document_mismatch';END IF;

 INSERT INTO private.record_evidence_context_v1 VALUES(txid_current(),token);
 result:=private.record_existing_rental_evidence_core_v1((req->>'operationId')::uuid,e.application_id,(req->>'vehicleId')::uuid,
 (req->>'startedAt')::timestamptz,(req->>'weeklyRate')::numeric,(req->>'deposit')::numeric,(req->>'pickupMileage')::integer,
 CASE WHEN e.verified->'subscription'='null'::jsonb THEN NULL ELSE token END,req->>'reason');
 INSERT INTO private.record_evidence_consumed_v1 VALUES(token,e.operation_id,result);
 DELETE FROM private.record_evidence_context_v1 WHERE transaction_id=txid_current();
 IF private.approval_actor() IS DISTINCT FROM actor OR private.record_session_v1() IS DISTINCT FROM sess THEN RAISE EXCEPTION 'actor_changed';END IF;
 RETURN result;
END$function$;
-- functions added by this step
-- functions removed by this step
-- columns added by this step
-- columns removed or altered by this step
-- column privileges on objects this step created, before those objects are dropped
-- relations added by this step
-- row level security flags
-- owners
-- privileges captured on the pre-step catalog
-- comments
-- role memberships added by this step
-- roles added by this step
COMMIT;
