-- Rollback for 06b-approval-identity-check.sql. Restores the step 6 check.
-- UNUSED INSTALL ONLY. A verified approval_identity row is legal under 06b
-- and illegal under the step 6 check this file restores. After any such row
-- exists, do not run this file and do not delete the row to make it run.
-- Leave 06b installed. The historical review is valid only while that check
-- remains. Run after later steps, and before proposed/rollback/06-document-identity.sql.
BEGIN;
DO $guard$
BEGIN
  IF to_regclass('public.application_identity_reviews') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.application_identity_reviews
    WHERE NOT (
      (kind='positive_license_v1' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND positive_evidence_v1 IS NOT NULL)
      OR (kind<>'positive_license_v1' AND positive_evidence_v1 IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed')))
    )
  ) THEN
    RAISE EXCEPTION '06b_rollback_unused_install_only' USING ERRCODE='55000';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.integrity_serialize_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM private.approval_lock(); RETURN NULL; END $$;
ALTER TABLE public.application_identity_reviews DROP CONSTRAINT IF EXISTS application_identity_reviews_resolution_check;
ALTER TABLE public.application_identity_reviews ADD CONSTRAINT application_identity_reviews_resolution_check CHECK (
 (kind='positive_license_v1' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND positive_evidence_v1 IS NOT NULL)
 OR (kind<>'positive_license_v1' AND positive_evidence_v1 IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed'))));
COMMIT;
