ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS ai_score integer,
  ADD COLUMN IF NOT EXISTS ai_tier text CHECK (ai_tier IN ('hot','warm','cold')),
  ADD COLUMN IF NOT EXISTS ai_flags jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

CREATE INDEX IF NOT EXISTS applications_ai_tier_idx ON public.applications(ai_tier);