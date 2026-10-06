
-- Every path that writes vehicles.current_odometer directly (create, editor, bulk log)
-- becomes a dated reading; the history then decides current mileage.
CREATE OR REPLACE FUNCTION public.vehicle_sync_current_odometer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; vid uuid := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
BEGIN
  SELECT mileage, observed_on INTO r FROM public.odometer_readings
   WHERE vehicle_id = vid AND status = 'valid' ORDER BY observed_on DESC, mileage DESC LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('app.odo_sync', 'on', true);
    UPDATE public.vehicles SET current_odometer = r.mileage, odometer_updated_at = r.observed_on::timestamptz
     WHERE id = vid AND current_odometer IS DISTINCT FROM r.mileage;
    PERFORM set_config('app.odo_sync', 'off', true);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.vehicle_odometer_to_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.odo_sync', true) = 'on' THEN RETURN NULL; END IF;
  IF NEW.current_odometer IS NULL OR NEW.current_odometer <= 0 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.current_odometer IS NOT DISTINCT FROM OLD.current_odometer THEN RETURN NULL; END IF;
  INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, source_type, note, entered_by)
  VALUES (NEW.id, NEW.current_odometer, (now() AT TIME ZONE 'America/New_York')::date, 'manual', 'Entered On Vehicle Record', auth.uid());
  RETURN NULL;
END $$;
CREATE TRIGGER vehicles_odometer_to_history AFTER INSERT OR UPDATE OF current_odometer ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_odometer_to_history();

CREATE OR REPLACE FUNCTION public.inspection_odometer_to_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vehicle_id IS NULL OR NEW.odometer IS NULL OR NEW.odometer <= 0 OR NEW.completed_at IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, source_type, source_id, evidence_key, entered_by)
  VALUES (NEW.vehicle_id, NEW.odometer, (NEW.completed_at AT TIME ZONE 'America/New_York')::date, 'inspection', NEW.id, 'inspection:' || NEW.id, NEW.inspector_id)
  ON CONFLICT (evidence_key) WHERE evidence_key IS NOT NULL DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER inspections_odometer_to_history AFTER INSERT OR UPDATE OF completed_at, odometer ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.inspection_odometer_to_history();

REVOKE EXECUTE ON FUNCTION public.vehicle_odometer_to_history() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inspection_odometer_to_history() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vehicle_sync_current_odometer() FROM PUBLIC, anon, authenticated;
