-- Vehicle swap: the new car's insurance card is optional (Dolmar t549u/t550u, Nov 21 2026:
-- "Dont make it required"). Replaces complete_rental_vehicle_swap_tx without the
-- swap_insurance_missing check. Everything else in the function is unchanged
-- (copied verbatim from 20261120171500_rental_vehicle_swaps.sql). The
-- rental_vehicle_swap_documents table and the insurance_override_* columns stay
-- (uploads remain optional; the override is no longer used).
-- Rollback: re-run the CREATE OR REPLACE FUNCTION from 20261120171500.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.complete_rental_vehicle_swap_tx(
  _swap_id uuid,
  _from_vehicle_status text,
  _return_miles integer,
  _pickup_miles integer,
  _return_fuel text,
  _pickup_fuel text,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '2s' AS $$
DECLARE
  s public.rental_vehicle_swaps%ROWTYPE;
  r record;
  ag record;
  newv record;
  missing text[];
  v_pick integer;
  v_hist integer;
  v_return uuid;
  v_pickup uuid;
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF _from_vehicle_status IS NULL OR _from_vehicle_status NOT IN ('available','maintenance') THEN
    RAISE EXCEPTION 'invalid_vehicle_status';
  END IF;
  IF (_return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 1999999))
     OR (_pickup_miles IS NOT NULL AND (_pickup_miles < 0 OR _pickup_miles > 1999999)) THEN
    RAISE EXCEPTION 'invalid_mileage';
  END IF;

  BEGIN
    SELECT * INTO s FROM public.rental_vehicle_swaps WHERE id = _swap_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'swap_contention' USING ERRCODE = '40001';
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'swap_not_found'; END IF;
  IF s.status = 'completed' THEN
    RETURN jsonb_build_object('result','already_completed','swap_id',s.id,'swap_number',s.swap_number,
      'rental_id',s.rental_id,'from_vehicle_id',s.from_vehicle_id,'to_vehicle_id',s.to_vehicle_id,
      'from_vehicle_status',s.from_vehicle_status,'return_reading_id',s.return_reading_id,'pickup_reading_id',s.pickup_reading_id);
  END IF;
  IF s.status <> 'signed' THEN RAISE EXCEPTION 'swap_not_signed'; END IF;

  -- The renter's signature on THIS swap's agreement, naming the replacement car.
  SELECT id, status, voided_at, signed_at, rental_id, vehicle_id, application_id, metadata
    INTO ag FROM public.agreements WHERE id = s.agreement_id;
  IF NOT FOUND OR ag.status <> 'signed' OR ag.voided_at IS NOT NULL OR ag.signed_at IS NULL
     OR ag.rental_id IS DISTINCT FROM s.rental_id OR ag.vehicle_id IS DISTINCT FROM s.to_vehicle_id
     OR ag.application_id IS DISTINCT FROM s.application_id
     OR (ag.metadata -> 'amendment' ->> 'swap_id') IS DISTINCT FROM s.id::text THEN
    RAISE EXCEPTION 'swap_agreement_not_signed';
  END IF;

  BEGIN
    SELECT id, status, vehicle_id, driver_id, application_id, pickup_reading_id
      INTO r FROM public.rentals WHERE id = s.rental_id FOR UPDATE NOWAIT;
    -- Both cars, lower uuid first, so two swaps cannot deadlock each other.
    PERFORM 1 FROM public.vehicles WHERE id IN (s.from_vehicle_id, s.to_vehicle_id) ORDER BY id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'swap_contention' USING ERRCODE = '40001';
  END;
  IF r.id IS NULL OR r.status <> 'active' THEN RAISE EXCEPTION 'rental_not_active'; END IF;
  IF r.vehicle_id IS DISTINCT FROM s.from_vehicle_id OR r.application_id IS DISTINCT FROM s.application_id THEN
    RAISE EXCEPTION 'rental_vehicle_changed';
  END IF;

  SELECT id, status, archived_at INTO newv FROM public.vehicles WHERE id = s.to_vehicle_id;
  IF NOT FOUND OR newv.archived_at IS NOT NULL OR newv.status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'replacement_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rentals x WHERE x.vehicle_id = s.to_vehicle_id AND x.id <> s.rental_id
             AND x.status IN ('reserved','on_hold','active')) THEN
    RAISE EXCEPTION 'replacement_on_other_rental';
  END IF;
  missing := public.vehicle_rental_ready_missing(s.to_vehicle_id);
  IF coalesce(array_length(missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'replacement_not_rental_ready:%', array_to_string(missing, ',');
  END IF;

  -- New Vehicle Insurance is optional (Dolmar t549u/t550u, Nov 21 2026): no
  -- document or override is required to complete the swap. Documents tied to the
  -- swap are still counted in the audit row below.

  -- Odometer: same checks as End Rental for the outgoing car, history check for the replacement.
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings
     WHERE id = r.pickup_reading_id AND vehicle_id = s.from_vehicle_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = s.from_vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id,
                                         evidence_key, entered_by, rental_id, driver_id, note)
    VALUES (s.from_vehicle_id, _return_miles, v_today, now(), 'rental_return', s.id,
            'swap_return:' || s.id::text, _actor, s.rental_id, r.driver_id, 'Vehicle swap S-' || s.swap_number::text)
    RETURNING id INTO v_return;
  END IF;
  IF _pickup_miles IS NOT NULL THEN
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = s.to_vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _pickup_miles + 500 < v_hist THEN RAISE EXCEPTION 'pickup_below_history:%', v_hist; END IF;
    INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id,
                                         evidence_key, entered_by, rental_id, driver_id, note)
    VALUES (s.to_vehicle_id, _pickup_miles, v_today, now(), 'rental_checkout', s.id,
            'swap_checkout:' || s.id::text, _actor, s.rental_id, r.driver_id, 'Vehicle swap S-' || s.swap_number::text)
    RETURNING id INTO v_pickup;
  END IF;

  -- 1. Rental pointer (guard_rental_lifecycle allows it only inside app.rental_tx).
  --    The pickup reading follows the car, so End Rental compares the return
  --    against the replacement's pickup, not the old car's.
  PERFORM set_config('app.rental_tx', 'on', true);
  UPDATE public.rentals
     SET vehicle_id = s.to_vehicle_id,
         pickup_reading_id = v_pickup
   WHERE id = s.rental_id AND status = 'active' AND vehicle_id = s.from_vehicle_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.rental_tx', 'off', true);
    RAISE EXCEPTION 'rental_vehicle_changed';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  -- Later agreements, resends and the portal read the application's car too.
  UPDATE public.applications SET vehicle_id = s.to_vehicle_id
   WHERE id = s.application_id AND vehicle_id IS NOT DISTINCT FROM s.from_vehicle_id;

  -- 2. Replacement Rented (guard_vehicle_rented_status: allowed now that the rental names it).
  UPDATE public.vehicles SET status = 'rented' WHERE id = s.to_vehicle_id AND status = 'available';
  IF NOT FOUND THEN RAISE EXCEPTION 'replacement_unavailable'; END IF;
  -- 3. Outgoing car back to the fleet, the same choice End Rental offers.
  UPDATE public.vehicles SET status = _from_vehicle_status WHERE id = s.from_vehicle_id;

  UPDATE public.rental_vehicle_swaps
     SET status = 'completed', completed_at = now(), completed_by = _actor,
         from_vehicle_status = _from_vehicle_status,
         return_mileage = _return_miles, pickup_mileage = _pickup_miles,
         return_fuel = nullif(btrim(coalesce(_return_fuel, '')), ''),
         pickup_fuel = nullif(btrim(coalesce(_pickup_fuel, '')), ''),
         return_reading_id = v_return, pickup_reading_id = v_pickup,
         replaced_pickup_reading_id = r.pickup_reading_id,
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  VALUES (_actor,
          (SELECT string_agg(role::text, ',' ORDER BY role::text) FROM public.user_roles WHERE user_id = _actor),
          'rental.vehicle_swapped', 'rental', s.rental_id::text,
          'Vehicle swap S-' || s.swap_number::text || ' completed; billing unchanged',
          jsonb_build_object('swap_id', s.id, 'swap_number', s.swap_number, 'agreement_id', s.agreement_id,
            'from_vehicle_id', s.from_vehicle_id, 'to_vehicle_id', s.to_vehicle_id,
            'from_vehicle_status', _from_vehicle_status, 'return_miles', _return_miles, 'pickup_miles', _pickup_miles,
            'return_fuel', _return_fuel, 'pickup_fuel', _pickup_fuel, 'billing', 'unchanged',
            'insurance_docs', (SELECT count(*) FROM public.rental_vehicle_swap_documents WHERE swap_id = s.id),
            'insurance_override_reason', s.insurance_override_reason));

  RETURN jsonb_build_object('result','completed','swap_id',s.id,'swap_number',s.swap_number,
    'rental_id',s.rental_id,'from_vehicle_id',s.from_vehicle_id,'to_vehicle_id',s.to_vehicle_id,
    'from_vehicle_status',_from_vehicle_status,'return_reading_id',v_return,'pickup_reading_id',v_pickup);
END $$;

REVOKE ALL ON FUNCTION public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid) TO service_role;

COMMIT;
