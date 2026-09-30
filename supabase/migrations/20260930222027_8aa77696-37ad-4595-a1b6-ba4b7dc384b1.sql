-- Fleet availability + waitlist mode

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'waiting',
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_application_id uuid REFERENCES public.applications(id),
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

-- One active spot per address per market. Historical rows keep theirs;
-- duplicates going forward are refused at the database level too.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_per_email
  ON public.waitlist (lower(email), market_id)
  WHERE status = 'waiting';

-- Public availability lookup. Reads only the cars_available number from the
-- fleet_availability setting and exposes nothing else; a security-definer
-- function is used because app_settings itself is staff-only.
CREATE OR REPLACE FUNCTION public.cars_available()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (s.value ->> 'cars_available')::int
  FROM public.app_settings s
  WHERE s.key = 'fleet_availability'
    AND jsonb_typeof(s.value -> 'cars_available') = 'number'
    AND (s.value ->> 'cars_available') ~ '^-?[0-9]+$'
$$;

GRANT EXECUTE ON FUNCTION public.cars_available() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cars_available() TO service_role;