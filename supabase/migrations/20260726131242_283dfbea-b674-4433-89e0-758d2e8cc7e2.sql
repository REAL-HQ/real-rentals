
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS current_odometer integer,
  ADD COLUMN IF NOT EXISTS last_oil_change_miles integer,
  ADD COLUMN IF NOT EXISTS oil_interval_miles integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS last_tire_date date,
  ADD COLUMN IF NOT EXISTS last_brake_inspection_date date;
