-- READ-ONLY role access test for Security 0031 (used for the 2026-10-24 baseline in
-- ../0031-direct-attempt-2026-10-24/access-baseline.json). One statement that always aborts:
-- for each Owner (admin), Manager (team), Coordinator and the first driver it switches to
-- the API's `authenticated` role with that user's id and counts what row-level security
-- returns. Counts only, no rows, no writes. After 0031: Owner and Manager unchanged from the
-- baseline; a Coordinator, if one exists, sees 0 applications, reviews, identity documents,
-- agreements and identity objects.
DO $rraccess$
DECLARE r record; res jsonb := '{}'::jsonb; c jsonb;
BEGIN
 FOR r IN SELECT ur.user_id, ur.role::text AS role, row_number() OVER (PARTITION BY ur.role ORDER BY ur.user_id) AS k FROM public.user_roles ur WHERE ur.role::text IN ('admin','team','coordinator','driver') LOOP
  CONTINUE WHEN r.role = 'driver' AND r.k > 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_build_object(
   'applications', (SELECT count(*) FROM public.applications),
   'identity_reviews', (SELECT count(*) FROM public.application_identity_reviews),
   'documents', (SELECT count(*) FROM public.documents),
   'identity_documents', (SELECT count(*) FROM public.documents WHERE storage_bucket IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements') OR category IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording','agreement')),
   'agreements', (SELECT count(*) FROM public.agreements),
   'identity_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements')),
   'vehicles', (SELECT count(*) FROM public.vehicles)) INTO c;
  EXECUTE 'RESET ROLE';
  res := res || jsonb_build_object(r.role || '_' || r.k, c);
 END LOOP;
 RAISE EXCEPTION 'RR0031_ACCESS %', res;
END $rraccess$;
