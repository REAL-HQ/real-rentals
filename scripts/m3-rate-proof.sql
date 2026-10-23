-- Local rehearsal only. Requires the step 2 trigger. Inserts rows and
-- rolls the transaction back, so waitlist is unchanged when this file ends.
BEGIN;
DO $proof$
DECLARE
  i integer;
  stamped integer;
BEGIN
  FOR i IN 1..5 LOOP
    EXECUTE 'SET LOCAL ROLE anon';
    INSERT INTO public.waitlist (full_name, email, source)
    VALUES ('M3 Proof', 'm3-proof-anon@example.test', 'homepage_waitlist');
    EXECUTE 'RESET ROLE';
  END LOOP;

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    INSERT INTO public.waitlist (full_name, email, source)
    VALUES ('M3 Proof', 'M3-PROOF-ANON@example.test', 'homepage_waitlist');
    RAISE EXCEPTION 'mixed-case sixth insert was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%waitlist coming soon rate limit%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    INSERT INTO public.waitlist (full_name, email, source)
    VALUES ('M3 Proof', '  m3-proof-anon@example.test  ', 'homepage_waitlist');
    RAISE EXCEPTION 'padded sixth insert was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%waitlist coming soon rate limit%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.waitlist (full_name, email, source)
    VALUES ('M3 Proof', 'm3-proof-anon@example.test', 'homepage_waitlist');
    RAISE EXCEPTION 'authenticated insert bypassed the limit';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%waitlist coming soon rate limit%' THEN
        RAISE;
      END IF;
  END;

  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.waitlist (full_name, email, source)
  VALUES ('M3 Proof', 'm3-proof-auth@example.test', 'homepage_waitlist');
  EXECUTE 'RESET ROLE';

  FOR i IN 1..5 LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    INSERT INTO public.waitlist (full_name, email, source, created_at)
    VALUES (
      'M3 Proof',
      'm3-proof-stamp@example.test',
      'homepage_waitlist',
      pg_catalog.now() - interval '2 days'
    );
    EXECUTE 'RESET ROLE';
  END LOOP;

  SELECT count(*) INTO stamped
  FROM public.waitlist
  WHERE email = 'm3-proof-stamp@example.test'
    AND created_at > pg_catalog.now() - interval '5 minutes';
  IF stamped <> 5 THEN
    RAISE EXCEPTION 'created_at stamp count %', stamped;
  END IF;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    INSERT INTO public.waitlist (full_name, email, source, created_at)
    VALUES (
      'M3 Proof',
      'm3-proof-stamp@example.test',
      'office',
      pg_catalog.now() - interval '2 days'
    );
    RAISE EXCEPTION 'service_role sixth insert was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%waitlist coming soon rate limit%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.waitlist_coming_soon_email_limit();
    RAISE EXCEPTION 'anon executed the trigger function';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%permission denied%' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;

  IF (
    SELECT count(*)
    FROM public.waitlist
    WHERE email = 'm3-proof-anon@example.test'
  ) <> 5 THEN
    RAISE EXCEPTION 'anon row count drifted';
  END IF;
END
$proof$;
ROLLBACK;
