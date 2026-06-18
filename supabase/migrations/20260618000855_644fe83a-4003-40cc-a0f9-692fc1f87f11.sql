BEGIN;

-- 1. Restrict vehicle body_type to the three approved categories and migrate existing values.
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_body_type_check;

UPDATE public.vehicles
SET body_type = CASE
  WHEN LOWER(body_type) IN ('hatchback', 'coupe') THEN 'sedan'
  WHEN LOWER(body_type) IN ('truck') THEN 'suv'
  WHEN LOWER(body_type) IN ('minivan') THEN 'xl'
  WHEN LOWER(body_type) IN ('sedan', 'suv', 'xl') THEN LOWER(body_type)
  ELSE 'sedan'
END;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_body_type_check
  CHECK (body_type IS NULL OR body_type IN ('sedan', 'suv', 'xl'));

-- 2. Add Step 1 / Step 2 application fields.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS platform_status text,
  ADD COLUMN IF NOT EXISTS rental_length text,
  ADD COLUMN IF NOT EXISTS trips_completed text,
  ADD COLUMN IF NOT EXISTS rating numeric;

-- Normalize existing rental_term values to the three buckets.
UPDATE public.applications
SET rental_term = CASE
  WHEN LOWER(rental_term) IN ('weekly', 'week') THEN 'weekly'
  WHEN LOWER(rental_term) IN ('monthly', 'month') THEN 'monthly'
  WHEN rental_term IS NULL THEN NULL
  ELSE 'long_term'
END;

COMMIT;