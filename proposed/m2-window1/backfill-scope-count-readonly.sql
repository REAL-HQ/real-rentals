-- READ-ONLY. One SELECT, counts and catalog flags only; returns no ids, paths, hashes or metadata values.
-- Scope = exactly the rows scripts/backfill-document-content-sha.ts writes and
-- proposed/rollback/backfill-content-sha.sql undoes: current license_front/license_back documents
-- whose application is not deleted, and the storage.objects rows they name.
-- The backfill undo is exact only if docs_hash_already_set, objects_with_content_sha256_key,
-- objects_with_sha256_key and objects_user_metadata_null are all 0 (see m2-window1/README.md).
WITH s AS (
  SELECT d.id, d.storage_bucket, d.storage_path, d.content_sha256
  FROM public.documents d
  WHERE d.is_current IS TRUE
    AND d.category IN ('license_front', 'license_back')
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL)
), j AS (
  SELECT s.id AS doc_id, o.id AS obj_id, to_jsonb(o) -> 'user_metadata' AS um
  FROM s LEFT JOIN storage.objects o ON o.bucket_id = s.storage_bucket AND o.name = s.storage_path
), objs AS (
  SELECT obj_id, min(um::text)::jsonb AS um, count(*) AS docs FROM j WHERE obj_id IS NOT NULL GROUP BY obj_id
)
SELECT jsonb_build_object(
  'docs_in_scope', (SELECT count(*) FROM s),
  'docs_hash_already_set', (SELECT count(*) FROM s WHERE content_sha256 IS NOT NULL),
  'docs_immutable_path', (SELECT count(*) FROM s WHERE storage_path LIKE 'immutable-v1/%'),
  'docs_without_object', (SELECT count(*) FROM j WHERE obj_id IS NULL),
  'docs_with_multiple_objects', (SELECT count(*) FROM (SELECT doc_id FROM j WHERE obj_id IS NOT NULL GROUP BY doc_id HAVING count(*) > 1) x),
  'objects_in_scope', (SELECT count(*) FROM objs),
  'objects_shared_by_multiple_docs', (SELECT count(*) FROM objs WHERE docs > 1),
  'objects_with_content_sha256_key', (SELECT count(*) FROM objs WHERE jsonb_typeof(um) = 'object' AND um ? 'content_sha256'),
  'objects_with_sha256_key', (SELECT count(*) FROM objs WHERE jsonb_typeof(um) = 'object' AND um ? 'sha256'),
  'objects_user_metadata_null', (SELECT count(*) FROM objs WHERE um IS NULL OR jsonb_typeof(um) = 'null'),
  'objects_user_metadata_not_object', (SELECT count(*) FROM objs WHERE um IS NOT NULL AND jsonb_typeof(um) NOT IN ('object', 'null')),
  'storage_objects_has_user_metadata', (SELECT count(*) = 1 FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attname = 'user_metadata' AND NOT attisdropped),
  'storage_objects_has_version', (SELECT count(*) = 1 FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attname = 'version' AND NOT attisdropped),
  'storage_objects_user_triggers', (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass AND NOT tgisinternal),
  'storage_objects_updated_at_trigger', (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass AND NOT tgisinternal AND pg_get_triggerdef(oid) ILIKE '%updated_at%'),
  'transaction_read_only', current_setting('transaction_read_only')
) AS backfill_scope;
