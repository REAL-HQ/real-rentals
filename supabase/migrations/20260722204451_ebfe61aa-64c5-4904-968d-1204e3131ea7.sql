ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS landing_page text,
  ADD COLUMN IF NOT EXISTS referrer text;

-- Widen anon INSERT grants so public form submissions can persist the new
-- attribution columns alongside the existing utm_* / gclid ones.
GRANT INSERT (landing_page, referrer) ON public.applications TO anon;