
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS license_valid boolean,
  ADD COLUMN IF NOT EXISTS gig_status text,
  ADD COLUMN IF NOT EXISTS start_timing text,
  ADD COLUMN IF NOT EXISTS vehicle_size text,
  ADD COLUMN IF NOT EXISTS rental_duration text,
  ADD COLUMN IF NOT EXISTS profile_screenshot_url text,
  ADD COLUMN IF NOT EXISTS full_coverage_insurance boolean,
  ADD COLUMN IF NOT EXISTS how_heard text,
  ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step text;

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status = ANY (ARRAY['partial','new','complete','reviewing','approved','active','suspended','declined','closed']));

UPDATE public.applications SET status = 'new' WHERE status NOT IN ('partial','new','complete','reviewing','approved','active','suspended','declined','closed');

CREATE INDEX IF NOT EXISTS applications_status_idx ON public.applications(status);
CREATE INDEX IF NOT EXISTS applications_score_idx ON public.applications(score DESC);
