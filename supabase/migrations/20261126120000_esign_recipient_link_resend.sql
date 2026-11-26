-- Per-signer signing-link resend. NOT APPLIED. Do not run this against a
-- hosted database until it is reviewed. The application tolerates these
-- columns being absent: a resend then reissues a distinct token per signer
-- instead of reusing the current one.
--
-- esign_recipients already has sent_at (last time a link went out) and
-- viewed_at (first open). This adds only what those two do not record:
--   link_token          the raw signing secret, so a still-valid link can be
--                       emailed again without replacing it. Service role only.
--   link_channel        email | email_and_sms for the last send
--   link_email_status   sent | failed | not_attempted
--   link_sms_status     sent | failed | not_attempted
--   last_viewed_at      the most recent open (viewed_at stays the first open)

ALTER TABLE public.esign_recipients
  ADD COLUMN IF NOT EXISTS link_token text,
  ADD COLUMN IF NOT EXISTS link_channel text,
  ADD COLUMN IF NOT EXISTS link_email_status text,
  ADD COLUMN IF NOT EXISTS link_sms_status text,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

ALTER TABLE public.esign_recipients DROP CONSTRAINT IF EXISTS esign_recipients_link_channel_chk;
ALTER TABLE public.esign_recipients
  ADD CONSTRAINT esign_recipients_link_channel_chk
  CHECK (link_channel IS NULL OR link_channel IN ('email', 'email_and_sms'));

ALTER TABLE public.esign_recipients DROP CONSTRAINT IF EXISTS esign_recipients_link_email_status_chk;
ALTER TABLE public.esign_recipients
  ADD CONSTRAINT esign_recipients_link_email_status_chk
  CHECK (link_email_status IS NULL OR link_email_status IN ('sent', 'failed', 'not_attempted'));

ALTER TABLE public.esign_recipients DROP CONSTRAINT IF EXISTS esign_recipients_link_sms_status_chk;
ALTER TABLE public.esign_recipients
  ADD CONSTRAINT esign_recipients_link_sms_status_chk
  CHECK (link_sms_status IS NULL OR link_sms_status IN ('sent', 'failed', 'not_attempted'));

COMMENT ON COLUMN public.esign_recipients.link_token IS
  'Service role only. Lets a resend email the same link while it is still valid. Staff must not select this column.';

-- Staff keep their existing row read. They do not get the raw signing secret.
REVOKE ALL ON TABLE public.esign_recipients FROM anon;
REVOKE SELECT (link_token), INSERT (link_token), UPDATE (link_token) ON TABLE public.esign_recipients FROM authenticated, anon;
GRANT SELECT (link_token), INSERT (link_token), UPDATE (link_token) ON TABLE public.esign_recipients TO service_role;
