-- LOCAL PROPOSAL. Not a migration. Do not run against a hosted database.
-- Install only after the Record Rental payloads that create
-- booking_vehicle_assignments, assignment_closures, record_operations,
-- private.approval_lock(), private.approval_actor(), and rr_record_executor.
-- This file does not create those objects and does not weaken their grants.
--
-- Lock order. Activation (record_existing_rental_tx), closeout
-- (close_recorded_rental_v2), and the evidence issue/consume functions take
-- private.approval_lock() first, then the lifecycle advisory (710026,2),
-- then the application row, then the rental row when one exists, then the
-- vehicle row. Swap uses that same order and then both vehicle rows:
--   1. private.approval_lock()                    advisory (82116,42001)
--   2. pg_try_advisory_xact_lock(710026,2)        lifecycle; fail 40001, no wait
--   3. applications FOR UPDATE NOWAIT
--   4. rentals FOR UPDATE NOWAIT
--   5. both vehicles FOR UPDATE NOWAIT, lower uuid first
--   6. agreement and its document FOR SHARE NOWAIT
--   7. identity-review rows FOR SHARE NOWAIT, then the open assignment
--   8. closure insert, swap operation, replacement assignment
-- Two swaps cannot deadlock each other: the vehicle locks are sorted.
-- This does not certify deadlock freedom against every other lifecycle writer.
-- A lock failure raises 40001. The caller retries the whole operation with the
-- same operation id only after the transaction has rolled back.
--
-- The outgoing vehicle is set to maintenance. This function never writes
-- vehicles.status = 'available'. Clearing that hold stays a separate safety
-- decision. The replacement is marked rented only after the rental pointer
-- moves, while that car is still available, so a safe-release guard can see
-- an available car. There is no status argument. No payment, invoice,
-- deposit, weekly rate, or subscription write.
--
-- Historical intervals are not accepted. effective_at must fall after the
-- single open assignment. Past multi-vehicle intake is not represented by
-- pretending the current replacement was the original vehicle.
--
-- Agreement check below reads private.agreement_evidence from step 19b.
-- Install this file only after that table exists. A signed agreement that
-- was never recorded there is not evidence. The row must name this
-- application and the replacement vehicle, and the agreement's hash,
-- document pointer and signed_at must still match the recorded evidence.
-- signed_at may not be after effective_at. This does not update the
-- agreement or its document.

CREATE SEQUENCE private.swap_number_seq AS bigint MINVALUE 1 NO CYCLE;
CREATE TABLE private.swap_operations (
 operation_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE RESTRICT,
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 swap_number bigint NOT NULL UNIQUE,
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE private.swap_operations OWNER TO rr_record_executor;
ALTER SEQUENCE private.swap_number_seq OWNER TO rr_record_executor;
ALTER TABLE private.swap_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.swap_operations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE private.swap_number_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER swap_operations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.swap_operations
 FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable();

ALTER TABLE public.booking_vehicle_assignments
 ADD COLUMN swap_operation_id uuid REFERENCES private.swap_operations(operation_id);

-- Accepts a step 19b evidence row (by agreement id or evidence id). Does not
-- link the agreement, render a PDF, or accept a browser hash.
CREATE FUNCTION private.swap_agreement_evidence(_agreement uuid, _application uuid, _vehicle uuid, _effective timestamptz)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE ev private.agreement_evidence%ROWTYPE; ag record; doc_id uuid;
BEGIN
 IF _agreement IS NULL THEN RAISE EXCEPTION 'agreement_evidence_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO ev FROM private.agreement_evidence WHERE agreement_id=_agreement FOR SHARE NOWAIT;
 IF NOT FOUND THEN
  SELECT * INTO ev FROM private.agreement_evidence WHERE id=_agreement FOR SHARE NOWAIT;
 END IF;
 IF NOT FOUND OR ev.application_id IS DISTINCT FROM _application OR ev.vehicle_id IS DISTINCT FROM _vehicle
  OR ev.sha256 IS NULL OR ev.sha256 !~ '^[a-f0-9]{64}$' OR ev.document_id IS NULL
  OR ev.signed_at IS NULL OR ev.signed_at>_effective
 THEN RAISE EXCEPTION 'agreement_evidence_required' USING ERRCODE='42501'; END IF;
 SELECT id, application_id, vehicle_id, status, sha256, document_id, completed_document_id, signed_at
  INTO ag FROM public.agreements WHERE id=ev.agreement_id FOR SHARE NOWAIT;
 IF NOT FOUND OR ag.status IS DISTINCT FROM 'signed' OR ag.application_id IS DISTINCT FROM ev.application_id
  OR ag.vehicle_id IS DISTINCT FROM ev.vehicle_id OR ag.sha256 IS DISTINCT FROM ev.sha256
  OR ag.document_id IS DISTINCT FROM ev.document_id OR ag.completed_document_id IS DISTINCT FROM ag.document_id
  OR ag.signed_at IS DISTINCT FROM ev.signed_at
 THEN RAISE EXCEPTION 'agreement_evidence_required' USING ERRCODE='42501'; END IF;
 SELECT id INTO doc_id FROM public.documents WHERE id=ag.document_id FOR SHARE NOWAIT;
 IF doc_id IS NULL THEN RAISE EXCEPTION 'agreement_evidence_required' USING ERRCODE='42501'; END IF;
 RETURN ag.id;
END $$;
REVOKE ALL ON FUNCTION private.swap_agreement_evidence(uuid,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.swap_agreement_evidence(uuid,uuid,uuid,timestamptz) TO rr_record_executor;

-- The only writer of the rental's current vehicle and the outgoing car's status.
-- Callable only from swap_rental_vehicle_tx in the same transaction. Hardcodes
-- maintenance. Refuses an available destination. Writes no billing columns.
CREATE FUNCTION private.swap_project_vehicle_v1(
 _operation uuid, _rental uuid, _old_vehicle uuid, _new_vehicle uuid, _effective timestamptz,
 _return_miles integer, _pickup_miles integer, _actor uuid, _driver uuid, _swap_number bigint, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
BEGIN
 IF current_setting('swap.operation_id', true) IS DISTINCT FROM _operation::text THEN
  RAISE EXCEPTION 'swap_projection_context_required' USING ERRCODE='42501'; END IF;
 UPDATE public.rentals SET vehicle_id=_new_vehicle
  WHERE id=_rental AND status='active' AND vehicle_id=_old_vehicle;
 IF NOT FOUND THEN RAISE EXCEPTION 'rental_projection_rejected' USING ERRCODE='42501'; END IF;
 -- Pointer first, while the replacement is still available. Then rented.
 -- Then the outgoing car. Never available.
 UPDATE public.vehicles SET status='rented' WHERE id=_new_vehicle AND status='available';
 IF EXISTS (SELECT 1 FROM public.vehicles WHERE id=_new_vehicle AND status IS DISTINCT FROM 'rented') THEN
  RAISE EXCEPTION 'replacement_projection_rejected' USING ERRCODE='42501'; END IF;
 UPDATE public.vehicles SET status='maintenance' WHERE id=_old_vehicle AND status IS DISTINCT FROM 'maintenance';
 IF EXISTS (SELECT 1 FROM public.vehicles WHERE id=_old_vehicle AND status IS DISTINCT FROM 'maintenance') THEN
  RAISE EXCEPTION 'outgoing_available_refused' USING ERRCODE='42501'; END IF;
 IF _return_miles IS NOT NULL THEN
  INSERT INTO public.odometer_readings(vehicle_id,mileage,observed_on,observed_at,source_type,source_id,evidence_key,entered_by,rental_id,driver_id)
  VALUES(_old_vehicle,_return_miles,(_effective AT TIME ZONE 'America/New_York')::date,_effective,'rental_return',_rental,
   'swap-return:'||_operation::text||':'||_old_vehicle::text,_actor,_rental,_driver);
 END IF;
 IF _pickup_miles IS NOT NULL THEN
  INSERT INTO public.odometer_readings(vehicle_id,mileage,observed_on,observed_at,source_type,source_id,evidence_key,entered_by,rental_id,driver_id)
  VALUES(_new_vehicle,_pickup_miles,(_effective AT TIME ZONE 'America/New_York')::date,_effective,'rental_checkout',_rental,
   'swap-pickup:'||_operation::text||':'||_new_vehicle::text,_actor,_rental,_driver);
 END IF;
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(_actor,(SELECT string_agg(role::text,',' ORDER BY role::text) FROM public.user_roles WHERE user_id=_actor),
  'rental.vehicle_swapped','rental',_rental::text,'Vehicle swapped; outgoing car held in maintenance; billing unchanged',
  jsonb_build_object('operation',_operation,'swap_number',_swap_number,'outgoing_vehicle',_old_vehicle,
   'replacement_vehicle',_new_vehicle,'outgoing_status','maintenance','billing','unchanged','reason',_reason));
END $$;
REVOKE ALL ON FUNCTION private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamptz,integer,integer,uuid,uuid,bigint,text)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.swap_project_vehicle_v1(uuid,uuid,uuid,uuid,timestamptz,integer,integer,uuid,uuid,bigint,text)
 TO rr_record_executor;

CREATE FUNCTION public.swap_rental_vehicle_tx(
 _operation_id uuid, _rental_id uuid, _expected_assignment_id uuid, _replacement_vehicle_id uuid,
 _effective_at timestamptz, _return_mileage integer, _pickup_mileage integer, _reason text, _agreement_evidence_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; actor_after uuid; req jsonb; op private.swap_operations%ROWTYPE;
 r record; a public.booking_vehicle_assignments%ROWTYPE; app_id uuid; old_vehicle uuid; new_vehicle uuid;
 hist integer; agreement_id uuid; swap_num bigint; new_assignment uuid; result jsonb; record_op uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 actor:=private.approval_actor();
 IF _operation_id IS NULL OR _rental_id IS NULL OR _expected_assignment_id IS NULL OR _replacement_vehicle_id IS NULL
  OR _effective_at IS NULL OR NOT isfinite(_effective_at) OR _effective_at>statement_timestamp()
  OR (_return_mileage IS NOT NULL AND (_return_mileage<0 OR _return_mileage>2000000))
  OR (_pickup_mileage IS NOT NULL AND (_pickup_mileage<0 OR _pickup_mileage>2000000))
  OR length(btrim(coalesce(_reason,'')))<5 OR length(_reason)>500 OR _agreement_evidence_id IS NULL
 THEN RAISE EXCEPTION 'invalid_swap_request'; END IF;
 req:=jsonb_build_object('rental',_rental_id,'expected_assignment',_expected_assignment_id,
  'replacement',_replacement_vehicle_id,'effective_epoch',extract(epoch FROM _effective_at),
  'return_mileage',_return_mileage,'pickup_mileage',_pickup_mileage,'reason',_reason,
  'agreement',_agreement_evidence_id);
 -- 1 then 2. Same keys as activation and closeout. No unbounded wait.
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'swap_contention' USING ERRCODE='40001'; END IF;
 SELECT application_id, vehicle_id INTO app_id, old_vehicle FROM public.rentals WHERE id=_rental_id;
 IF app_id IS NULL THEN RAISE EXCEPTION 'rental_not_found'; END IF;
 -- 3 application, 4 rental.
 PERFORM 1 FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT;
 SELECT id, application_id, vehicle_id, driver_id, status, start_date, weekly_rate, stripe_subscription_id, autopay_active
  INTO r FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR r.application_id IS DISTINCT FROM app_id OR r.vehicle_id IS DISTINCT FROM old_vehicle THEN
  RAISE EXCEPTION 'rental_not_found'; END IF;
 new_vehicle:=_replacement_vehicle_id;
 -- 5 both vehicles, uuid order. A replay may already point at the replacement,
 -- so the same-vehicle rejection waits until after operation recovery.
 IF old_vehicle<new_vehicle THEN
  PERFORM 1 FROM public.vehicles WHERE id=old_vehicle FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.vehicles WHERE id=new_vehicle FOR UPDATE NOWAIT;
 ELSE
  PERFORM 1 FROM public.vehicles WHERE id=new_vehicle FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.vehicles WHERE id=old_vehicle FOR UPDATE NOWAIT;
 END IF;
 actor_after:=private.approval_actor();
 IF actor_after IS DISTINCT FROM actor THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 -- Committed operation wins before any eligibility rejection.
 SELECT * INTO op FROM private.swap_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id IS DISTINCT FROM actor OR op.rental_id IS DISTINCT FROM _rental_id OR op.request IS DISTINCT FROM req THEN
   RAISE EXCEPTION 'operation_conflict' USING ERRCODE='42501'; END IF;
  RETURN op.result||jsonb_build_object('recovered',true);
 END IF;
 IF new_vehicle=old_vehicle THEN RAISE EXCEPTION 'replacement_same_vehicle'; END IF;
 IF r.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
 IF (SELECT count(*) FROM public.booking_vehicle_assignments s
     LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
     WHERE s.rental_id=_rental_id AND c.assignment_id IS NULL)<>1 THEN RAISE EXCEPTION 'assignment_unresolved'; END IF;
 SELECT s.* INTO a FROM public.booking_vehicle_assignments s
  LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
  WHERE s.rental_id=_rental_id AND c.assignment_id IS NULL;
 IF a.id IS DISTINCT FROM _expected_assignment_id OR a.vehicle_id IS DISTINCT FROM r.vehicle_id THEN
  RAISE EXCEPTION 'stale_assignment'; END IF;
 IF _effective_at<=a.assignment_start THEN RAISE EXCEPTION 'invalid_effective_time'; END IF;
 IF r.start_date IS NOT NULL AND (_effective_at AT TIME ZONE 'America/New_York')::date<r.start_date THEN
  RAISE EXCEPTION 'invalid_effective_time'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id=new_vehicle AND archived_at IS NULL AND status='available') THEN
  RAISE EXCEPTION 'vehicle_unavailable'; END IF;
 IF EXISTS (SELECT 1 FROM public.rentals WHERE id<>_rental_id AND vehicle_id=new_vehicle AND status='active')
  OR EXISTS (SELECT 1 FROM public.booking_vehicle_assignments s
    LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
    WHERE s.vehicle_id=new_vehicle AND c.assignment_id IS NULL)
 THEN RAISE EXCEPTION 'vehicle_allocated'; END IF;
 IF to_regprocedure('public.vehicle_rental_ready_missing(uuid)') IS NOT NULL
  AND coalesce(cardinality(public.vehicle_rental_ready_missing(new_vehicle)),1)>0 THEN
  RAISE EXCEPTION 'vehicle_not_ready'; END IF;
 IF _return_mileage IS NOT NULL AND a.pickup_mileage IS NOT NULL AND _return_mileage<a.pickup_mileage THEN
  RAISE EXCEPTION 'return_below_pickup'; END IF;
 SELECT max(mileage) INTO hist FROM public.odometer_readings WHERE vehicle_id=old_vehicle AND status='valid';
 IF _return_mileage IS NOT NULL AND hist IS NOT NULL AND _return_mileage+500<hist THEN RAISE EXCEPTION 'return_below_history'; END IF;
 hist:=NULL;
 SELECT max(mileage) INTO hist FROM public.odometer_readings WHERE vehicle_id=new_vehicle AND status='valid';
 IF _pickup_mileage IS NOT NULL AND hist IS NOT NULL AND _pickup_mileage+500<hist THEN RAISE EXCEPTION 'pickup_below_history'; END IF;
 -- 6 agreement evidence, 7 identity rows and the open assignment. No historical rewrite.
 agreement_id:=private.swap_agreement_evidence(_agreement_evidence_id, app_id, new_vehicle, _effective_at);
 PERFORM 1 FROM public.application_identity_reviews WHERE application_id=app_id FOR SHARE NOWAIT;
 PERFORM 1 FROM public.booking_vehicle_assignments WHERE id=a.id FOR SHARE NOWAIT;
 IF actor IS DISTINCT FROM private.approval_actor() THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501'; END IF;
 SELECT operation_id INTO record_op FROM private.record_operations WHERE rental_id=_rental_id;
 IF record_op IS NULL THEN RAISE EXCEPTION 'record_operation_required'; END IF;
 swap_num:=nextval('private.swap_number_seq');
 new_assignment:=gen_random_uuid();
 result:=jsonb_build_object('contract','vehicle-swap-v1','rentalId',_rental_id,'operationId',_operation_id,
  'closedAssignmentId',a.id,'replacementAssignmentId',new_assignment,'swapNumber',swap_num,
  'outgoingStatus','maintenance','billing','unchanged','recovered',false,'agreementEvidence',agreement_id);
 PERFORM set_config('swap.operation_id', _operation_id::text, true);
 PERFORM private.swap_project_vehicle_v1(_operation_id,_rental_id,old_vehicle,new_vehicle,_effective_at,
  _return_mileage,_pickup_mileage,actor,r.driver_id,swap_num,_reason);
 -- 8 append-only history. Closure first so the replacement interval does not overlap [start,end).
 INSERT INTO private.assignment_closures(assignment_id,assignment_end,return_mileage,actor_id,event_id,reason)
 VALUES(a.id,_effective_at,_return_mileage,actor,_operation_id,_reason);
 INSERT INTO private.swap_operations(operation_id,actor_id,rental_id,request,result,swap_number)
 VALUES(_operation_id,actor,_rental_id,req,result,swap_num);
 INSERT INTO public.booking_vehicle_assignments(
  id,rental_id,vehicle_id,assignment_start,pickup_mileage,assignment_kind,actor_id,operation_id,swap_operation_id)
 VALUES(new_assignment,_rental_id,new_vehicle,_effective_at,_pickup_mileage,'replacement',actor,record_op,_operation_id);
 RETURN result;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'swap_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
ALTER FUNCTION public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamptz,integer,integer,text,uuid) OWNER TO rr_record_executor;
REVOKE ALL ON FUNCTION public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamptz,integer,integer,text,uuid)
 FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.swap_rental_vehicle_tx(uuid,uuid,uuid,uuid,timestamptz,integer,integer,text,uuid)
 TO authenticated;

-- Staff read of append-only assignment rows. Missing on today's database; the
-- caller treats "function does not exist" as an empty history. Direct table
-- access stays revoked.
CREATE FUNCTION public.list_assignment_history_v1(_rental uuid, _vehicle uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE rows jsonb;
BEGIN
 IF _rental IS NULL AND _vehicle IS NULL THEN RAISE EXCEPTION 'history_scope_required'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('admin','team','coordinator')
 ) THEN RAISE EXCEPTION 'staff_required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'vehicleId',a.vehicle_id,
  'vehicle',trim(concat_ws(' ', v.unit_number, v.year::text, v.make, v.model)),
  'start',a.assignment_start,'end',c.assignment_end,
  'mileage',coalesce(c.return_mileage,a.pickup_mileage),
  'swapNumber',s.swap_number,'reason',c.reason,
  'status',CASE WHEN c.assignment_id IS NULL THEN 'open' ELSE 'closed' END
 ) ORDER BY a.assignment_start,a.id), '[]'::jsonb) INTO rows
 FROM public.booking_vehicle_assignments a
 LEFT JOIN private.assignment_closures c ON c.assignment_id=a.id
 LEFT JOIN private.swap_operations s ON s.operation_id=a.swap_operation_id
 LEFT JOIN public.vehicles v ON v.id=a.vehicle_id
 WHERE (_rental IS NULL OR a.rental_id=_rental)
   AND (_vehicle IS NULL OR a.vehicle_id=_vehicle);
 RETURN rows;
END $$;
REVOKE ALL ON FUNCTION public.list_assignment_history_v1(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_assignment_history_v1(uuid,uuid) TO authenticated;
