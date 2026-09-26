-- Document review status.
--
-- The vault could say a file EXISTS. It could not say whether anybody had
-- LOOKED at it. Those are different facts and the readiness model depends on
-- keeping them apart: an uploaded licence is document-supported evidence, a
-- licence a staff member has actually checked is staff-verified evidence, and
-- collapsing the two would let a blurry photo of a cereal box count as
-- verification.
--
-- Four of the five statuses the back office needs already exist implicitly:
--   Missing           -- no row
--   Uploaded          -- a row exists
--   Expired           -- expires_at < today
--   Superseded        -- is_current = false
-- This adds the two that cannot be derived: a human said yes, or a human said
-- send me a new one.
--
-- Additive only. No column is dropped, no value is rewritten. Every existing
-- row becomes 'uploaded', which is exactly what it is.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_review_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_review_status_check
      CHECK (review_status IN ('uploaded', 'verified', 'rejected'));
  END IF;
END $$;

COMMENT ON COLUMN public.documents.review_status IS
  'uploaded = received, nobody has checked it. verified = a staff member confirmed it is the right, readable, valid document. rejected = a staff member asked for a replacement. Verification of a document is NOT approval of the applicant.';

-- Finding a driver's unreviewed documents is the back office''s daily question.
CREATE INDEX IF NOT EXISTS documents_driver_review_idx
  ON public.documents (driver_id, review_status)
  WHERE driver_id IS NOT NULL;
