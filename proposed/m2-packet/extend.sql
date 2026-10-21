-- LOCAL PROPOSAL. Not a migration. Do not run against a hosted database.
--
-- Install after the Record Rental packet (after step 19: the 17 cutover files,
-- then subscription-coordination-v1.sql, then the corrected
-- signed-archive-protection-v1.sql). Needs private.approval_lock and
-- private.approval_actor from step 1, and private.record_immutable from step 3.
-- Independent of proposed/vehicle-swap-v1.sql. If both are approved, either
-- order after step 19 is safe. This file does not create those objects and
-- does not weaken their grants.
--
-- Execute is service_role only. The handler calls with supabaseAdmin after
-- requireManager and passes the actor id. This function checks that actor is
-- a manager before lock 1, then again with FOR SHARE after the rental lock.
-- It does not call private.approval_actor(). That function raises
-- trusted_authentication_context_required for authenticator/service_role
-- instead of returning null, so a post-lock call would reject every manager.
--
-- Lock order, same prefix as activation, closeout, and swap:
--   1. private.approval_lock()                 advisory (82116,42001)
--   2. pg_try_advisory_xact_lock(710026,2)     lifecycle; fail 40001, no wait
--   3. applications FOR UPDATE NOWAIT          only when the rental has one
--   4. rentals FOR UPDATE NOWAIT
--   5. user_roles admin/team FOR SHARE NOWAIT  the passed actor id
-- Recovery of a committed operation is next, then eligibility. The vehicle
-- row is not locked. The lifecycle advisory serializes this with activation,
-- closeout, and swap. That does not certify deadlock freedom against every
-- other writer.
--
-- A lock failure raises 40001 extend_contention_retry_whole_transaction.
-- Retry the whole operation with the same operation id only after rollback.
--
-- The function is installer-owned SECURITY DEFINER. Do not ALTER OWNER to
-- rr_record_executor: the step-9 column grants do not include rentals.end_date.
-- It updates only rentals.end_date. It does not set app.rental_tx, so
-- guard_rental_lifecycle stays in force and still refuses a status change.
-- No payment, deposit, weekly rate, next_payment_due, autopay, or vehicle
-- status write. No Stripe call. billingPlan.stripe.performed is false and
-- proration is none. When a subscription is linked, the logged call is
-- stripe.subscriptions.update with cancel_at and proration_behavior none.
-- The plan stores that link as a boolean. The raw subscription id is not
-- returned and is not written to audit_log. That call is data. This function
-- does not execute it.
--
-- End dates are inclusive, matching rental_at_time. The new end must be
-- strictly after today in Eastern Time. An open-ended rental
-- (end_date null) is rejected. A second active rental on the vehicle cannot
-- exist (rentals_one_active_per_vehicle_idx); the next booking is any other
-- non-terminal rental whose dates meet the extension. An assignment on this
-- vehicle in booking_vehicle_assignments counts the same way: open, or closed
-- after the current end, and starting on or before the new end. This rental's
-- own assignment is not a conflict. Waitlist conflict is an
-- application on this vehicle (applications.vehicle_id; public.waitlist has
-- no vehicle). A hold or waitlist_signed_up_at with no dates fails closed.
-- A bare approved application with no date, hold, or signup is not a conflict.

CREATE TABLE private.extend_operations (
 operation_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE RESTRICT,
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE private.extend_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.extend_operations FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER extend_operations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.extend_operations
 FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable();

CREATE FUNCTION public.extend_rental_tx(
 _operation_id uuid, _rental_id uuid, _expected_end date, _new_end date, _reason text, _actor_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE
 actor uuid; app_id uuid; reason text; req jsonb;
 r public.rentals%ROWTYPE; op private.extend_operations%ROWTYPE;
 extra_days integer; cost numeric; effect text; charges jsonb := '[]'::jsonb;
 cursor date; steps integer := 0; cancel_at timestamptz; cancel_unix bigint;
 plan jsonb; result jsonb; today date;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 -- Manager read before lock 1. The FOR SHARE recheck stays at step 5.
 IF _actor_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id=_actor_id AND role::text IN ('admin','team')
 ) THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 actor:=_actor_id;
 IF _operation_id IS NULL OR _rental_id IS NULL OR _expected_end IS NULL OR _new_end IS NULL
  OR length(btrim(coalesce(_reason,'')))<5 OR length(btrim(_reason))>500
 THEN RAISE EXCEPTION 'invalid_extend_request'; END IF;
 reason:=btrim(_reason);
 -- 1 then 2. Same keys as activation and closeout. No unbounded wait.
 PERFORM private.approval_lock();
 IF NOT pg_catalog.pg_try_advisory_xact_lock(710026,2) THEN
  RAISE EXCEPTION 'extend_contention_retry_whole_transaction' USING ERRCODE='40001'; END IF;
 SELECT application_id INTO app_id FROM public.rentals WHERE id=_rental_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
 -- 3 application when present, 4 rental.
 IF app_id IS NOT NULL THEN
  PERFORM 1 FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 END IF;
 SELECT * INTO r FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
 IF r.application_id IS DISTINCT FROM app_id THEN
  RAISE EXCEPTION 'extend_contention_retry_whole_transaction' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 req:=jsonb_build_object('rental',_rental_id,'expected_end',_expected_end,'new_end',_new_end,
  'reason',reason,'weekly_rate',r.weekly_rate);
 -- Committed operation wins before any eligibility rejection.
 SELECT * INTO op FROM private.extend_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id IS DISTINCT FROM actor OR op.rental_id IS DISTINCT FROM _rental_id OR op.request IS DISTINCT FROM req THEN
   RAISE EXCEPTION 'operation_conflict' USING ERRCODE='42501'; END IF;
  RETURN op.result||jsonb_build_object('recovered',true);
 END IF;
 IF r.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
 IF r.end_date IS NULL THEN RAISE EXCEPTION 'end_date_required'; END IF;
 IF r.end_date IS DISTINCT FROM _expected_end THEN RAISE EXCEPTION 'stale_end'; END IF;
 IF r.weekly_rate IS NULL OR r.weekly_rate<=0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
 today:=(statement_timestamp() AT TIME ZONE 'America/New_York')::date;
 IF _new_end<=today THEN RAISE EXCEPTION 'end_before_today'; END IF;
 IF _new_end<=r.end_date THEN RAISE EXCEPTION 'end_not_extended'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.rentals o
  WHERE o.vehicle_id=r.vehicle_id AND o.id<>r.id
   AND o.status NOT IN ('closed','ended','completed','returned','finished','cancelled','canceled','void','voided')
   AND o.start_date<=_new_end
   AND (o.end_date IS NULL OR o.end_date>r.end_date)
 ) THEN RAISE EXCEPTION 'vehicle_conflict_booking'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.booking_vehicle_assignments s
  LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
  WHERE s.vehicle_id=r.vehicle_id AND s.rental_id IS DISTINCT FROM r.id
   AND (s.assignment_start AT TIME ZONE 'America/New_York')::date<=_new_end
   AND (c.assignment_id IS NULL OR (c.assignment_end AT TIME ZONE 'America/New_York')::date>r.end_date)
 ) THEN RAISE EXCEPTION 'vehicle_conflict_booking'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.applications a
  WHERE a.vehicle_id=r.vehicle_id AND a.deleted_at IS NULL AND a.id IS DISTINCT FROM r.application_id
   AND a.status NOT IN ('declined','closed','duplicate','suspended','complete','completed','cancelled','canceled')
   AND (
    (COALESCE(a.pickup_date,a.start_date)>r.end_date AND COALESCE(a.pickup_date,a.start_date)<=_new_end)
    OR EXISTS (SELECT 1 FROM public.application_waitlist_holds h WHERE h.application_id=a.id AND h.removed_at IS NULL)
    OR a.waitlist_signed_up_at IS NOT NULL
   )
 ) THEN RAISE EXCEPTION 'vehicle_conflict_waitlist'; END IF;
 extra_days:=_new_end-r.end_date;
 cost:=round(r.weekly_rate*extra_days/7,2);
 IF r.next_payment_due IS NULL THEN effect:='no_next_charge_recorded';
 ELSIF r.next_payment_due>_new_end THEN effect:='next_charge_after_new_end';
 ELSIF r.next_payment_due>r.end_date THEN effect:='next_charge_now_inside_term';
 ELSE effect:='next_charge_unchanged'; END IF;
 IF r.next_payment_due IS NOT NULL THEN
  cursor:=r.next_payment_due;
  WHILE cursor<=_new_end LOOP
   IF cursor>r.end_date THEN charges:=charges||jsonb_build_array(to_char(cursor,'YYYY-MM-DD')); END IF;
   cursor:=cursor+7;
   steps:=steps+1;
   IF steps>400 THEN RAISE EXCEPTION 'billing_horizon_too_long'; END IF;
  END LOOP;
 END IF;
 cancel_at:=((_new_end+1)::timestamp AT TIME ZONE 'America/New_York')-interval '1 second';
 cancel_unix:=floor(extract(epoch FROM cancel_at))::bigint;
 plan:=jsonb_build_object(
  'effect',effect,
  'nextPaymentDue',CASE WHEN r.next_payment_due IS NULL THEN NULL::text ELSE to_char(r.next_payment_due,'YYYY-MM-DD') END,
  'includedCharges',charges,
  'cancelAt',cancel_at,
  'proration','none',
  'stripe',jsonb_build_object(
   'performed',false,
   'linked',r.stripe_subscription_id IS NOT NULL,
   'call',CASE WHEN r.stripe_subscription_id IS NULL THEN NULL::text ELSE 'stripe.subscriptions.update' END,
   'params',CASE WHEN r.stripe_subscription_id IS NULL THEN NULL::jsonb ELSE jsonb_build_object(
    'cancel_at',cancel_unix,'proration_behavior','none') END
  )
 );
 UPDATE public.rentals SET end_date=_new_end
  WHERE id=_rental_id AND status='active' AND end_date IS NOT DISTINCT FROM _expected_end;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_end'; END IF;
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,(SELECT string_agg(role::text,',' ORDER BY role::text) FROM public.user_roles WHERE user_id=actor),
  'rental.extended','rental',_rental_id::text,'Extended rental end date',
  jsonb_build_object('operation',_operation_id,'previous_end',to_char(r.end_date,'YYYY-MM-DD'),
   'new_end',to_char(_new_end,'YYYY-MM-DD'),'reason',reason,'extension_cost',cost,'billing_plan',plan));
 result:=jsonb_build_object(
  'contract','extend-rental-v1','rentalId',_rental_id,'operationId',_operation_id,
  'previousEnd',to_char(r.end_date,'YYYY-MM-DD'),'newEnd',to_char(_new_end,'YYYY-MM-DD'),
  'extraDays',extra_days,'extraWeeks',(extra_days::numeric/7),'weeklyRate',r.weekly_rate,
  'extensionCost',cost,'billingPlan',plan,'recovered',false);
 INSERT INTO private.extend_operations(operation_id,actor_id,rental_id,request,result)
 VALUES(_operation_id,actor,_rental_id,req,result);
 RETURN result;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'extend_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.extend_rental_tx(uuid,uuid,date,date,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_rental_tx(uuid,uuid,date,date,text,uuid) TO service_role;
