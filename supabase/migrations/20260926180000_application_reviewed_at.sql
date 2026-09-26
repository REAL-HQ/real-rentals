-- =============================================================================
-- When did somebody actually look at this application?
--
-- The dashboard counts "New" as status = 'new'. That status is set the moment
-- the wizard finishes and only leaves when a person changes it by hand — so an
-- application somebody read, thought about and left alone still reads as New
-- tomorrow, and the number slowly stops meaning anything.
--
-- Two columns, stamped once when a staff member opens the record. Nullable and
-- never backfilled: an application nobody has opened since this shipped is
-- genuinely unacknowledged, and guessing a date would be worse than admitting
-- that. The status column is untouched — being reviewed is not a lifecycle
-- state, it is a fact about us rather than about the applicant.
-- =============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.applications.reviewed_at IS
  'First time a staff member opened this application. Null means nobody has.
   Independent of status: an application can be read and left as new.';

CREATE INDEX IF NOT EXISTS applications_unacknowledged_idx
  ON public.applications (created_at DESC)
  WHERE reviewed_at IS NULL;

NOTIFY pgrst, 'reload schema';
