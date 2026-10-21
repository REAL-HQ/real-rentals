-- HOSTED-INSTALL step 2: proposed/m3-packet/02-waitlist-coming-soon-rate.sql
-- Proposed only. Not a drizzle or supabase migration. Nothing in this
-- repository applies this file. Owner approval is required before any
-- hosted run.
--
-- Source: proposed/waitlist-coming-soon-rate-v1.sql on
-- cursor/waitlist-claim-b1d6 at dda2f73b (PR #173). Coming Soon stays a
-- public browser insert. The application does not call this function.
-- A counter in the browser or in audit_log can be skipped, so the limit
-- lives here.
--
-- Email only: 5 rows for btrim(lower(email)) in the last hour, every
-- source. There is no IP column on public.waitlist, so this file does
-- not add an IP limit. It does not read WAITLIST_CLAIM_SECRET and it
-- does not add claim_token_hash. That secret is an application HMAC key
-- (PR #173), at least 32 bytes, and it is not the service-role key.
--
-- SECURITY DEFINER is required. An invoker count runs as the inserting
-- role. anon has no SELECT on public.waitlist, so the insert would fail
-- with permission denied. A definer that still obeyed row level security
-- would not see another session's rows, and the limit would not trip.
-- The empty search_path keeps the definer from following an unqualified
-- name. The installer must own this function and must be superuser or
-- BYPASSRLS. The preflight checks that.
--
-- The source file grants EXECUTE to anon and authenticated. A local
-- rehearsal showed the trigger body still runs when the inserting role's
-- EXECUTE privilege is false: the body runs as the function owner.
-- This file revokes PUBLIC, anon, authenticated, and service_role. It
-- does not grant. Existing anon column inserts are left as they are.
-- created_at is not an anon insert column. The trigger stamps it so a
-- backdated value cannot fall outside the hour. The trigger is BEFORE
-- INSERT FOR EACH ROW and does not look at the role, so service_role and
-- staff inserts get the same stamp and the same five-row limit.

BEGIN;
SET LOCAL lock_timeout = '2s';

DO $m3$
DECLARE
  waiting bigint;
  definer boolean;
  src text;
  empty_path boolean;
  trigger_table regclass;
  index_table name;
BEGIN
  SELECT count(*) INTO waiting FROM public.waitlist;
  IF waiting IS NULL THEN
    RAISE EXCEPTION 'waitlist_count_failed';
  END IF;

  SELECT p.prosecdef,
         p.prosrc,
         EXISTS (
           SELECT 1
           FROM unnest(p.proconfig) AS item
           WHERE pg_catalog.replace(item, '"', '') = 'search_path='
         )
    INTO definer, src, empty_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'waitlist_coming_soon_email_limit';
  IF FOUND AND (
    definer IS NOT TRUE
    OR empty_path IS NOT TRUE
    OR src NOT LIKE '%waitlist coming soon rate limit%'
    OR src LIKE '%claim_token_hash%'
    OR src LIKE '%WAITLIST_CLAIM_SECRET%'
  ) THEN
    RAISE EXCEPTION 'waitlist_rate_function_conflict';
  END IF;

  SELECT t.tgrelid::regclass INTO trigger_table
  FROM pg_catalog.pg_trigger t
  WHERE t.tgname = 'waitlist_coming_soon_email_limit'
    AND NOT t.tgisinternal;
  IF FOUND AND trigger_table IS DISTINCT FROM 'public.waitlist'::regclass THEN
    RAISE EXCEPTION 'waitlist_rate_trigger_conflict';
  END IF;

  SELECT i.tablename INTO index_table
  FROM pg_catalog.pg_indexes i
  WHERE i.schemaname = 'public'
    AND i.indexname = 'waitlist_coming_soon_email_created_idx';
  IF FOUND AND (
    index_table IS DISTINCT FROM 'waitlist'
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes existing
      WHERE existing.schemaname = 'public'
        AND existing.indexname = 'waitlist_coming_soon_email_created_idx'
        AND existing.indexdef LIKE '%btrim%'
        AND existing.indexdef LIKE '%lower%'
        AND existing.indexdef LIKE '%created_at%'
    )
  ) THEN
    RAISE EXCEPTION 'waitlist_rate_index_conflict';
  END IF;

  RAISE NOTICE 'm3 step 2 preflight waitlist=%', waiting;
END
$m3$;

CREATE OR REPLACE FUNCTION public.waitlist_coming_soon_email_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  recent integer;
BEGIN
  NEW.created_at := pg_catalog.now();
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('waitlist_coming_soon'),
    pg_catalog.hashtext(pg_catalog.btrim(pg_catalog.lower(NEW.email)))
  );
  SELECT count(*) INTO recent
  FROM public.waitlist
  WHERE pg_catalog.btrim(pg_catalog.lower(email)) = pg_catalog.btrim(pg_catalog.lower(NEW.email))
    AND created_at > pg_catalog.now() - interval '1 hour';
  IF recent >= 5 THEN
    RAISE EXCEPTION 'waitlist coming soon rate limit';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.waitlist_coming_soon_email_limit() IS
  'Before-insert limit of 5 waitlist rows per trimmed email per hour. Security definer so the count is not hidden by row level security. No execute grant.';

REVOKE ALL ON FUNCTION public.waitlist_coming_soon_email_limit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit ON public.waitlist;
CREATE TRIGGER waitlist_coming_soon_email_limit
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.waitlist_coming_soon_email_limit();

CREATE INDEX IF NOT EXISTS waitlist_coming_soon_email_created_idx
  ON public.waitlist (pg_catalog.btrim(pg_catalog.lower(email)), created_at);

COMMIT;
