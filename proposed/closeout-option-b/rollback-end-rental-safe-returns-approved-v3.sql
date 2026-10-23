-- Rollback for end-rental-safe-returns-approved-v3.sql.
--
-- Restores public.end_rental_safe_v1 exactly as HOSTED-INSTALL step 4
-- installs it, so the closeout writes applications.status = 'closed' again.
--
-- GENERATED from proposed/m2-packet/02.sql by scripts/closeout-option-b-v3.mjs.
-- One transaction. Run with ON_ERROR_STOP and without psql -1.
BEGIN;
CREATE OR REPLACE FUNCTION public.end_rental_safe_v1(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL, _release_contract text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE r record; v_pick integer; v_hist integer; v_read uuid; reasons text[]; destination text; role_name text;
BEGIN
  IF _release_contract IS DISTINCT FROM 'safe-release-v1' THEN RAISE EXCEPTION 'safe_release_client_required'; END IF;
  SELECT role::text INTO role_name FROM public.user_roles WHERE user_id=_actor AND role IN ('admin','team') ORDER BY role LIMIT 1;
  IF role_name IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'safe_release_requires_read_committed'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(710026,2);
  PERFORM pg_catalog.set_config('app.rental_tx', 'on', true);
  IF _vehicle_status IS NULL OR _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN PERFORM pg_catalog.set_config('app.rental_tx', 'off', true); RETURN pg_catalog.jsonb_build_object('contract','safe-release-v1','alreadyClosed',true); END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  reasons:=private.vehicle_release_reasons(r.vehicle_id,_rental_id);
  IF _vehicle_status='maintenance' THEN reasons:=pg_catalog.array_append(reasons,'Staff requested maintenance'); END IF;
  destination:=CASE WHEN pg_catalog.cardinality(reasons)=0 THEN 'available' ELSE 'maintenance' END;
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT pg_catalog.max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
  END IF;
  UPDATE public.rentals SET status = 'closed', end_date = _end,
    return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
  UPDATE public.vehicles SET status = destination WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM pg_catalog.set_config('app.rental_tx', 'off', true);
  INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
   VALUES(_actor,role_name,'rental.ended','rental',_rental_id::text,'Rental closed with verified vehicle disposition',pg_catalog.jsonb_build_object('vehicle_id',r.vehicle_id,'driver_id',r.driver_id,'vehicle_status',destination,'release_reasons',reasons,'billing','unchanged_unverified'));
  RETURN pg_catalog.jsonb_build_object('contract','safe-release-v1','alreadyClosed',false,'vehicleStatus',destination,'releaseReasons',reasons,'billing','unchanged_unverified');
END $function$;
COMMIT;
