-- PROPOSED v2, NOT APPROVED FOR PRODUCTION. Security 0031 Coordinator access test for a database
-- with no Coordinator account. One statement that always aborts: it borrows one existing
-- driver login, gives it the coordinator role inside this transaction only, reads aggregate
-- counts through row-level security as that user, then raises. The role row never commits,
-- so no account, role or permission changes. Counts only; no rows are returned.
-- Expected after 0031: applications, identity_reviews, identity_documents, agreements and
-- identity_objects are 0; is_staff true; is_manager false.
-- Read-only pre-check before use: triggers on public.user_roles (none may reach outside the
-- transaction), and that no coordinator exists (if one does, test with that account instead).
DO $rrcoord$
DECLARE subject uuid; counts jsonb; staff boolean; manager boolean;
BEGIN
 IF EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'coordinator') THEN
  RAISE EXCEPTION 'RRCOORD_REAL_COORDINATOR_EXISTS';
 END IF;
 SELECT ur.user_id INTO subject FROM public.user_roles ur WHERE ur.role::text = 'driver' ORDER BY ur.user_id LIMIT 1;
 IF subject IS NULL THEN RAISE EXCEPTION 'RRCOORD_NO_SUBJECT'; END IF;
 INSERT INTO public.user_roles (user_id, role) VALUES (subject, 'coordinator');
 PERFORM set_config('request.jwt.claims', json_build_object('sub', subject, 'role', 'authenticated')::text, true);
 PERFORM set_config('request.jwt.claim.sub', subject::text, true);
 -- v2: the role helpers are read before switching role (authenticated has no USAGE on schema
 -- private in production; policies reach them by OID). They still evaluate for the subject.
 SELECT private.is_staff(), private.is_manager() INTO staff, manager;
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT jsonb_build_object(
  'is_staff', staff, 'is_manager', manager,
  'applications', (SELECT count(*) FROM public.applications),
  'identity_reviews', (SELECT count(*) FROM public.application_identity_reviews),
  'identity_documents', (SELECT count(*) FROM public.documents WHERE storage_bucket IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements') OR category IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording','agreement')),
  'other_documents', (SELECT count(*) FROM public.documents WHERE driver_id IS NULL AND storage_bucket NOT IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements') AND coalesce(category,'') NOT IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording','agreement')),
  'agreements', (SELECT count(*) FROM public.agreements),
  'identity_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements')),
  'vehicles', (SELECT count(*) FROM public.vehicles)) INTO counts;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION 'RRCOORD_RESULT %', counts;
END $rrcoord$;
