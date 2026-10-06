-- Rental Ready: year, make, model, valid VIN, positive weekly rate. No photo.
CREATE OR REPLACE FUNCTION public.vehicle_rental_ready_missing(_vehicle_id uuid)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT array_remove(ARRAY[
    CASE WHEN v.year IS NULL THEN 'year' END,
    CASE WHEN coalesce(trim(v.make),'') = '' THEN 'make' END,
    CASE WHEN coalesce(trim(v.model),'') = '' THEN 'model' END,
    CASE WHEN v.vin IS NULL OR upper(v.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
    CASE WHEN v.weekly_rate IS NULL OR v.weekly_rate <= 0 THEN 'weekly_rate' END
  ], NULL)
  FROM public.vehicles v WHERE v.id = _vehicle_id
$function$;
REVOKE EXECUTE ON FUNCTION public.vehicle_rental_ready_missing(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_vehicle_ready_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE missing text[];
BEGIN
  IF NEW.status IN ('available','reserved') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.weekly_rate IS NULL OR NEW.weekly_rate <= 0) THEN
    IF TG_OP = 'INSERT' THEN
      missing := array_remove(ARRAY[
        CASE WHEN NEW.year IS NULL THEN 'year' END,
        CASE WHEN coalesce(trim(NEW.make),'') = '' THEN 'make' END,
        CASE WHEN coalesce(trim(NEW.model),'') = '' THEN 'model' END,
        CASE WHEN NEW.vin IS NULL OR upper(NEW.vin) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'vin' END,
        CASE WHEN NEW.weekly_rate IS NULL OR NEW.weekly_rate <= 0 THEN 'weekly_rate' END], NULL);
    ELSE
      missing := coalesce(public.vehicle_rental_ready_missing(NEW.id), '{}'::text[]);
      IF (NEW.weekly_rate IS NULL OR NEW.weekly_rate <= 0) AND NOT ('weekly_rate' = ANY(missing)) THEN missing := array_append(missing, 'weekly_rate'); END IF;
    END IF;
    IF coalesce(array_length(missing,1),0) > 0 THEN
      RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(missing, ',');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_vehicle_ready_status() FROM PUBLIC, anon, authenticated;

-- Listing Ready: Rental Ready + at least one explicitly published listing photo.
CREATE OR REPLACE FUNCTION public.vehicle_listing_ready_missing(_vehicle_id uuid)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(public.vehicle_rental_ready_missing(_vehicle_id), '{}'::text[])
    || CASE WHEN EXISTS (SELECT 1 FROM public.vehicle_media m WHERE m.vehicle_id = _vehicle_id AND m.published)
            THEN '{}'::text[] ELSE ARRAY['listing_photo'] END
$function$;
REVOKE EXECUTE ON FUNCTION public.vehicle_listing_ready_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_listing_ready_missing(uuid) TO service_role;

-- $249 was a hard-coded column default (2026-06-11), not a company setting.
-- New vehicles start with deposit Not Set. Existing rows untouched.
ALTER TABLE public.vehicles ALTER COLUMN deposit DROP DEFAULT;

-- Display normalization only (raw text stays in vehicle_field_provenance).
UPDATE public.vehicles SET make = 'Ford', model = 'Fusion'
 WHERE unit_number = 'RR-004' AND make = 'FORD' AND model = 'FUSION';