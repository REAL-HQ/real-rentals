#!/usr/bin/env bash
# Window 1 backfill undo rehearsal, local harness only, synthetic data only.
# Seeds the profile production reported on 2026-10-24 (proposed/m2-window1/backfill-scope-count-readonly.sql):
# 24 current license documents, 20 stored objects, 4 documents without an object, every object's
# user_metadata a JSON object with neither content_sha256 nor sha256, no document hash set. Adds
# Supabase's two storage.objects triggers (definitions read from the disposable project). Then:
# record every hash as the backfill does (service_role, the step 2 recorder), run the gate report,
# run the owner undo proposed/rollback/backfill-content-sha.sql, compare every column with the
# pre-backfill snapshot, then run the step 2 and step 1 (hosted) rollbacks.
# Run: RR_HARNESS_LAST_ORD=148 bash scripts/record-rental-harness/up.sh && bash scripts/m2-window1-undo-rehearsal.sh
set -euo pipefail
cd "$(dirname "$0")/.."
U="postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable"
REF="${M2_PACKET_REF:-origin/review/m2-packet-29d47ee3}"
q() { psql "$U" -X -At -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $*"; }

q <<'SQL' >/dev/null
-- Supabase storage triggers, as on the disposable Lovable project (production reports the same two).
CREATE OR REPLACE FUNCTION storage.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN NEW.updated_at = now(); RETURN NEW; END $f$;
CREATE OR REPLACE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
    RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS update_objects_updated_at ON storage.objects;
DROP TRIGGER IF EXISTS protect_objects_delete ON storage.objects;
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

SET session_replication_role = replica;  -- seeding synthetic rows only
INSERT INTO public.applications(id, full_name, email, phone)
SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Synthetic ' || i, 'syn' || i || '@example.test', '000'
FROM generate_series(1, 13) i;
UPDATE public.applications SET deleted_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000013';
-- 20 objects in scope; user_metadata varies in shape but never carries either hash key.
INSERT INTO storage.objects(id, bucket_id, name, version, user_metadata, metadata, created_at, updated_at)
SELECT ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'driver-docs', 'syn/' || i || '.jpg', gen_random_uuid()::text,
       CASE i % 4 WHEN 0 THEN '{}'::jsonb WHEN 1 THEN '{"source":"apply"}' WHEN 2 THEN '{"a":1,"nested":{"k":[1,2]}}' ELSE '{"z":"last","a":"first"}' END,
       jsonb_build_object('eTag', md5(i::text), 'size', 1000 + i, 'mimetype', 'image/jpeg'),
       timestamptz '2026-01-01' + i * interval '1 hour', timestamptz '2026-01-02' + i * interval '1 hour'
FROM generate_series(1, 20) i;
-- Out-of-scope objects that must not change at all: one has a client content_sha256 key.
INSERT INTO storage.objects(id, bucket_id, name, version, user_metadata, updated_at) VALUES
 ('00000000-0000-4000-9000-000000000101', 'driver-docs', 'syn/not-current.jpg', 'v1', '{"content_sha256":"client"}', timestamptz '2026-01-03'),
 ('00000000-0000-4000-9000-000000000102', 'driver-docs', 'syn/deleted-app.jpg', 'v1', '{"sha256":"client"}', timestamptz '2026-01-03'),
 ('00000000-0000-4000-9000-000000000103', 'driver-docs', 'syn/insurance.pdf', 'v1', '{}', timestamptz '2026-01-03');
-- 24 in-scope documents: 20 with an object, 4 whose object does not exist.
INSERT INTO public.documents(driver_id, kind, category, is_current, storage_bucket, storage_path)
SELECT ('00000000-0000-4000-8000-' || lpad(((i + 1) / 2)::text, 12, '0'))::uuid, 'license',
       CASE WHEN i % 2 = 1 THEN 'license_front' ELSE 'license_back' END, true, 'driver-docs',
       CASE WHEN i <= 20 THEN 'syn/' || i || '.jpg' ELSE 'syn/missing-' || i || '.jpg' END
FROM generate_series(1, 24) i;
INSERT INTO public.documents(driver_id, kind, category, is_current, storage_bucket, storage_path) VALUES
 ('00000000-0000-4000-8000-000000000001', 'license', 'license_front', false, 'driver-docs', 'syn/not-current.jpg'),
 ('00000000-0000-4000-8000-000000000013', 'license', 'license_front', true, 'driver-docs', 'syn/deleted-app.jpg'),
 ('00000000-0000-4000-8000-000000000001', 'insurance', 'insurance', true, 'driver-docs', 'syn/insurance.pdf');
SET session_replication_role = origin;
CREATE TABLE public.rr_snap_docs AS SELECT * FROM public.documents;
CREATE TABLE public.rr_snap_objs AS SELECT * FROM storage.objects;
SQL

scope=$(q -f proposed/m2-window1/backfill-scope-count-readonly.sql)
echo "$scope" | grep -q '"docs_in_scope": 24' && echo "$scope" | grep -q '"objects_in_scope": 20' \
  && echo "$scope" | grep -q '"docs_without_object": 4' && echo "$scope" | grep -q '"objects_with_content_sha256_key": 0' \
  && echo "$scope" | grep -q '"storage_objects_updated_at_trigger": 1' || { echo "FAIL profile $scope"; exit 1; }
pass "synthetic state reproduces production's reported profile (24 docs, 20 objects, 4 without object, no hash keys, updated_at trigger)"

# The backfill, as scripts/backfill-document-content-sha.ts --write does it per object (writeUploadedContentSha):
# hash the downloaded bytes, then service_role calls the recorder with the object's id and version; the
# recorder merges user_metadata.sha256 itself. Synthetic bytes: the object name.
q <<'SQL' >/dev/null
SELECT pg_sleep(0.01);
SET ROLE service_role;
SELECT public.record_uploaded_content_sha(o.bucket_id, o.name, encode(sha256(convert_to(o.name, 'UTF8')), 'hex'), o.id, o.version, o.updated_at, d.id)
FROM public.documents d JOIN storage.objects o ON o.bucket_id = d.storage_bucket AND o.name = d.storage_path
WHERE d.is_current AND d.category IN ('license_front','license_back')
  AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.id = d.driver_id AND a.deleted_at IS NOT NULL);
RESET ROLE;
SQL
[ "$(q -c "select count(*) from public.documents where content_sha256 is not null")" = 20 ] \
  && [ "$(q -c "select count(*) from private.uploaded_content_sha")" = 20 ] || { echo "FAIL backfill"; exit 1; }
pass "backfill recorded 20 hashes and 20 server bindings"
gate=$(git show "$REF:proposed/backfill-document-content-sha.sql" | q -f - -c "select row_to_json(r) from backfill_report r")
echo "$gate" | grep -q '"missing":4' && echo "$gate" | grep -q '"mismatched":0' || { echo "FAIL gate $gate"; exit 1; }
pass "gate report reads missing=4 mismatched=0: the 4 documents without an object block the Window 1 gate"

q -c "select pg_sleep(0.01)" >/dev/null
git show "$REF:proposed/rollback/backfill-content-sha.sql" | q -f - >/dev/null
cmp=$(q <<'SQL'
SELECT jsonb_build_object(
 'docs_changed_excl_updated_at', (SELECT count(*) FROM public.documents d JOIN public.rr_snap_docs s USING (id) WHERE (to_jsonb(d) - 'updated_at') IS DISTINCT FROM (to_jsonb(s) - 'updated_at')),
 'docs_updated_at_changed', (SELECT count(*) FROM public.documents d JOIN public.rr_snap_docs s USING (id) WHERE d.updated_at IS DISTINCT FROM s.updated_at),
 'docs_rowcount_delta', (SELECT count(*) FROM public.documents) - (SELECT count(*) FROM public.rr_snap_docs),
 'objs_changed_excl_updated_at', (SELECT count(*) FROM storage.objects o JOIN public.rr_snap_objs s USING (id) WHERE (to_jsonb(o) - 'updated_at') IS DISTINCT FROM (to_jsonb(s) - 'updated_at')),
 'objs_user_metadata_changed', (SELECT count(*) FROM storage.objects o JOIN public.rr_snap_objs s USING (id) WHERE o.user_metadata IS DISTINCT FROM s.user_metadata),
 'objs_updated_at_changed', (SELECT count(*) FROM storage.objects o JOIN public.rr_snap_objs s USING (id) WHERE o.updated_at IS DISTINCT FROM s.updated_at),
 'out_of_scope_objs_changed', (SELECT count(*) FROM storage.objects o JOIN public.rr_snap_objs s USING (id) WHERE o.name IN ('syn/not-current.jpg','syn/deleted-app.jpg','syn/insurance.pdf') AND to_jsonb(o) IS DISTINCT FROM to_jsonb(s)),
 'objs_rowcount_delta', (SELECT count(*) FROM storage.objects) - (SELECT count(*) FROM public.rr_snap_objs),
 'bindings_left', (SELECT count(*) FROM private.uploaded_content_sha))
SQL
)
echo "undo comparison: $cmp"
for k in docs_changed_excl_updated_at docs_rowcount_delta objs_changed_excl_updated_at objs_user_metadata_changed out_of_scope_objs_changed objs_rowcount_delta bindings_left; do
  echo "$cmp" | grep -q "\"$k\": 0" || { echo "FAIL $k"; exit 1; }
done
pass "owner undo restores every document and object column exactly (user_metadata, content_sha256, version, metadata), deletes all 20 bindings, leaves out-of-scope rows untouched"
echo "$cmp" | grep -q '"objs_updated_at_changed": 20' && echo "$cmp" | grep -q '"docs_updated_at_changed": 24' || { echo "FAIL updated_at expectation"; exit 1; }
pass "only the trigger-maintained updated_at timestamps differ (20 objects; 24 documents, because the undo's UPDATE also touches the 4 never-hashed rows); no SQL path restores them"

git show "$REF:proposed/rollback/record-uploaded-content-sha.sql" | q -f - >/dev/null
git show "$REF:proposed/m2-hosted-amendments/rollback/01-auth-binding.sql" | q -f - >/dev/null
[ "$(q -c "select to_regclass('private.uploaded_content_sha') is null and to_regprocedure('public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz,uuid)') is null")" = t ] || { echo "FAIL step rollbacks"; exit 1; }
pass "step 2 and step 1 (hosted variant) rollbacks run after a used and undone backfill"
q -c "drop table public.rr_snap_docs, public.rr_snap_objs" >/dev/null
echo "m2-window1-undo-rehearsal: all checks passed"
