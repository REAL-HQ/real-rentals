ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY[
  'pending','current','paid','failed','late','overdue','past_due','unpaid','collections','refunded','void']));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_type_check CHECK (type = ANY (ARRAY[
  'rent','deposit','late_fee','toll','damage','fee','other']));
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_pi_uidx ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_uidx ON public.payments(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_vehicle_rented_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'rented' THEN
      RAISE EXCEPTION 'vehicle_status_guard: a new vehicle cannot start as Rented; activate a rental instead' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'rented' AND NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.vehicle_id = NEW.id AND r.status = 'active') THEN
      RAISE EXCEPTION 'vehicle_status_guard: Rented is set only by activating a rental' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'rented' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.vehicle_id = NEW.id AND r.status = 'active') THEN
      RAISE EXCEPTION 'vehicle_status_guard: this vehicle is on an active rental; end the rental to change its status' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vehicles_guard_rented_status ON public.vehicles;
CREATE TRIGGER vehicles_guard_rented_status BEFORE INSERT OR UPDATE OF status ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_rented_status();

CREATE OR REPLACE FUNCTION public.activate_rental_tx(
  _application_id uuid, _vehicle_id uuid, _driver_id uuid,
  _weekly_rate numeric, _deposit numeric, _deposit_held boolean,
  _start date, _end date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_veh record; v_rental uuid;
BEGIN
  IF _end IS NOT NULL AND _end <= _start THEN RAISE EXCEPTION 'invalid_dates'; END IF;
  SELECT id, status, user_id INTO v_app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.status NOT IN ('approved','active') THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF v_app.user_id IS DISTINCT FROM _driver_id THEN RAISE EXCEPTION 'account_conflict'; END IF;
  -- Row lock serialises competing activations of the same vehicle.
  SELECT id, status, archived_at INTO v_veh FROM public.vehicles WHERE id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  IF v_veh.archived_at IS NOT NULL OR v_veh.status IN ('archived','sold','retired') THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
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
  RETURN v_rental;
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM LIKE '%rentals_one_active_per_vehicle_idx%' THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF SQLERRM LIKE '%rentals_one_active_per_driver_idx%' THEN RAISE EXCEPTION 'already_active'; END IF;
  RAISE;
END $$;

CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  SELECT id, vehicle_id, application_id, status INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN RETURN 'already_closed'; END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  UPDATE public.rentals SET status = 'closed', end_date = _end, autopay_active = false WHERE id = _rental_id;
  UPDATE public.vehicles SET status = _vehicle_status WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  RETURN 'closed';
END $$;

REVOKE ALL ON FUNCTION public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_rental_tx(uuid,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_rental_tx(uuid,date,text) TO service_role;