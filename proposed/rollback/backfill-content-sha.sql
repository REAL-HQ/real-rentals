-- Owner undo for the license-byte backfill.
-- Not an install step. The preflight reader does not run it.
-- service_role cannot delete private.uploaded_content_sha (revoked, no policy).
-- The table owner runs this file. It clears current license_front and
-- license_back fingerprints, removes user_metadata.sha256 on those objects,
-- and deletes the matching binding rows. It does not put back a client
-- content_sha256 key the recorder removed.
-- A document with is_current false is left alone. A document whose driver_id
-- is an application with deleted_at set is left alone.
-- Clearing documents.content_sha256 by itself does not remove the binding
-- or the object metadata.

BEGIN;

UPDATE storage.objects AS o
SET user_metadata = COALESCE(o.user_metadata, '{}'::jsonb) - 'sha256'
FROM public.documents AS d
WHERE d.is_current IS TRUE
  AND d.category IN ('license_front', 'license_back')
  AND o.bucket_id = d.storage_bucket
  AND o.name = d.storage_path
  AND (
    o.user_metadata->>'sha256' IS NOT DISTINCT FROM d.content_sha256
    OR EXISTS (
      SELECT 1
      FROM private.uploaded_content_sha AS b
      WHERE b.bucket_id = o.bucket_id
        AND b.name = o.name
        AND o.user_metadata->>'sha256' IS NOT DISTINCT FROM b.sha256
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.applications AS a
    WHERE a.id = d.driver_id
      AND a.deleted_at IS NOT NULL
  );

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
