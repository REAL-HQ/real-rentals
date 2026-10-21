-- PROPOSED ONLY. Owner decision. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- Coming Soon stays the public browser insert. The application does not
-- call this function. A real limit has to live in the database, because a
-- counter in the browser or in audit_log can be skipped.
--
-- This limit is email-only. There is no IP column on waitlist. An IP limit
-- would store a hash and is a separate owner decision, not part of this proposal.
-- The count includes every source. A second source cannot dodge the limit.
--
-- The function is SECURITY DEFINER with an empty search_path so the count is
-- not the inserting role's and a caller cannot redirect an unqualified name.
-- An invoker function fails every anon insert with "permission denied for
-- table waitlist", and a definer that still obeyed RLS would see none of the
-- rows an authenticated user is hidden from, so the limit would never trip.
-- The advisory lock serializes one email. The key is btrim(lower(email)),
-- so surrounding spaces do not open a second bucket. The index matches that count.
--
-- created_at is not an anon insert column. The trigger stamps it so a
-- backdated value cannot fall outside the hour. Anon is not granted the column.
--
-- Applying this trigger refuses an insert when that email already has 5 rows
-- of any source in the last hour.
--
-- WAITLIST_CLAIM_ENABLED does not turn this on.

CREATE OR REPLACE FUNCTION public.waitlist_coming_soon_email_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- EXECUTE only lets the inserting role fire this trigger. It is not a
-- SELECT grant. The count runs as the function owner because the function
-- is security definer, and anon still has no SELECT on waitlist.
GRANT EXECUTE ON FUNCTION public.waitlist_coming_soon_email_limit() TO anon, authenticated;

DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit ON public.waitlist;
CREATE TRIGGER waitlist_coming_soon_email_limit
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.waitlist_coming_soon_email_limit();

CREATE INDEX IF NOT EXISTS waitlist_coming_soon_email_created_idx
  ON public.waitlist (pg_catalog.btrim(pg_catalog.lower(email)), created_at);
