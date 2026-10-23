-- LOCAL V5: separate authenticated consumption transaction establishes its own scope.
CREATE OR REPLACE FUNCTION public.record_existing_rental_evidence_v1(token uuid, req jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.record_evidence_v1; actor uuid; sess uuid; snap jsonb; result jsonb; g jsonb;
BEGIN
 actor:=private.approval_actor();sess:=private.record_session_v1();
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT * INTO e FROM private.record_evidence_v1 WHERE id=token FOR UPDATE NOWAIT;
 IF e.id IS NULL OR e.actor_id<>actor OR e.session_id<>sess OR e.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'evidence_binding_invalid';END IF;
 -- Scope derives from the locked, actor/session/payload-validated evidence, not caller GUCs.
 PERFORM private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
 PERFORM set_config('record.application_id',e.application_id::text,true);
 PERFORM set_config('record.vehicle_id',e.request->>'vehicleId',true);
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
END$$;
