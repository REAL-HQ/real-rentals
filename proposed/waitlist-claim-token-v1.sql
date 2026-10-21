-- PROPOSED ONLY. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- Single-use waitlist claim links. The application stores SHA-256(nonce)
-- in claim_token_hash when it sends the opening email, and clears that
-- hash on the first successful open. Until this column exists, the enabled
-- claim path fails closed: it does not send a link and it does not prefill.
--
-- Activation also needs a new secret, WAITLIST_CLAIM_SECRET, at least 32
-- characters and different from the service-role key. The flag stays false
-- until an owner sets that secret and applies this column.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS claim_token_hash text;

COMMENT ON COLUMN public.waitlist.claim_token_hash IS
  'SHA-256 of the one-time claim nonce. Null after the link is opened. Not an application resume token.';

REVOKE INSERT (claim_token_hash), UPDATE (claim_token_hash)
  ON public.waitlist FROM anon, authenticated;
