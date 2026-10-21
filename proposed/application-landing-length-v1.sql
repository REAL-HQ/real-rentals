-- PROPOSED ONLY. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- landing_page and referrer are stored as submitted. This only refuses a
-- value longer than 500 characters. NOT VALID adds the constraint without
-- scanning existing rows. VALIDATE scans them. The ROLLBACK section drops
-- both constraints. Run APPLY or ROLLBACK, not the whole file.
--
-- APPLY is one transaction. A failed VALIDATE rolls the NOT VALID constraint
-- back with it. Left committed, that check blocks updates of existing
-- applications, including updates that do not touch the long value.

-- ===== APPLY =====

-- Pre-flight. If either count is not zero, shorten those rows before this
-- block is applied. Remediation:
--   UPDATE public.applications
--   SET landing_page = left(landing_page, 500)
--   WHERE landing_page IS NOT NULL AND length(landing_page) > 500;
--   UPDATE public.applications
--   SET referrer = left(referrer, 500)
--   WHERE referrer IS NOT NULL AND length(referrer) > 500;

BEGIN;

SELECT count(*) AS landing_page_over_500
FROM public.applications
WHERE landing_page IS NOT NULL AND length(landing_page) > 500;

SELECT count(*) AS referrer_over_500
FROM public.applications
WHERE referrer IS NOT NULL AND length(referrer) > 500;

-- Abort here when either count is not zero. The transaction rolls back
-- before either check is added, so a NOT VALID constraint is never left
-- behind for someone to discover on the next update.
DO $$
DECLARE
  landing_over integer;
  referrer_over integer;
BEGIN
  SELECT count(*) INTO landing_over
  FROM public.applications
  WHERE landing_page IS NOT NULL AND length(landing_page) > 500;
  SELECT count(*) INTO referrer_over
  FROM public.applications
  WHERE referrer IS NOT NULL AND length(referrer) > 500;
  IF landing_over <> 0 OR referrer_over <> 0 THEN
    RAISE EXCEPTION 'applications still has % landing_page and % referrer values over 500 characters. Shorten those rows, then run APPLY again.', landing_over, referrer_over;
  END IF;
END $$;

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

COMMIT;

-- ===== ROLLBACK =====

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_landing_page_length;
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_referrer_length;
