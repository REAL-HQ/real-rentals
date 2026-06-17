ALTER TABLE public.vehicles ADD COLUMN miles_per_tank INTEGER;

UPDATE public.vehicles
SET miles_per_tank = CASE
  WHEN fuel_type = 'ev' THEN 220 + (abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 7) * 10
  WHEN fuel_type = 'hybrid' THEN 450 + (abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 8) * 10
  ELSE 320 + (abs(('x' || substr(md5(id::text), 1, 8))::bit(32)::int) % 9) * 10
END
WHERE miles_per_tank IS NULL;