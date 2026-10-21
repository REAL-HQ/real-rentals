-- Report documents.content_sha256 against the server binding.
-- Not a HOSTED-INSTALL step. Does not write a hash. Does not read bytes.
-- SQL cannot download Storage, so this file cannot set a content hash.
-- The writer is scripts/backfill-document-content-sha.ts --write.
--
-- Counts current license_front and license_back rows:
--   missing: no single stored object, a blank content hash, or no server binding
--   mismatched: a hash or object that does not match private.uploaded_content_sha
--   skipped: more than one stored object for the path
--   wrote: always 0
-- A client-set user_metadata.sha256 is not a hash. Copying it is refused.
-- Setting m2.backfill_content_sha to write raises backfill_refused_report_only.
--
-- No BEGIN. Include it inside the caller's transaction, or run it alone.

CREATE TEMP TABLE IF NOT EXISTS backfill_report (
  mode text NOT NULL,
  missing integer NOT NULL,
  wrote integer NOT NULL,
  mismatched integer NOT NULL,
  skipped integer NOT NULL
);
DELETE FROM backfill_report;

DO $backfill$
DECLARE
  missing integer := 0;
  mismatched integer := 0;
  skipped integer := 0;
  rec record;
  n integer;
  obj_id uuid;
  obj_meta jsonb;
  obj_ver text;
  obj_at timestamptz;
  has_version boolean;
  bind_id uuid;
  bind_sha text;
  bind_meta jsonb;
  bind_ver text;
  bind_at timestamptz;
  doc_sha text;
BEGIN
  IF current_setting('m2.backfill_content_sha', true) IS NOT DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'backfill_refused_report_only' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'storage' AND c.relname = 'objects' AND a.attname = 'version' AND a.attnum > 0 AND NOT a.attisdropped
  ) INTO has_version;

  FOR rec IN
    SELECT d.id, d.storage_bucket, d.storage_path, d.content_sha256
    FROM public.documents d
    WHERE d.is_current IS TRUE
      AND d.category IN ('license_front', 'license_back')
      AND nullif(btrim(d.storage_bucket), '') IS NOT NULL
      AND nullif(btrim(d.storage_path), '') IS NOT NULL
  LOOP
    SELECT count(*) INTO n FROM storage.objects o
    WHERE o.bucket_id = rec.storage_bucket AND o.name = rec.storage_path;
    IF n > 1 THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    IF n = 0 THEN
      missing := missing + 1;
      CONTINUE;
    END IF;

    obj_ver := NULL;
    IF has_version THEN
      EXECUTE $q$
        SELECT id, user_metadata, version, updated_at
        FROM storage.objects
        WHERE bucket_id = $1 AND name = $2
      $q$ INTO obj_id, obj_meta, obj_ver, obj_at USING rec.storage_bucket, rec.storage_path;
    ELSE
      EXECUTE $q$
        SELECT id, user_metadata, updated_at
        FROM storage.objects
        WHERE bucket_id = $1 AND name = $2
      $q$ INTO obj_id, obj_meta, obj_at USING rec.storage_bucket, rec.storage_path;
    END IF;

    doc_sha := nullif(lower(btrim(rec.content_sha256)), '');
    IF doc_sha IS NULL OR doc_sha !~ '^[0-9a-f]{64}$' THEN
      missing := missing + 1;
      CONTINUE;
    END IF;

    SELECT b.object_id, b.sha256, b.user_metadata, b.version, b.updated_at
      INTO bind_id, bind_sha, bind_meta, bind_ver, bind_at
    FROM private.uploaded_content_sha b
    WHERE b.bucket_id = rec.storage_bucket AND b.name = rec.storage_path;
    IF NOT FOUND
       OR bind_sha IS DISTINCT FROM doc_sha
       OR bind_id IS DISTINCT FROM obj_id
       OR bind_meta IS DISTINCT FROM obj_meta
       OR (bind_ver IS NOT NULL AND nullif(btrim(obj_ver), '') IS DISTINCT FROM bind_ver)
       OR (bind_at IS NOT NULL AND obj_at IS DISTINCT FROM bind_at)
       OR nullif(lower(btrim(obj_meta->>'sha256')), '') IS DISTINCT FROM bind_sha THEN
      mismatched := mismatched + 1;
    END IF;
  END LOOP;

  INSERT INTO backfill_report VALUES ('report', missing, 0, mismatched, skipped);
  RAISE NOTICE 'backfill report missing=% wrote=0 mismatched=% skipped=%', missing, mismatched, skipped;
END
$backfill$;

SELECT mode, missing, wrote, mismatched, skipped FROM backfill_report;
