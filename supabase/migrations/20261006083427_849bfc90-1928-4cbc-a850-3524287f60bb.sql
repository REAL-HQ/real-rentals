ALTER TABLE public.vehicles ALTER COLUMN weekly_rate DROP NOT NULL;

-- The ONE definition of "Rental Ready": year, make, model, valid-format VIN, a weekly rate, at least one photo.
-- Fleet-profile completeness (title, registration, mileage, finance, GPS...) is deliberately NOT here.
CREATE OR REPLACE FUNCTION public.vehicle_rental_ready_missing(_vehicle_id uuid)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN v.year IS NULL THEN 'year' END,
    CASE WHEN coalesce(trim(v.make),'') = '' THEN 'make' END,
    CASE WHEN coalesce(trim(v.model),'') = '' THEN 'model' END,
    CASE WHEN v.vin IS NULL OR upper(v.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
    CASE WHEN v.weekly_rate IS NULL THEN 'weekly_rate' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.vehicle_media m WHERE m.vehicle_id = v.id)
          AND coalesce(array_length(v.photos,1),0) = 0 THEN 'photo' END
  ], NULL)
  FROM public.vehicles v WHERE v.id = _vehicle_id
$$;
REVOKE ALL ON FUNCTION public.vehicle_rental_ready_missing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_rental_ready_missing(uuid) TO authenticated, service_role;

-- Entering service (Available / Reserved) requires Rental Ready. Nothing else changes status automatically.
CREATE OR REPLACE FUNCTION public.guard_vehicle_ready_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE missing text[];
BEGIN
  IF NEW.status IN ('available','reserved') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.weekly_rate IS NULL) THEN
    IF TG_OP = 'INSERT' THEN
      missing := array_remove(ARRAY[
        CASE WHEN NEW.vin IS NULL OR upper(NEW.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
        CASE WHEN NEW.weekly_rate IS NULL THEN 'weekly_rate' END,
        CASE WHEN coalesce(array_length(NEW.photos,1),0) = 0 THEN 'photo' END], NULL);
    ELSE
      missing := public.vehicle_rental_ready_missing(NEW.id);
      IF NEW.weekly_rate IS NULL AND NOT ('weekly_rate' = ANY(missing)) THEN missing := missing || 'weekly_rate'; END IF;
    END IF;
    IF array_length(missing,1) > 0 THEN
      RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(missing, ',');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vehicles_guard_ready_status ON public.vehicles;
CREATE TRIGGER vehicles_guard_ready_status BEFORE INSERT OR UPDATE OF status, weekly_rate ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_ready_status();

CREATE OR REPLACE FUNCTION public.activate_rental_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_app record; v_veh record; v_rental uuid; v_missing text[];
BEGIN
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _end IS NOT NULL AND _end <= _start THEN RAISE EXCEPTION 'invalid_dates'; END IF;
  IF _weekly_rate IS NULL OR _weekly_rate <= 0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
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
  INSERT INTO public.rentals (driver_id, vehicle_id, application_id, start_date, end_date, status,
    weekly_rate, deposit_amount, deposit_held, next_payment_due)
  VALUES (_driver_id, _vehicle_id, _application_id, _start, _end, 'active',
    _weekly_rate, COALESCE(_deposit, 0), COALESCE(_deposit_held, false), _start)
  RETURNING id INTO v_rental;
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