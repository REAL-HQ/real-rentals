ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS doors integer DEFAULT 4,
  ADD COLUMN IF NOT EXISTS uber_eligibility text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS maintenance_status text DEFAULT 'Well Maintained';

UPDATE public.vehicles SET doors = 4 WHERE doors IS NULL;
UPDATE public.vehicles SET maintenance_status = 'Well Maintained' WHERE maintenance_status IS NULL;
UPDATE public.vehicles
  SET uber_eligibility = CASE
    WHEN body_type = 'suv' THEN ARRAY['Uber X','Comfort','XL']
    WHEN body_type = 'sedan' THEN ARRAY['Uber X','Comfort']
    ELSE ARRAY['Uber X']
  END
  WHERE uber_eligibility IS NULL OR cardinality(uber_eligibility) = 0;