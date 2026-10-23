-- A faithful model of the sealed package's three gates plus the five policies.
-- The five CREATE POLICY statements are VERBATIM from the approved inner SQL
-- (sha256 cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723),
-- with only the schema-qualified names unchanged. The gates reproduce the real
-- checks: the role pin, a catalog seal, and the journal pin at 23 rows.
--
-- The expected role is read from the pkg.expected_role GUC, set in the same
-- psql session: psql variables are NOT substituted inside a dollar-quoted body.
DO $pkg$
DECLARE
  expected_role text := current_setting('pkg.expected_role');
  journal_rows integer;
BEGIN
  -- GATE 1: role pin. Real package: current_user IS DISTINCT FROM
  -- profile->>'execution_role' THEN RAISE EXCEPTION 'TARGET_MISMATCH'
  IF current_user IS DISTINCT FROM expected_role THEN
    RAISE EXCEPTION 'TARGET_MISMATCH: current_user=% expected=%', current_user, expected_role;
  END IF;

  -- GATE 2: partial-install refusal, verbatim in spirit.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = ANY (ARRAY[
      'coordinator_application_containment','coordinator_review_containment',
      'coordinator_document_containment','coordinator_identity_storage_containment',
      'coordinator_agreement_containment'])) THEN
    RAISE EXCEPTION 'PARTIAL_INSTALL';
  END IF;

  -- GATE 3: journal pin. Production holds 23 rows and the Supabase route does
  -- not write this ledger, so 23 must still be 23 at install time.
  SELECT count(*) INTO journal_rows FROM drizzle.__drizzle_migrations;
  IF journal_rows <> 23 THEN
    RAISE EXCEPTION 'JOURNAL_DRIFT_OR_REPLAY: % rows, expected 23', journal_rows;
  END IF;

  -- The five policies, one transaction.
  CREATE POLICY coordinator_application_containment ON public.applications
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

  CREATE POLICY coordinator_review_containment ON public.application_identity_reviews
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

  CREATE POLICY coordinator_document_containment ON public.documents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE OR (
   driver_id IS NULL AND
   storage_bucket NOT IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements') AND
   coalesce(category,'') NOT IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording','agreement')
  ));

  CREATE POLICY coordinator_identity_storage_containment ON storage.objects
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE OR
   bucket_id NOT IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements'));

  IF to_regclass('public.agreements') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY coordinator_agreement_containment ON public.agreements
     AS RESTRICTIVE FOR SELECT TO authenticated
     USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE)';
  END IF;

  RAISE NOTICE 'INSTALL_OK';
END
$pkg$;
