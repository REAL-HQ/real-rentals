-- M2 rehearsal baseline: the Drizzle-created objects the packet expects.
--
-- Apply AFTER supabase/migrations and BEFORE HOSTED-INSTALL step 1, on a
-- disposable rehearsal database only. The production database already has
-- every object below.
--
-- Requires private.is_staff() and private.is_owner(), which
-- supabase/migrations creates, and the anon / authenticated / service_role
-- roles.
--
-- GENERATED from the Drizzle migrations by
-- scripts/m2-rehearsal-prerequisites.mjs. Do not hand-edit: run the
-- generator. scripts/m2-rehearsal-prerequisites.test.mjs fails if this file
-- and those migrations disagree. No packet file is modified.
--
-- One transaction. Run with ON_ERROR_STOP and without psql -1.
BEGIN;

-- public.application_waitlist_holds -- extend_rental_tx names it in a PL/pgSQL body
-- from drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql
CREATE TABLE public.application_waitlist_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid NOT NULL,
  removed_at timestamptz,
  removed_by uuid,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX application_waitlist_holds_one_active
  ON public.application_waitlist_holds (application_id) WHERE removed_at IS NULL;
CREATE INDEX application_waitlist_holds_app ON public.application_waitlist_holds (application_id, added_at DESC);

GRANT SELECT ON public.application_waitlist_holds TO authenticated;
GRANT ALL ON public.application_waitlist_holds TO service_role;
ALTER TABLE public.application_waitlist_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read waitlist holds" ON public.application_waitlist_holds
  FOR SELECT TO authenticated USING (private.is_staff());

-- applications.deleted_at and the four columns added by the same statement -- HOSTED-INSTALL step 13 failed without it
-- from drizzle/migrations/0016_0016_driver_deletion_stage1.sql
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS applications_deleted_at_idx ON public.applications (deleted_at) WHERE deleted_at IS NOT NULL;

-- public.application_identity_reviews -- HOSTED-INSTALL step 6 failed without it; its inline resolution CHECK is auto-named application_identity_reviews_resolution_check, which step 6 drops and replaces
-- from drizzle/migrations/0019_application_identity_reviews.sql
CREATE TABLE public.application_identity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  submitted_full_name text,
  submitted_email text,
  submitted_phone text,
  source text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.application_identity_reviews IS 'Durable identity conflicts (e.g. same phone, different email). Never auto-merged; resolved only by Manager+ via server function, audited. Not touched by AI scoring.';
CREATE INDEX application_identity_reviews_app_idx ON public.application_identity_reviews (application_id, status);
CREATE UNIQUE INDEX application_identity_reviews_open_uniq ON public.application_identity_reviews (application_id, kind, lower(coalesce(submitted_email,'')), coalesce(submitted_phone,'')) WHERE status = 'open';
GRANT SELECT ON public.application_identity_reviews TO authenticated;
GRANT ALL ON public.application_identity_reviews TO service_role;
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view identity reviews" ON public.application_identity_reviews FOR SELECT TO authenticated USING (private.is_staff());

-- the grants 0020 tightens on that table, so the rehearsal starts from the live grant shape
-- from drizzle/migrations/0020_identity_reviews_tighten_grants.sql
REVOKE ALL ON public.application_identity_reviews FROM anon, authenticated;
GRANT SELECT ON public.application_identity_reviews TO authenticated;

COMMIT;
