-- Rollback for 06b-approval-identity-check.sql. Restores the step 6 check.
-- Run after later steps, and before proposed/rollback/06-document-identity.sql.
BEGIN;
CREATE OR REPLACE FUNCTION private.integrity_serialize_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM private.approval_lock(); RETURN NULL; END $$;
ALTER TABLE public.application_identity_reviews DROP CONSTRAINT IF EXISTS application_identity_reviews_resolution_check;
ALTER TABLE public.application_identity_reviews ADD CONSTRAINT application_identity_reviews_resolution_check CHECK (
 (kind='positive_license_v1' AND status='resolved' AND resolution='verified' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND positive_evidence_v1 IS NOT NULL)
 OR (kind<>'positive_license_v1' AND positive_evidence_v1 IS NULL AND (resolution IS NULL OR resolution IN ('same_person','different_person','dismissed'))));
COMMIT;
