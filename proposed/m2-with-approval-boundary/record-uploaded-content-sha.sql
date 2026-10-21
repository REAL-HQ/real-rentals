-- Proposed packet step. The M2 rehearsal installs this file. A hosted run
-- follows proposed/HOSTED-INSTALL.md. Not an app migration.
-- Hosted PostgREST exposes public and graphql_public, so the app cannot
-- UPDATE storage.objects. This function is the supported write.
--
-- Install this file before the approval boundary. Hash-on-upload and the
-- byte backfill call it, and the snapshot reads the binding it writes.
--
-- Before it writes, the bucket and path must already be a documents row, or a
-- known application upload (license-uploads license or insurance path,
-- profile-screenshots profile or trip path). immutable-v1 paths are refused.
-- It overwrites user_metadata.sha256 with the digest of bytes the caller
-- downloaded. A client-set sha256 or content_sha256 key is not kept. It sets
-- documents.content_sha256 when that row's hash is still null, and it refuses
-- when a stored hash differs. The object update matches id and version, or
-- updated_at when version is absent. Zero rows means the object changed after
-- it was hashed, and the transaction raises.
--
-- The same call records private.uploaded_content_sha: the sha, the object id,
-- the version, updated_at, and the user_metadata just written. Only this
-- function writes that table. Approval compares the live object to that row.
--
-- This file is one transaction. Run it with ON_ERROR_STOP. Do not also pass psql -1.
BEGIN;

CREATE TABLE private.uploaded_content_sha (
  bucket_id text NOT NULL,
  name text NOT NULL,
  object_id uuid NOT NULL,
  version text,
  updated_at timestamptz,
  user_metadata jsonb NOT NULL,
  sha256 text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (bucket_id, name),
  CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON TABLE private.uploaded_content_sha FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE private.uploaded_content_sha ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.record_uploaded_content_sha(
  p_bucket text,
  p_path text,
  p_sha256 text,
  p_object_id uuid,
  p_version text,
  p_updated_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer;
  has_version boolean;
  mismatched integer;
  claimed boolean;
  live_meta jsonb;
  live_ver text;
  live_at timestamptz;
BEGIN
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'content_sha256_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_object_id IS NULL OR nullif(btrim(p_bucket), '') IS NULL OR nullif(btrim(p_path), '') IS NULL THEN
    RAISE EXCEPTION 'content_sha256_object_changed' USING ERRCODE = '40001';
  END IF;
  IF p_path LIKE 'immutable-v1/%' THEN
    RAISE EXCEPTION 'content_sha256_immutable' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.documents
    WHERE storage_bucket = p_bucket AND storage_path = p_path
  ) OR EXISTS (
    SELECT 1 FROM public.applications
    WHERE (p_bucket = 'license-uploads' AND (license_photo_url = p_path OR insurance_doc_url = p_path))
       OR (p_bucket = 'profile-screenshots' AND (
            profile_screenshot_url = p_path
            OR (trip_screenshots IS NOT NULL AND p_path = ANY (trip_screenshots))
          ))
  ) INTO claimed;
  IF NOT claimed THEN
    RAISE EXCEPTION 'content_sha256_unclaimed' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'storage' AND c.relname = 'objects' AND a.attname = 'version' AND a.attnum > 0 AND NOT a.attisdropped
  ) INTO has_version;

  IF has_version AND nullif(btrim(p_version), '') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE storage.objects
      SET user_metadata = (COALESCE(user_metadata, '{}'::jsonb) - 'content_sha256') || jsonb_build_object('sha256', $1)
      WHERE id = $2 AND bucket_id = $3 AND name = $4 AND version IS NOT DISTINCT FROM $5
    $q$ USING p_sha256, p_object_id, p_bucket, p_path, p_version;
  ELSIF p_updated_at IS NOT NULL THEN
    EXECUTE $q$
      UPDATE storage.objects
      SET user_metadata = (COALESCE(user_metadata, '{}'::jsonb) - 'content_sha256') || jsonb_build_object('sha256', $1)
      WHERE id = $2 AND bucket_id = $3 AND name = $4 AND updated_at IS NOT DISTINCT FROM $5
    $q$ USING p_sha256, p_object_id, p_bucket, p_path, p_updated_at;
  ELSE
    RAISE EXCEPTION 'content_sha256_object_changed' USING ERRCODE = '40001';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'content_sha256_object_changed' USING ERRCODE = '40001';
  END IF;

  SELECT count(*) INTO mismatched
  FROM public.documents
  WHERE storage_bucket = p_bucket AND storage_path = p_path
    AND content_sha256 IS NOT NULL AND content_sha256 IS DISTINCT FROM p_sha256;
  IF mismatched <> 0 THEN
    RAISE EXCEPTION 'content_sha256_mismatch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uploaded_content_sha
    WHERE bucket_id = p_bucket AND name = p_path AND sha256 IS DISTINCT FROM p_sha256
  ) THEN
    RAISE EXCEPTION 'content_sha256_mismatch' USING ERRCODE = '23514';
  END IF;
  UPDATE public.documents
  SET content_sha256 = p_sha256
  WHERE storage_bucket = p_bucket AND storage_path = p_path
    AND content_sha256 IS NULL;

  IF has_version THEN
    EXECUTE 'SELECT user_metadata, version, updated_at FROM storage.objects WHERE id = $1'
      INTO live_meta, live_ver, live_at USING p_object_id;
  ELSE
    EXECUTE 'SELECT user_metadata, updated_at FROM storage.objects WHERE id = $1'
      INTO live_meta, live_at USING p_object_id;
  END IF;
  IF live_meta IS NULL OR nullif(lower(btrim(live_meta->>'sha256')), '') IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'content_sha256_object_changed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO private.uploaded_content_sha (bucket_id, name, object_id, version, updated_at, user_metadata, sha256)
  VALUES (p_bucket, p_path, p_object_id, nullif(btrim(live_ver), ''), live_at, live_meta, p_sha256)
  ON CONFLICT (bucket_id, name) DO UPDATE
    SET object_id = EXCLUDED.object_id,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at,
        user_metadata = EXCLUDED.user_metadata,
        sha256 = EXCLUDED.sha256,
        recorded_at = pg_catalog.clock_timestamp()
    WHERE private.uploaded_content_sha.sha256 IS NOT DISTINCT FROM EXCLUDED.sha256;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'content_sha256_mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN p_sha256;
END $$;

REVOKE ALL ON FUNCTION public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) TO service_role;

COMMIT;
