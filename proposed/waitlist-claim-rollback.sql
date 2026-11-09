-- PROPOSED ONLY. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- Reverses proposed/waitlist-claim-token-v1.sql and
-- proposed/waitlist-coming-soon-rate-v1.sql.
-- After it runs, waitlist matches the grants from migration
-- 20260721192708 and drizzle 0017: anon INSERT on the 12 Coming Soon
-- columns, and authenticated table-level SELECT, INSERT, and UPDATE.
-- service_role is left alone.

DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit ON public.waitlist;
DROP FUNCTION IF EXISTS public.waitlist_coming_soon_email_limit();
DROP INDEX IF EXISTS public.waitlist_coming_soon_email_created_idx;

-- Table REVOKE also clears the column grants the proposal added.
REVOKE INSERT, UPDATE, SELECT ON public.waitlist FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.waitlist TO authenticated;

GRANT INSERT (
  full_name,
  email,
  phone,
  market_id,
  driver_status,
  source,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  gclid
) ON public.waitlist TO anon;

ALTER TABLE public.waitlist DROP COLUMN IF EXISTS claim_token_hash;
