-- =============================================================================
-- Part 1 / Part 2 onboarding split
--
-- Three column additions and one storage lockdown. Nothing here drops or
-- rewrites a historical value: return_date, how_heard, address and zip all
-- keep every row they have, they simply stop being asked for in Part 1.
-- =============================================================================

-- ---------------------------------------------------------------- drive_type
--
-- The readiness model already has a "Driving commitment" factor, but it could
-- only ever be answered by a staff member on the screening record, so it sat
-- unknown on every application until somebody ran an interview. The applicant
-- knows the answer on day one. Same vocabulary as screenings.drive_type so
-- there is one concept and one factor, not two.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS drive_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_drive_type_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_drive_type_check
      CHECK (drive_type IS NULL OR drive_type IN ('full_time','part_time'));
  END IF;
END $$;

COMMENT ON COLUMN public.applications.drive_type IS
  'Applicant''s own answer to "how do you plan to drive": full_time | part_time.
   Feeds the same readiness factor as screenings.drive_type, which outranks it.';

-- ----------------------------------------------------------- insurance_answer
--
-- full_coverage_insurance is a boolean, so it has exactly two answers plus
-- NULL, and NULL has to mean both "we never asked" and "they told us they
-- don''t know". Those are different facts: the second is an answered question
-- and staff should see it as one. This column records the answer as given;
-- full_coverage_insurance stays the derived boolean and stays NULL for
-- not_sure, because an unknown must remain unknown.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS insurance_answer text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_insurance_answer_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_insurance_answer_check
      CHECK (insurance_answer IS NULL OR insurance_answer IN ('yes','no','not_sure'));
  END IF;
END $$;

COMMENT ON COLUMN public.applications.insurance_answer IS
  'yes | no | not_sure, exactly as the applicant answered. NULL means the
   question was never put to them. "not_sure" must never be coerced to "no".';

-- Backfill the answer for applications that already gave us a boolean, so the
-- new column is not misleadingly empty for historical rows. NULL booleans stay
-- NULL: we genuinely do not know whether they were asked.
UPDATE public.applications
   SET insurance_answer = CASE WHEN full_coverage_insurance THEN 'yes' ELSE 'no' END
 WHERE insurance_answer IS NULL
   AND full_coverage_insurance IS NOT NULL;

-- ------------------------------------------------------------ legacy comments
COMMENT ON COLUMN public.applications.how_heard IS
  'LEGACY. No longer asked anywhere in the applicant flow as of the Part 1 /
   Part 2 split. Historical values are preserved and still shown to staff.';

-- ---------------------------------------------------- uploads: no more anon
--
-- These two policies let anyone holding an application UUID write a file into
-- that application''s storage folder. They could not read anything back, so the
-- blast radius was small, but the UUID is stopping being a credential and this
-- is the last place it authorized a write.
--
-- Applicant uploads now go through request_upload_url(), a server function
-- that checks a resume token and hands back a one-time signed upload URL for a
-- path it chooses itself. That runs as the service role, which bypasses
-- storage RLS entirely, so these policies are not merely tightened — they have
-- nothing left to allow.
--
-- "Scoped upload owner vehicle photos" is deliberately untouched: the
-- fleet-owner submission form is a different flow and is not part of this
-- change.
DROP POLICY IF EXISTS "Scoped upload license photos" ON storage.objects;
DROP POLICY IF EXISTS "Scoped upload profile screenshots" ON storage.objects;
