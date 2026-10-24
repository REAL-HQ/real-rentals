-- Security 0031 coordinator containment, as installed in production on 2026-10-24
-- (audit_log evidence ae016d33-b706-4421-8190-a9bbe6101ddd). This is the package's inner
-- approved DDL, byte-identical (sha256 cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723
-- for the text after this header), so harness suites run under production's policies.
-- PROPOSED ONLY. Runner owns transaction and journal write.
-- Temporary containment; no grants or stored records are changed.
-- Preserve existing permissive policies; these boundaries only subtract access.
CREATE POLICY coordinator_application_containment ON public.applications
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

-- Review notes and conflict details are not a safe status-only projection.
CREATE POLICY coordinator_review_containment ON public.application_identity_reviews
AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);

-- Metadata can carry private identity paths. Retain unrelated vehicle documents.
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

-- Existing agreements can embed full licence numbers. No eSign feature change.
DO $containment$
BEGIN
 IF to_regclass('public.agreements') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY coordinator_agreement_containment ON public.agreements
   AS RESTRICTIVE FOR SELECT TO authenticated
   USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE)';
 END IF;
END;
$containment$;
