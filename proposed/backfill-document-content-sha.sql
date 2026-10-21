-- Backfill documents.content_sha256 and storage.objects.user_metadata.sha256.
-- Not a HOSTED-INSTALL step. Do not run this on a hosted database.
--
-- Read-only unless this session has both of these, and the server address is
-- loopback or a local socket:
--   SELECT set_config('m2.backfill_content_sha', 'write', true);
--   SELECT set_config('m2.backfill_local', 'yes', true);
-- A write request from anywhere else raises backfill_refused_not_local and
-- changes nothing.
--
-- Dry-run reports documents whose content hash or stored object hash is missing.
-- Write mode copies a hash that already exists on one side onto the empty side.
-- A mismatch is reported and left as it is. When both sides are empty and the
-- caller has created temp table backfill_object_bytes(bucket_id text, name text,
-- bytes bytea), the bytes are hashed with extensions.digest and both sides are
-- set. This script does not invent a hash and does not upload a file.
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
  write_mode boolean := false;
  addr inet;
  local_ok boolean;
  has_bytes boolean;
  missing integer;
  wrote integer := 0;
  mismatched integer := 0;
  skipped integer := 0;
  rec record;
  n integer;
  obj_id uuid;
  obj_sha text;
  doc_sha text;
  byte_sha text;
BEGIN
  addr := inet_server_addr();
  local_ok := addr IS NULL OR addr <<= inet '127.0.0.0/8' OR addr = inet '::1';
  IF current_setting('m2.backfill_content_sha', true) IS NOT DISTINCT FROM 'write' THEN
    IF current_setting('m2.backfill_local', true) IS DISTINCT FROM 'yes' OR NOT local_ok THEN
      RAISE EXCEPTION 'backfill_refused_not_local' USING ERRCODE = '42501';
    END IF;
    write_mode := true;
  END IF;

  SELECT count(*) INTO missing
  FROM public.documents d
  WHERE nullif(btrim(d.storage_bucket), '') IS NOT NULL
    AND nullif(btrim(d.storage_path), '') IS NOT NULL
    AND (
      d.content_sha256 IS NULL OR d.content_sha256 !~ '^[0-9a-f]{64}$'
      OR NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = d.storage_bucket AND o.name = d.storage_path
          AND nullif(lower(btrim(coalesce(o.user_metadata->>'sha256', o.user_metadata->>'content_sha256'))), '') ~ '^[0-9a-f]{64}$'
      )
    );

  IF NOT write_mode THEN
    INSERT INTO backfill_report VALUES ('dry-run', missing, 0, 0, 0);
    RAISE NOTICE 'backfill dry-run missing=%', missing;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.relname = 'backfill_object_bytes' AND c.relkind = 'r' AND c.relpersistence = 't'
  ) INTO has_bytes;

  FOR rec IN
    SELECT d.id, d.storage_bucket, d.storage_path, d.content_sha256
    FROM public.documents d
    WHERE nullif(btrim(d.storage_bucket), '') IS NOT NULL
      AND nullif(btrim(d.storage_path), '') IS NOT NULL
  LOOP
    SELECT count(*) INTO n FROM storage.objects o
    WHERE o.bucket_id = rec.storage_bucket AND o.name = rec.storage_path;
    IF n <> 1 THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    SELECT o.id,
      nullif(lower(btrim(coalesce(o.user_metadata->>'sha256', o.user_metadata->>'content_sha256'))), '')
      INTO obj_id, obj_sha
    FROM storage.objects o
    WHERE o.bucket_id = rec.storage_bucket AND o.name = rec.storage_path;
    doc_sha := nullif(lower(btrim(rec.content_sha256)), '');
    IF doc_sha IS NOT NULL AND doc_sha !~ '^[0-9a-f]{64}$' THEN
      doc_sha := NULL;
    END IF;
    IF obj_sha IS NOT NULL AND obj_sha !~ '^[0-9a-f]{64}$' THEN
      obj_sha := NULL;
    END IF;

    IF doc_sha IS NOT NULL AND obj_sha IS NOT NULL AND doc_sha IS DISTINCT FROM obj_sha THEN
      mismatched := mismatched + 1;
      RAISE NOTICE 'backfill mismatch document %', rec.id;
      CONTINUE;
    END IF;
    IF doc_sha IS NOT NULL AND obj_sha IS NOT NULL THEN
      CONTINUE;
    END IF;

    byte_sha := NULL;
    IF doc_sha IS NULL AND obj_sha IS NULL AND has_bytes AND rec.storage_path NOT LIKE 'immutable-v1/%' THEN
      SELECT encode(extensions.digest(b.bytes, 'sha256'), 'hex') INTO byte_sha
      FROM backfill_object_bytes b
      WHERE b.bucket_id = rec.storage_bucket AND b.name = rec.storage_path;
    END IF;

    IF doc_sha IS NULL AND obj_sha IS NOT NULL THEN
      UPDATE public.documents SET content_sha256 = obj_sha WHERE id = rec.id AND content_sha256 IS NULL;
      wrote := wrote + 1;
    ELSIF obj_sha IS NULL AND doc_sha IS NOT NULL THEN
      UPDATE storage.objects
      SET user_metadata = coalesce(user_metadata, '{}'::jsonb) || jsonb_build_object('sha256', doc_sha)
      WHERE id = obj_id;
      wrote := wrote + 1;
    ELSIF doc_sha IS NULL AND obj_sha IS NULL AND byte_sha IS NOT NULL THEN
      UPDATE public.documents SET content_sha256 = byte_sha WHERE id = rec.id AND content_sha256 IS NULL;
      UPDATE storage.objects
      SET user_metadata = coalesce(user_metadata, '{}'::jsonb) || jsonb_build_object('sha256', byte_sha)
      WHERE id = obj_id
        AND nullif(lower(btrim(coalesce(user_metadata->>'sha256', user_metadata->>'content_sha256'))), '') IS NULL;
      wrote := wrote + 1;
    END IF;
  END LOOP;

  INSERT INTO backfill_report VALUES ('write', missing, wrote, mismatched, skipped);
  RAISE NOTICE 'backfill write missing=% wrote=% mismatched=% skipped=%', missing, wrote, mismatched, skipped;
END
$backfill$;

SELECT mode, missing, wrote, mismatched, skipped FROM backfill_report;
