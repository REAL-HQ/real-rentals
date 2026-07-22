
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS resubmission_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resubmission_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS primary_application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS applications_phone_created_idx ON public.applications (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_email_created_idx ON public.applications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS applications_primary_id_idx ON public.applications (primary_application_id);

-- Allow public form to write these dedupe columns on insert (anon).
-- Column-level insert grants match existing pattern from earlier hardening migration.
GRANT INSERT (resubmission_count, resubmission_history, primary_application_id) ON public.applications TO anon;
