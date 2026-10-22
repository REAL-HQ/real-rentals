-- Rollback for HOSTED-INSTALL step 4: proposed/m2-packet/02.sql
-- Generated from the local catalog difference. Run as the local superuser,
-- after every later step has already been rolled back.
-- This file does not change the install SQL.
BEGIN;
-- policies added by this step
-- policies removed or replaced by this step
-- triggers added by this step
DROP TRIGGER IF EXISTS "safe_release_evidence" ON "public"."incidents";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."incidents";
DROP TRIGGER IF EXISTS "safe_release_evidence" ON "public"."inspection_items";
DROP TRIGGER IF EXISTS "safe_release_history" ON "public"."inspection_items";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."inspection_items";
DROP TRIGGER IF EXISTS "safe_release_evidence" ON "public"."inspections";
DROP TRIGGER IF EXISTS "safe_release_history" ON "public"."inspections";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."inspections";
DROP TRIGGER IF EXISTS "safe_release_evidence" ON "public"."maintenance_records";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."maintenance_records";
DROP TRIGGER IF EXISTS "safe_release_guard" ON "public"."rentals";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."rentals";
DROP TRIGGER IF EXISTS "safe_release_guard" ON "public"."vehicles";
DROP TRIGGER IF EXISTS "safe_release_lock" ON "public"."vehicles";
-- triggers removed or replaced by this step
-- indexes added by this step (constraint indexes drop with the constraint)
-- constraints added by this step, skipping tables this step created
-- constraints replaced or removed by this step
-- indexes removed by this step
-- functions whose bodies changed
CREATE OR REPLACE FUNCTION public.activate_rental_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date, _pickup_miles integer DEFAULT NULL::integer, _actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_app record; v_veh record; v_rental uuid; v_missing text[]; v_hist integer; v_read uuid;
BEGIN
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _end IS NOT NULL AND _end <= _start THEN RAISE EXCEPTION 'invalid_dates'; END IF;
  IF _weekly_rate IS NULL OR _weekly_rate <= 0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
  IF _pickup_miles IS NOT NULL AND (_pickup_miles < 0 OR _pickup_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, status, user_id INTO v_app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.status NOT IN ('approved','active') THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF v_app.user_id IS DISTINCT FROM _driver_id THEN RAISE EXCEPTION 'account_conflict'; END IF;
  SELECT id, status, archived_at INTO v_veh FROM public.vehicles WHERE id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  IF v_veh.archived_at IS NOT NULL OR v_veh.status IN ('archived','sold','retired') THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
  v_missing := public.vehicle_rental_ready_missing(_vehicle_id);
  IF array_length(v_missing,1) > 0 THEN RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(v_missing, ','); END IF;
  IF EXISTS (SELECT 1 FROM public.rentals WHERE vehicle_id = _vehicle_id AND status = 'active') THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF EXISTS (SELECT 1 FROM public.rentals WHERE driver_id = _driver_id AND status = 'active') THEN RAISE EXCEPTION 'already_active'; END IF;
  IF _pickup_miles IS NOT NULL THEN
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = _vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _pickup_miles + 500 < v_hist THEN RAISE EXCEPTION 'pickup_below_history:%', v_hist; END IF;
  END IF;
  INSERT INTO public.rentals (driver_id, vehicle_id, application_id, start_date, end_date, status,
    weekly_rate, deposit_amount, deposit_held, next_payment_due)
  VALUES (_driver_id, _vehicle_id, _application_id, _start, _end, 'active',
    _weekly_rate, COALESCE(_deposit, 0), COALESCE(_deposit_held, false), _start)
  RETURNING id INTO v_rental;
  IF _pickup_miles IS NOT NULL THEN
    v_read := private.rental_mileage_reading(_vehicle_id, v_rental, _driver_id, _pickup_miles, 'rental_checkout', 'pre_delivery', _actor);
    UPDATE public.rentals SET pickup_reading_id = v_read WHERE id = v_rental;
  END IF;
  UPDATE public.vehicles SET status = 'rented' WHERE id = _vehicle_id;
  UPDATE public.applications SET status = 'active', vehicle_id = _vehicle_id WHERE id = _application_id;
  UPDATE public.agreements SET rental_id = v_rental WHERE application_id = _application_id AND rental_id IS NULL;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN v_rental;
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM LIKE '%rentals_one_active_per_vehicle_idx%' THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF SQLERRM LIKE '%rentals_one_active_per_driver_idx%' THEN RAISE EXCEPTION 'already_active'; END IF;
  RAISE;
END $function$;
CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL::integer, _actor uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_pick integer; v_hist integer; v_read uuid;
BEGIN
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN PERFORM set_config('app.rental_tx', 'off', true); RETURN 'already_closed'; END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
  END IF;
  UPDATE public.rentals SET status = 'closed', end_date = _end, autopay_active = false,
    return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
  UPDATE public.vehicles SET status = _vehicle_status WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN 'closed';
END $function$;
-- functions added by this step
DROP FUNCTION IF EXISTS "private"."guard_safe_vehicle_release"();
DROP FUNCTION IF EXISTS "private"."hold_vehicle_on_evidence"();
DROP FUNCTION IF EXISTS "private"."lock_vehicle_release"();
DROP FUNCTION IF EXISTS "private"."preserve_inspection_safety"();
DROP FUNCTION IF EXISTS "private"."vehicle_release_reasons"(_vehicle uuid, _rental uuid);
DROP FUNCTION IF EXISTS "public"."end_rental_safe_v1"(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer, _actor uuid, _release_contract text);
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
