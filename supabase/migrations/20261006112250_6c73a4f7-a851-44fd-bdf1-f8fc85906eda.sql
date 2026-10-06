ALTER TABLE public.odometer_readings
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_id uuid;
CREATE INDEX IF NOT EXISTS odometer_readings_rental_idx ON public.odometer_readings(rental_id);

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS pickup_reading_id uuid REFERENCES public.odometer_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reading_id uuid REFERENCES public.odometer_readings(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.odometer_readings_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.mileage <> OLD.mileage OR NEW.observed_on <> OLD.observed_on OR NEW.vehicle_id <> OLD.vehicle_id
       OR NEW.source_type <> OLD.source_type OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
       OR (OLD.rental_id IS NOT NULL AND NEW.rental_id IS DISTINCT FROM OLD.rental_id) THEN
      RAISE EXCEPTION 'odometer_immutable: add a correcting reading instead';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'valid' AND EXISTS (
    SELECT 1 FROM public.odometer_readings r WHERE r.vehicle_id = NEW.vehicle_id AND r.status = 'valid'
      AND r.observed_on <= NEW.observed_on AND r.mileage > NEW.mileage + 500) THEN
    NEW.status := 'conflict';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.vehicle_sync_current_odometer()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; vid uuid := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
BEGIN
  SELECT mileage, observed_on, observed_at INTO r FROM public.odometer_readings
   WHERE vehicle_id = vid AND status = 'valid'
   ORDER BY observed_on DESC, observed_at DESC NULLS LAST, mileage DESC LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('app.odo_sync', 'on', true);
    UPDATE public.vehicles SET current_odometer = r.mileage, odometer_updated_at = COALESCE(r.observed_at, r.observed_on::timestamptz)
     WHERE id = vid AND current_odometer IS DISTINCT FROM r.mileage;
    PERFORM set_config('app.odo_sync', 'off', true);
  END IF;
  RETURN NULL;
END $function$;

-- Shared: record (or reuse an inspection's) rental mileage observation.
CREATE OR REPLACE FUNCTION private.rental_mileage_reading(_vehicle uuid, _rental uuid, _driver uuid, _miles integer, _kind text, _insp_type text, _actor uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  SELECT o.id INTO v_id FROM public.odometer_readings o
    JOIN public.inspections i ON i.id = o.source_id
   WHERE o.vehicle_id = _vehicle AND o.source_type = 'inspection' AND o.mileage = _miles
     AND o.rental_id IS NULL AND i.inspection_type = _insp_type AND o.observed_on >= v_today - 7
   ORDER BY o.observed_on DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.odometer_readings SET rental_id = _rental, driver_id = _driver WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id, evidence_key, entered_by, rental_id, driver_id)
  VALUES (_vehicle, _miles, v_today, now(), _kind, _rental, _kind || ':' || _rental, _actor, _rental, _driver)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION private.rental_mileage_reading(uuid,uuid,uuid,integer,text,text,uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date);
CREATE FUNCTION public.activate_rental_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date, _pickup_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.end_rental_tx(uuid, date, text);
CREATE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
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
    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN 'closed';
END $function$;
REVOKE ALL ON FUNCTION public.end_rental_tx(uuid, date, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_rental_tx(uuid, date, text, integer, uuid) TO service_role;

DROP POLICY IF EXISTS "Staff read fleet import proposals" ON public.fleet_import_proposals;
CREATE POLICY "Managers read fleet import proposals" ON public.fleet_import_proposals FOR SELECT TO authenticated USING (private.is_manager());

DROP POLICY IF EXISTS "Staff read vehicle provenance" ON public.vehicle_field_provenance;
CREATE POLICY "Staff read vehicle provenance" ON public.vehicle_field_provenance FOR SELECT TO authenticated
USING (private.is_staff() AND (
  (field <> ALL (ARRAY['legal_owner','lienholder','purchase_price','purchase_date','payoff_amount','loan_reference','monthly_payment',
    'service.total','service.labor_total','service.parts_total','service.tax_total']))
  OR private.is_manager()));