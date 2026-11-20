-- State DMV license checks (Dolmar, Nov 20 2026). Besides RentID, staff check every
-- applicant's license on the state DMV site (Florida: FLHSMV Driver License Check)
-- and log the result here. The server refuses approval, agreement sends and
-- Reservation Fee links unless the latest check is Valid and under 24 hours old.
-- Append-only: a result is never edited or deleted; a new check supersedes it.
-- NOT APPLIED: needs Dolmar's approval. Until it is applied the server does not
-- enforce the rule (same pattern as the blacklist), so deploy order is safe.
CREATE TABLE IF NOT EXISTS public.license_dmv_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('valid', 'suspended', 'revoked', 'cancelled', 'expired', 'not_found', 'other')),
  license_state text NOT NULL CHECK (license_state ~ '^[A-Z]{2}$'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid,
  checked_by_label text NOT NULL CHECK (length(btrim(checked_by_label)) > 0),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  screenshot_path text CHECK (screenshot_path IS NULL OR length(screenshot_path) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_dmv_checks_evidence CHECK (
    length(btrim(coalesce(note, ''))) >= 5 OR length(btrim(coalesce(screenshot_path, ''))) > 0)
);
COMMENT ON TABLE public.license_dmv_checks IS
  'State DMV license check results logged by staff. Append-only. Approval, agreement sends and Reservation Fee links need a Valid check under 24 hours old (enforced in the server).';
CREATE INDEX IF NOT EXISTS license_dmv_checks_app_idx ON public.license_dmv_checks (application_id, checked_at DESC);

ALTER TABLE public.license_dmv_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read license dmv checks" ON public.license_dmv_checks;
DROP POLICY IF EXISTS "Staff log license dmv checks" ON public.license_dmv_checks;
CREATE POLICY "Staff read license dmv checks" ON public.license_dmv_checks FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Staff log license dmv checks" ON public.license_dmv_checks FOR INSERT TO authenticated WITH CHECK (private.is_staff());
REVOKE ALL ON public.license_dmv_checks FROM anon, authenticated;
GRANT SELECT, INSERT ON public.license_dmv_checks TO authenticated;
GRANT ALL ON public.license_dmv_checks TO service_role;
