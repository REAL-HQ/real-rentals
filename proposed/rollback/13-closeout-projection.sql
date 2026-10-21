-- Rollback for HOSTED-INSTALL step 17: proposed/m2-packet/13.sql
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
CREATE OR REPLACE FUNCTION public.close_recorded_rental_v2(_operation_id uuid, _rental_id uuid, _ended_at timestamp with time zone, _vehicle_status text, _return_miles integer, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '500ms'
AS $function$
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
 SELECT application_id INTO appid FROM public.rentals WHERE id=_rental_id;
 IF appid IS NOT NULL THEN PERFORM 1 FROM public.applications WHERE id=appid FOR UPDATE NOWAIT;END IF;
 SELECT * INTO r FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT;
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
END $function$;
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
