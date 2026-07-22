ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS contacted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_applications_contacted_at ON public.applications(contacted_at);