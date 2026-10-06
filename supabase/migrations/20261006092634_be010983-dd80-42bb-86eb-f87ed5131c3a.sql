CREATE SEQUENCE IF NOT EXISTS public.vehicle_unit_seq;
SELECT setval('public.vehicle_unit_seq', GREATEST(1, COALESCE((
  SELECT max(NULLIF(regexp_replace(upper(unit_number), '^RR-', ''), '')::int)
  FROM public.vehicles WHERE unit_number ~* '^RR-[0-9]+$'), 0)),
  (SELECT count(*) > 0 FROM public.vehicles WHERE unit_number ~* '^RR-[0-9]+$'));
REVOKE ALL ON SEQUENCE public.vehicle_unit_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_vehicle_unit_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF NEW.unit_number IS NULL OR trim(NEW.unit_number) = '' THEN
    LOOP
      n := nextval('public.vehicle_unit_seq');
      NEW.unit_number := 'RR-' || lpad(n::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.vehicles WHERE upper(unit_number) = upper(NEW.unit_number));
    END LOOP;
  ELSIF NEW.unit_number ~* '^RR-[0-9]+$' THEN
    n := regexp_replace(upper(NEW.unit_number), '^RR-', '')::bigint;
    PERFORM setval('public.vehicle_unit_seq', GREATEST(n, (SELECT last_value FROM public.vehicle_unit_seq)));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.assign_vehicle_unit_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vehicles_assign_unit_number ON public.vehicles;
CREATE TRIGGER vehicles_assign_unit_number BEFORE INSERT ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.assign_vehicle_unit_number();

CREATE OR REPLACE FUNCTION public.next_unit_number(_prefix text DEFAULT 'RR')
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'RR-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 3, '0')
  FROM public.vehicle_unit_seq
$$;