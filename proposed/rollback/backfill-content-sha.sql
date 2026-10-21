-- Owner undo for the license-byte backfill.
-- Not an install step. The preflight reader does not run it.
-- service_role cannot delete private.uploaded_content_sha (revoked, no policy).
-- The table owner runs this file. It clears current license_front and
-- license_back fingerprints and deletes the matching binding rows.
-- A document with is_current false is left alone. A document whose driver_id
-- is an application with deleted_at set is left alone.
-- Clearing documents.content_sha256 by itself does not remove the binding.

BEGIN;

DELETE FROM private.uploaded_content_sha AS b
USING public.documents AS d
WHERE d.is_current IS TRUE
  AND d.category IN ('license_front', 'license_back')
  AND b.bucket_id = d.storage_bucket
  AND b.name = d.storage_path
  AND NOT EXISTS (
    SELECT 1
    FROM public.applications AS a
    WHERE a.id = d.driver_id
      AND a.deleted_at IS NOT NULL
  );

UPDATE public.documents AS d
SET content_sha256 = NULL
WHERE d.is_current IS TRUE
  AND d.category IN ('license_front', 'license_back')
  AND NOT EXISTS (
    SELECT 1
    FROM public.applications AS a
    WHERE a.id = d.driver_id
      AND a.deleted_at IS NOT NULL
  );

COMMIT;
