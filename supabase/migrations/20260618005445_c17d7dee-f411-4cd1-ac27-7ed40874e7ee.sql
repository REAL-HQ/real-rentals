ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES public.markets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS gclid text;

CREATE INDEX IF NOT EXISTS applications_market_id_idx ON public.applications(market_id);
CREATE INDEX IF NOT EXISTS applications_source_idx ON public.applications(source);