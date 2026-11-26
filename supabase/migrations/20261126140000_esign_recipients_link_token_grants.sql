-- Fix authenticated grants on public.esign_recipients.link_token.
-- FILE ONLY in this PR. Do not apply until approved.
--
-- Why: a column-level REVOKE cannot remove a privilege that was granted at
-- table level. Migration 20261126120000 ran
--   REVOKE SELECT, INSERT, UPDATE (link_token) FROM authenticated, anon
-- but authenticated still had table-level ALL, so
--   has_column_privilege('authenticated', 'public.esign_recipients',
--                        'link_token', 'SELECT')
-- stayed true. Live was corrected at 8:29 PM ET on Nov 25, 2026 by revoking
-- table-level SELECT/INSERT/UPDATE from authenticated, then granting SELECT
-- on every column except link_token. service_role keeps full access, including
-- link_token. anon stays with no table privileges.
--
-- This file matches that live fix and is idempotent: on a database that
-- already has the corrected grants (including production) it is a no-op.
-- It does not change sandbox_exec (that role still has table-level SELECT
-- and INSERT, including link_token; see the PR body).

REVOKE ALL ON TABLE public.esign_recipients FROM anon;

REVOKE SELECT, INSERT, UPDATE ON TABLE public.esign_recipients FROM authenticated;

GRANT SELECT (
  id,
  document_id,
  name,
  email,
  phone,
  role,
  signing_order,
  status,
  sent_at,
  viewed_at,
  signed_at,
  ip,
  user_agent,
  auth_method,
  token_hash,
  token_expires_at,
  token_revoked_at,
  created_at,
  updated_at,
  link_channel,
  link_email_status,
  link_sms_status,
  last_viewed_at
) ON TABLE public.esign_recipients TO authenticated;

GRANT SELECT (link_token), INSERT (link_token), UPDATE (link_token)
  ON TABLE public.esign_recipients TO service_role;
