-- Minimal stand-in for the parts of the live schema that end_rental_tx touches.
-- Shapes and the guard are copied from production (read-only pg_get_functiondef
-- / prosrc reads on 2026-10-23), not invented.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.applications (id uuid PRIMARY KEY, status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), notes text);
CREATE TABLE public.rentals (id uuid PRIMARY KEY, vehicle_id uuid, driver_id uuid,
  application_id uuid, status text NOT NULL, end_date date, autopay_active boolean DEFAULT true,
  pickup_reading_id uuid, return_reading_id uuid);
CREATE TABLE public.odometer_readings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, rental_id uuid, driver_id uuid, mileage integer, source text,
  kind text, actor uuid, status text NOT NULL DEFAULT 'valid');
CREATE TABLE public.automation_enrollments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid, status text NOT NULL, cancelled_reason text, next_run_at timestamptz);

CREATE FUNCTION private.rental_mileage_reading(_vehicle uuid, _rental uuid, _driver uuid,
  _miles integer, _source text, _kind text, _actor uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.odometer_readings (vehicle_id, rental_id, driver_id, mileage, source, kind, actor)
  VALUES (_vehicle, _rental, _driver, _miles, _source, _kind, _actor) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Verbatim from production private.application_active_guard.
CREATE FUNCTION private.application_active_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
     AND NOT EXISTS (SELECT 1 FROM public.rentals r
                     WHERE (r.application_id = NEW.id) AND r.status = 'active') THEN
    RAISE EXCEPTION 'active_requires_running_rental'
      USING HINT = 'A driver becomes Active only when a rental is started (activate_rental_tx).';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER applications_active_guard BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.application_active_guard();
