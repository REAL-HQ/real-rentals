-- Secure resume, and application intent separated from contractual dates.
--
-- Two changes that go together because both are about the same mistake: an
-- application is an expression of interest, and we had been treating it as
-- something stronger. Its id was treated as a credential, and the applicant's
-- guess at a return date was treated as a contract term.

-- ------------------------------------------------------- 1. Resume tokens
--
-- The application UUID was a bearer token. getApplicationForWizard and
-- updateApplicationStep had no auth middleware at all, so possession of the id
-- granted read and write — including flipping status to 'new'. That was
-- survivable while the id only ever appeared in a redirect in the applicant's
-- own browser. It stops being survivable the moment we email or text a
-- "come back and finish" link, because those get forwarded, logged by SMS
-- gateways, and sit in inboxes for years.
--
-- Only the hash is stored. A leak of this table yields no working links.
CREATE TABLE IF NOT EXISTS public.application_resume_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  -- sha256 of a 32-byte random token, hex encoded. Never the token itself.
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS application_resume_tokens_app_idx
  ON public.application_resume_tokens (application_id)
  WHERE revoked_at IS NULL;

-- No grants to anon or authenticated, and RLS on with no policy: this table is
-- reachable only through the service role, inside the server functions that
-- validate a presented token. There is deliberately no way to enumerate it
-- from a browser, with or without a session.
ALTER TABLE public.application_resume_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_resume_tokens FROM anon, authenticated;
GRANT ALL ON public.application_resume_tokens TO service_role;

COMMENT ON TABLE public.application_resume_tokens IS
  'Hashed, expiring, revocable resume credentials for applicants. Service role only — all access goes through the applicant server functions. The raw token exists once, in the link.';

-- --------------------------------------------- 2. Expected rental duration
--
-- What the applicant tells us at application time is an intention: roughly how
-- long they think they need a car. It is not a contract term, and it was being
-- merged into the signed rental agreement as "Scheduled return date" — an
-- applicant's rough guess, typed before anybody had spoken to them, ending up
-- in a document they sign.
--
-- return_date is NOT touched. Historical values stay exactly as they are, and
-- nothing here reinterprets them as a duration.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS expected_duration text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_expected_duration_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_expected_duration_check
      CHECK (expected_duration IS NULL OR expected_duration IN
        ('1-2_weeks','3-4_weeks','1-2_months','2plus_months','ongoing'));
  END IF;
END $$;

COMMENT ON COLUMN public.applications.expected_duration IS
  'Applicant intent at application time, not a contract term. The authoritative rental period lives on the rental; see rentals.start_date / end_date.';

COMMENT ON COLUMN public.applications.return_date IS
  'LEGACY / intent only. An applicant estimate, historically merged into the rental agreement. New applications record expected_duration instead. The agreement now prefers the rental''s own dates.';
