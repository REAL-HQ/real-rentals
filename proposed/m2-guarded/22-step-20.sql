-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- LOCAL V5:', ' scope lookup only; no business data returned, no DML, no API EXECUTE.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '26dba8eae27afb84a5fcdbb83d2ef6718f7ca1d3f750f4ea26ded2349875fc7b', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '26dba8eae27afb84a5fcdbb83d2ef6718f7ca1d3f750f4ea26ded2349875fc7b';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 7324), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '09f339e76fd669c9a949c5f995214fe55ae2ebc725d0c9be33833defde04d2bc';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 7324) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- LOCAL V5: scope lookup only; no business data returned, no DML, no API EXECUTE.
CREATE FUNCTION private.record_close_scope_v5(rental uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; sess uuid; app uuid; vehicle uuid;
BEGIN
 actor:=private.approval_actor(); sess:=private.record_session_v1();
 PERFORM private.approval_lock();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required'; END IF;
 SELECT application_id,vehicle_id INTO app,vehicle FROM public.rentals WHERE id=rental FOR SHARE NOWAIT;
 IF NOT FOUND OR app IS NULL OR vehicle IS NULL THEN RAISE EXCEPTION 'rental_scope_unavailable'; END IF;
 IF actor IS DISTINCT FROM private.approval_actor() OR sess IS DISTINCT FROM private.record_session_v1() THEN RAISE EXCEPTION 'session_changed'; END IF;
 PERFORM set_config('record.application_id',app::text,true);
 PERFORM set_config('record.vehicle_id',vehicle::text,true);
END $$;
REVOKE ALL ON FUNCTION private.record_close_scope_v5(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_close_scope_v5(uuid) TO rr_record_executor;
-- LOCAL VERSIONED PROJECTION AMENDMENT ONLY; ownership, ACL and lifecycle remain unchanged.
CREATE OR REPLACE FUNCTION public.close_recorded_rental_v2(
 _operation_id uuid,_rental_id uuid,_ended_at timestamptz,_vehicle_status text,_return_miles integer,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; req jsonb; op private.record_close_operations%ROWTYPE; r record; a record;
 appid uuid; pickup integer; hist integer; reading uuid; outcome jsonb; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required';END IF;
 actor:=private.approval_actor();
 IF _operation_id IS NULL OR _rental_id IS NULL OR _ended_at IS NULL OR NOT isfinite(_ended_at)
 OR _ended_at>statement_timestamp() OR _vehicle_status IS NULL OR _vehicle_status NOT IN ('available','maintenance')
 OR (_return_miles IS NOT NULL AND (_return_miles<0 OR _return_miles>2000000))
 OR length(btrim(coalesce(_reason,'')))<5 OR length(_reason)>500 THEN RAISE EXCEPTION 'invalid_close_request';END IF;
 req:=jsonb_build_object('rental',_rental_id,'end_epoch',extract(epoch FROM _ended_at),
 'vehicle_status',_vehicle_status,'return_miles',_return_miles,'reason',_reason);
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'close_contention' USING ERRCODE='40001';END IF;
 PERFORM private.record_close_scope_v5(_rental_id);
 SELECT application_id INTO appid FROM public.rentals WHERE id=_rental_id;
 IF appid IS NOT NULL THEN PERFORM 1 FROM public.applications WHERE id=appid FOR UPDATE NOWAIT;END IF;
 SELECT id,application_id,vehicle_id,status,pickup_reading_id,driver_id INTO r FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found';END IF;
 PERFORM 1 FROM public.vehicles WHERE id=r.vehicle_id FOR UPDATE NOWAIT;
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed';END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required';END IF;
 SELECT * INTO op FROM private.record_close_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id IS DISTINCT FROM actor OR op.rental_id IS DISTINCT FROM _rental_id OR op.request IS DISTINCT FROM req
   THEN RAISE EXCEPTION 'operation_conflict';END IF;
  RETURN op.result||jsonb_build_object('recovered',true);
 END IF;
 IF r.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'close_operation_unresolved';END IF;
 IF (SELECT count(*) FROM public.booking_vehicle_assignments s LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
 WHERE s.rental_id=_rental_id AND c.assignment_id IS NULL)<>1 THEN RAISE EXCEPTION 'assignment_unresolved';END IF;
 SELECT s.* INTO a FROM public.booking_vehicle_assignments s LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
 WHERE s.rental_id=_rental_id AND c.assignment_id IS NULL;
 IF a.vehicle_id IS DISTINCT FROM r.vehicle_id OR _ended_at<=a.assignment_start
 OR (_return_miles IS NOT NULL AND a.pickup_mileage IS NOT NULL AND _return_miles<a.pickup_mileage)
 THEN RAISE EXCEPTION 'invalid_assignment_close';END IF;
 -- Same mileage tolerance as pinned closeout; write actual effective time, not helper's NOW().
 SELECT mileage INTO pickup FROM public.odometer_readings WHERE id=r.pickup_reading_id;
 IF _return_miles IS NOT NULL AND pickup IS NOT NULL AND _return_miles<pickup THEN RAISE EXCEPTION 'return_below_pickup';END IF;
 SELECT max(mileage) INTO hist FROM public.odometer_readings WHERE vehicle_id=r.vehicle_id AND status='valid';
 IF _return_miles IS NOT NULL AND hist IS NOT NULL AND _return_miles+500<hist THEN RAISE EXCEPTION 'return_below_history';END IF;
 INSERT INTO private.record_close_context VALUES(_rental_id,txid_current(),actor,_operation_id);
 INSERT INTO private.assignment_closures(assignment_id,assignment_end,return_mileage,actor_id,event_id,reason)
 VALUES(a.id,_ended_at,_return_miles,actor,_operation_id,_reason);
 IF _return_miles IS NOT NULL THEN
 INSERT INTO public.odometer_readings(vehicle_id,mileage,observed_on,observed_at,source_type,source_id,evidence_key,entered_by,rental_id,driver_id)
 VALUES(r.vehicle_id,_return_miles,(_ended_at AT TIME ZONE 'America/New_York')::date,_ended_at,'rental_return',_rental_id,
 'rental_return:'||_rental_id,actor,_rental_id,r.driver_id) RETURNING id INTO reading;
 END IF;
 -- Lifecycle still computes maintenance/safety disposition, closes application and stops automations.
 outcome:=public.end_rental_safe_v1(_rental_id,(_ended_at AT TIME ZONE 'America/New_York')::date,_vehicle_status,NULL,actor,'safe-release-v1');
 IF outcome->>'contract' IS DISTINCT FROM 'safe-release-v1' OR (outcome->>'alreadyClosed')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'unexpected_lifecycle_result';END IF;
 IF reading IS NOT NULL THEN UPDATE public.rentals SET return_reading_id=reading WHERE id=_rental_id;END IF;
 result:=jsonb_build_object('contract','record-close-v2','rentalId',_rental_id,'operationId',_operation_id,
 'assignmentId',a.id,'vehicleStatus',outcome->>'vehicleStatus','releaseReasons',outcome->'releaseReasons',
 'recovered',false,'billing','unchanged');
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,(SELECT string_agg(role::text,',' ORDER BY role::text) FROM public.user_roles WHERE user_id=actor),
 'rental.closed_recorded_v2','rental',_rental_id::text,'Recorded rental closed; billing unchanged',
 jsonb_build_object('operation',_operation_id,'assignment',a.id,'request',req,'outcome',result));
 INSERT INTO private.record_close_operations(operation_id,actor_id,rental_id,request,result) VALUES(_operation_id,actor,_rental_id,req,result);
 DELETE FROM private.record_close_context WHERE rental_id=_rental_id;
 RETURN result;
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'close_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
