CREATE OR REPLACE FUNCTION public.guard_vehicle_ready_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE missing text[];
BEGIN
  IF NEW.status IN ('available','reserved') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.weekly_rate IS NULL) THEN
    IF TG_OP = 'INSERT' THEN
      missing := array_remove(ARRAY[
        CASE WHEN NEW.vin IS NULL OR upper(NEW.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
        CASE WHEN NEW.weekly_rate IS NULL THEN 'weekly_rate' END,
        CASE WHEN coalesce(array_length(NEW.photos,1),0) = 0 THEN 'photo' END], NULL);
    ELSE
      missing := coalesce(public.vehicle_rental_ready_missing(NEW.id), '{}'::text[]);
      IF NEW.weekly_rate IS NULL AND NOT ('weekly_rate' = ANY(missing)) THEN missing := array_append(missing, 'weekly_rate'); END IF;
    END IF;
    IF coalesce(array_length(missing,1),0) > 0 THEN
      RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(missing, ',');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_vehicle_ready_status() FROM PUBLIC, anon, authenticated;