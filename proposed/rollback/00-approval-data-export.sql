-- Optional. Read-only. Run in psql BEFORE proposed/rollback/00-approval-boundary.sql
-- when those rows should be kept outside the database.
--
-- Rollback 00 drops private.approval_operations and the columns
-- public.application_identity_reviews.approval_evidence and
-- public.applications.approval_evidence_version. After that file commits,
-- those values are gone. This script does not change the database.
-- Skip it on an unused install that has nothing to keep.

COPY (SELECT row_to_json(t) FROM private.approval_operations t) TO STDOUT;
COPY (
  SELECT row_to_json(t) FROM (
    SELECT id, approval_evidence FROM public.application_identity_reviews WHERE approval_evidence IS NOT NULL
  ) t
) TO STDOUT;
COPY (
  SELECT row_to_json(t) FROM (
    SELECT id, approval_evidence_version FROM public.applications WHERE approval_evidence_version IS DISTINCT FROM 0
  ) t
) TO STDOUT;
