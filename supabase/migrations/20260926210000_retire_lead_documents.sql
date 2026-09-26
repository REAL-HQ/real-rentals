-- Retire lead_documents. One canonical applicant document architecture.
--
-- lead_documents was an earlier, thinner version of public.documents: a file,
-- attached to an application, with a type. Every column it had, documents has,
-- with better names and more of them. Keeping both is what produced the bug
-- where an applicant's own licence was invisible to the back office — the
-- staff UI counted one table and the applicant's uploads landed in the other.
--
-- This migration removes the last database-level dependency on it. The table
-- itself stays, empty and commented, until the canonical system has been
-- proven in production.

-- ---------------------------------------------------------------- 1. RLS
--
-- Category-scoped confidentiality for the verification call recording.
--
-- The old policy was a blanket `private.is_staff()`, which is correct for a
-- licence and wrong for a recording of somebody's insurance verification call:
-- that holds a third party's voice and policy details, and it was Owner-only
-- while it lived in lead_documents. Moving it into documents under the old
-- policy would have silently widened it to every Coordinator.
--
-- This was verified, not assumed. Against the old policy a Coordinator could
-- SELECT the recording row and read its storage_path straight through
-- PostgREST; a check inside a server function would not have stopped them,
-- because the browser holds a real JWT and can skip the server function
-- entirely. The boundary has to be here, in the row filter, to be a boundary
-- at all.
--
-- Note the service role still bypasses RLS, so the server functions that sign
-- URLs filter by tier as well. Two layers, because each one alone has a hole:
-- RLS misses the service-role path, and the server check misses PostgREST.
DROP POLICY IF EXISTS "Staff manage all documents" ON public.documents;
DROP POLICY IF EXISTS "Staff manage applicant documents" ON public.documents;
CREATE POLICY "Staff manage applicant documents" ON public.documents
  FOR ALL TO authenticated
  USING (
    private.is_staff()
    AND (category <> 'verification_recording' OR private.is_owner())
  )
  WITH CHECK (
    private.is_staff()
    AND (category <> 'verification_recording' OR private.is_owner())
  );

COMMENT ON POLICY "Staff manage applicant documents" ON public.documents IS
  'Coordinator and above may work applicant documents. verification_recording is Owner-only and is filtered here rather than in application code, so it holds against direct PostgREST access.';

-- ------------------------------------------------- 2. Pipeline enforcement
--
-- The gate now counts the same documents the operator is looking at.
--
-- It used to count lead_documents, which only ever held files a staff member
-- uploaded in the back office. After applicant uploads moved to the vault the
-- database and the UI disagreed: the screen would permit the advance and the
-- database would refuse it with "have 0". Nobody hit it — no screening has
-- ever gone past docs_pending — but it was live.
--
-- What counts as a document you have:
--   is_current            a superseded version is history, not evidence
--   review_status <> 'rejected'
--                         a staff member has looked at it and asked for
--                         another one; it is a gap, not a document
--   category in the four  wrong category does not satisfy a requirement
--
-- What is deliberately NOT required: staff verification. The rule this
-- replaces asked whether the document had arrived, and widening it to "and
-- somebody has checked it" would be a new business rule, not a migration.
-- Verified vs merely present stays visible in the UI and in readiness.
CREATE OR REPLACE FUNCTION public.enforce_screening_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  doc_count int;
  rec_count int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('docs_pending','insurance_verified','approved','pickup_scheduled','active_renter') THEN
    IF NEW.interview_completed_at IS NULL THEN
      RAISE EXCEPTION 'Cannot advance to %: interview must be completed first', NEW.status;
    END IF;
    IF NEW.disqualified THEN
      RAISE EXCEPTION 'Cannot advance to %: driver is disqualified', NEW.status;
    END IF;
  END IF;

  IF NEW.status IN ('insurance_verified','approved','pickup_scheduled','active_renter') THEN
    SELECT count(DISTINCT category) INTO doc_count
      FROM public.documents
      WHERE driver_id = NEW.lead_id
        AND is_current
        AND coalesce(review_status, 'uploaded') <> 'rejected'
        AND category IN ('license_front','license_back','insurance','gig_profile');
    IF doc_count < 4 THEN
      RAISE EXCEPTION 'Cannot advance to %: all four driver documents required (have %)', NEW.status, doc_count;
    END IF;

    IF NEW.insurance_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot advance to %: insurance not yet verified', NEW.status;
    END IF;

    SELECT count(*) INTO rec_count
      FROM public.documents
      WHERE driver_id = NEW.lead_id
        AND is_current
        AND coalesce(review_status, 'uploaded') <> 'rejected'
        AND category = 'verification_recording';
    IF rec_count < 1 THEN
      RAISE EXCEPTION 'Cannot advance to %: verification call recording required', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- The gate reads documents on every status change, for one applicant.
CREATE INDEX IF NOT EXISTS documents_driver_current_category_idx
  ON public.documents (driver_id, category)
  WHERE is_current AND driver_id IS NOT NULL;

-- --------------------------------------------------------- 3. Retire, keep
--
-- Not dropped. Production holds zero rows and nothing reads it any more, but a
-- DROP is recoverable only from a restore, and an empty table nothing queries
-- costs nothing to leave standing. Physically removing it is a later decision,
-- once the canonical system has run in production for a while.
COMMENT ON TABLE public.lead_documents IS
  'RETIRED — applicant documents are stored in public.documents. Do not use for new writes. Zero rows at retirement (2026-09-26); kept as a schema artifact pending a later drop.';
