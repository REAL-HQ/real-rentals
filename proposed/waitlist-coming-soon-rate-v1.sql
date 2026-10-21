-- PROPOSED ONLY. Owner decision. This file is not a migration and must not be run.
-- Do not copy it into drizzle/migrations or supabase/migrations.
--
-- Coming Soon stays the public browser insert. The application does not
-- call this function. A real limit has to live in the database, because a
-- counter in the browser or in audit_log can be skipped.
--
-- Applying this trigger refuses a homepage_waitlist insert when that email
-- already has 5 rows in the last hour. There is no IP column on waitlist.
-- An IP limit would store a hash and is a separate owner decision, not
-- part of this proposal.
--
-- WAITLIST_CLAIM_ENABLED does not turn this on.

CREATE OR REPLACE FUNCTION public.waitlist_coming_soon_email_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recent integer;
BEGIN
  IF NEW.source IS DISTINCT FROM 'homepage_waitlist' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO recent
  FROM public.waitlist
  WHERE source = 'homepage_waitlist'
    AND lower(email) = lower(NEW.email)
    AND created_at > now() - interval '1 hour';
  IF recent >= 5 THEN
    RAISE EXCEPTION 'waitlist coming soon rate limit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit ON public.waitlist;
CREATE TRIGGER waitlist_coming_soon_email_limit
  BEFORE INSERT ON public.waitlist
  FOR EACH ROW
  EXECUTE FUNCTION public.waitlist_coming_soon_email_limit();
