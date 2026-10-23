-- SUPERSEDED on 2026-10-23 by proposed/end-rental-returns-approved-v2.sql.
-- This file is Option A: it left the application at 'active' after the rental
-- ended, which matches no filter in the Drivers list. The owner chose Option B
-- (return to Approved). Kept for the record; do not install.
-- PROPOSED ONLY. This file is not a migration and must not be run from the app.
-- Do not copy it into supabase/migrations or drizzle/migrations.
--
-- Dependency: public.end_rental_tx(uuid, date, text, integer, uuid), installed by
-- supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql,
-- sets applications.status = 'closed' when it sets rentals.status = 'closed'.
--
-- Forward change: the rental still ends in its existing terminal state
-- (rentals.status = 'closed'). The application status is left as it was.
-- Automation cancellation is unchanged.
--
-- Flag: src/lib/end-rental-preserves-application.ts
-- END_RENTAL_PRESERVES_APPLICATION_ENABLED stays false until a person installs
-- this SQL. The application does not call a replacement function while the
-- flag is false.

CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN 'closed';
END $function$;

-- ROLLBACK. Restore the installed function, which also closes the application.
-- Run this block only to undo the proposal above. Do not run it in the same
-- script as the forward change.
--
-- CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
--  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- DECLARE r record; v_pick integer; v_hist integer; v_read uuid;
-- BEGIN
--   PERFORM set_config('app.rental_tx', 'on', true);
--   IF _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
--   IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
--   SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
--   IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
--   IF r.status <> 'active' THEN PERFORM set_config('app.rental_tx', 'off', true); RETURN 'already_closed'; END IF;
--   PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
--   IF _return_miles IS NOT NULL THEN
--     SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
--     IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
--     SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
--     IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
--     v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
--   END IF;
--   UPDATE public.rentals SET status = 'closed', end_date = _end, autopay_active = false,
--     return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
--   UPDATE public.vehicles SET status = _vehicle_status WHERE id = r.vehicle_id;
--   IF r.application_id IS NOT NULL THEN
--     UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
--     UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
--       WHERE application_id = r.application_id AND status = 'active';
--   END IF;
--   PERFORM set_config('app.rental_tx', 'off', true);
--   RETURN 'closed';
-- END $function$;
