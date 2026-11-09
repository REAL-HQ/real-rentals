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

-- A column-level REVOKE does nothing while the role still holds the table
-- privilege. Take the table privileges away, then grant columns explicitly.
-- service_role keeps its table-level ALL, so the server can still store and
-- clear the hash.
--
-- anon INSERT is only the 12 columns from migration 20260721192708. Anon
-- does not receive id, created_at, city, state, status, pickup_date,
-- notified_at, promoted_application_id, promoted_at, review_reason, or
-- review_flagged_at. created_at is stamped by the rate trigger.
-- authenticated INSERT, UPDATE, and SELECT are every column except
-- claim_token_hash. The only browser read is WebsitesPanel's market_id.
REVOKE INSERT, UPDATE ON public.waitlist FROM anon, authenticated;
REVOKE SELECT ON public.waitlist FROM authenticated;

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

GRANT INSERT (
  id,
  market_id,
  full_name,
  email,
  phone,
  driver_status,
  source,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  gclid,
  created_at,
  city,
  state,
  status,
  pickup_date,
  notified_at,
  promoted_application_id,
  promoted_at,
  review_reason,
  review_flagged_at
) ON public.waitlist TO authenticated;

GRANT UPDATE (
  id,
  market_id,
  full_name,
  email,
  phone,
  driver_status,
  source,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  gclid,
  created_at,
  city,
  state,
  status,
  pickup_date,
  notified_at,
  promoted_application_id,
  promoted_at,
  review_reason,
  review_flagged_at
) ON public.waitlist TO authenticated;

GRANT SELECT (
  id,
  market_id,
  full_name,
  email,
  phone,
  driver_status,
  source,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  gclid,
  created_at,
  city,
  state,
  status,
  pickup_date,
  notified_at,
  promoted_application_id,
  promoted_at,
  review_reason,
  review_flagged_at
) ON public.waitlist TO authenticated;
