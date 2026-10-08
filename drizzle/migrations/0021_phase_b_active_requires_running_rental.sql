CREATE OR REPLACE FUNCTION private.application_active_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
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

DROP TRIGGER IF EXISTS applications_active_guard ON public.applications;
CREATE TRIGGER applications_active_guard
  BEFORE INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.application_active_guard();

CREATE OR REPLACE FUNCTION private.screening_active_renter_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'active_renter'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active_renter')
     AND NOT EXISTS (SELECT 1 FROM public.rentals r
                     WHERE r.application_id = NEW.lead_id AND r.status = 'active') THEN
    RAISE EXCEPTION 'active_renter_requires_running_rental'
      USING HINT = 'The Active Renter step completes only after a rental is started.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_screenings_active_renter_guard ON public.driver_screenings;
CREATE TRIGGER driver_screenings_active_renter_guard
  BEFORE INSERT OR UPDATE OF status ON public.driver_screenings
  FOR EACH ROW EXECUTE FUNCTION private.screening_active_renter_guard();