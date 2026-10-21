-- proposed/waitlist-claim-token-v1.sql
--
-- This is not a migration. It is not under drizzle/ or supabase/.
-- Do not run it from CI, and do not run it against a hosted database
-- from an agent. An owner applies it before turning WAITLIST_CLAIM_ENABLED
-- on. Until this column exists, a claim link fails closed.
--
-- Adding a nullable column does not change an insert or update that leaves
-- the column out. The public Coming Soon insert does not name it.

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS claim_token_hash text;

COMMENT ON COLUMN public.waitlist.claim_token_hash IS
  'SHA-256 hex of the single-use claim nonce. The service role sets it after the opening email is accepted and clears it on the first successful open.';

-- The public insert and staff update grants are table-wide, so they would
-- include this column. Take it back. Omitting the column still works.
REVOKE INSERT (claim_token_hash), UPDATE (claim_token_hash)
  ON public.waitlist FROM anon, authenticated;
