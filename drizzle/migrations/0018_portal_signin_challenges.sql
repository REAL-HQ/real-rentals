CREATE TABLE public.portal_signin_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  link_hash text NOT NULL UNIQUE,
  eligible boolean NOT NULL DEFAULT false,
  send_state text NOT NULL DEFAULT 'not_attempted',
  attempts integer NOT NULL DEFAULT 0,
  ip_hash text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.portal_signin_challenges IS 'Passwordless portal sign-in: hashed 6-digit codes and one-time links. Service role only.';
CREATE INDEX portal_signin_challenges_email_idx ON public.portal_signin_challenges (email, created_at DESC);
CREATE INDEX portal_signin_challenges_ip_idx ON public.portal_signin_challenges (ip_hash, created_at DESC);
GRANT ALL ON public.portal_signin_challenges TO service_role;
REVOKE ALL ON public.portal_signin_challenges FROM anon, authenticated;
ALTER TABLE public.portal_signin_challenges ENABLE ROW LEVEL SECURITY;