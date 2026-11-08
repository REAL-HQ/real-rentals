-- Validate the proposed row, never a SELECT of the pre-update vehicle.
-- Existing trigger attachment (INSERT / UPDATE OF status, weekly_rate),
-- status names and rental-ready requirements are deliberately unchanged.
-- No row is updated, made Available, or backfilled by this migration.
CREATE OR REPLACE FUNCTION public.guard_vehicle_ready_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  missing text[];
BEGIN
  IF NEW.status IS NULL OR NEW.status NOT IN ('available', 'reserved') THEN
    RETURN NEW;
  END IF;

  -- Some callers post a whole record. Unchanged status/rate values do not
  -- turn a color/plate edit into a request to enter service again.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.weekly_rate IS NOT DISTINCT FROM OLD.weekly_rate THEN
      RETURN NEW;
    END IF;
  END IF;

  missing := pg_catalog.array_remove(ARRAY[
    CASE WHEN NEW.year IS NULL THEN 'year' END,
    CASE WHEN pg_catalog.btrim(coalesce(NEW.make, '')) = '' THEN 'make' END,
    CASE WHEN pg_catalog.btrim(coalesce(NEW.model, '')) = '' THEN 'model' END,
    CASE WHEN NEW.vin IS NULL OR pg_catalog.upper(NEW.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
    CASE WHEN NEW.weekly_rate IS NULL OR NEW.weekly_rate <= 0
      OR NEW.weekly_rate::text IN ('NaN', 'Infinity', '-Infinity') THEN 'weekly_rate' END
  ], NULL);

  IF coalesce(pg_catalog.array_length(missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'vehicle_not_rental_ready:%', pg_catalog.array_to_string(missing, ',');
  END IF;
  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE retains owner and existing ACLs. Keep this internal
-- trigger function non-callable by public/anonymous/authenticated clients.
REVOKE EXECUTE ON FUNCTION public.guard_vehicle_ready_status() FROM PUBLIC, anon, authenticated;
