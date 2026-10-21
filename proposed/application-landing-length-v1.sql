-- PROPOSED ONLY. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- landing_page and referrer are stored as submitted. This only refuses a
-- value longer than 500 characters. NOT VALID adds the constraint without
-- scanning existing rows. VALIDATE scans them. The ROLLBACK section drops
-- both constraints. Run APPLY or ROLLBACK, not the whole file.

-- ===== APPLY =====

ALTER TABLE public.applications
  ADD CONSTRAINT applications_landing_page_length
  CHECK (landing_page IS NULL OR length(landing_page) <= 500) NOT VALID;

ALTER TABLE public.applications
  VALIDATE CONSTRAINT applications_landing_page_length;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_referrer_length
  CHECK (referrer IS NULL OR length(referrer) <= 500) NOT VALID;

ALTER TABLE public.applications
  VALIDATE CONSTRAINT applications_referrer_length;

-- ===== ROLLBACK =====

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_landing_page_length;
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_referrer_length;
