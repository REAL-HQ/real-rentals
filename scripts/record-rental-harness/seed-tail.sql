-- Appended to the SQL proof's committed prefix (approval of the synthetic driver).
-- Keeps the agreement bytes for the harness download reader, then does, as the
-- transport, the license binding and positive-license review for this first driver
-- directly in SQL. The acceptance test (record-rental-acceptance) drives the same
-- two steps through the app's flow for its own synthetic drivers.
-- The agreement is NOT bound here: the test binds it through finalizeRecordArchiveV2.
RESET SESSION AUTHORIZATION;
CREATE TABLE public.rr_harness_bytes AS SELECT slot, bytes, doc FROM upload_bytes;
REVOKE ALL ON public.rr_harness_bytes FROM PUBLIC, anon, authenticated, service_role;
-- Harness object store for the acceptance test's storage gateway (bucket, path) -> bytes.
CREATE TABLE public.rr_harness_objects (bucket text, path text, bytes bytea NOT NULL, PRIMARY KEY (bucket, path));
REVOKE ALL ON public.rr_harness_objects FROM PUBLIC, anon, authenticated, service_role;
SET LOCAL SESSION AUTHORIZATION rr_evidence_transport;
SET LOCAL ROLE rr_evidence_issuer;
SET LOCAL TIME ZONE 'UTC';
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
SELECT set_config('record.application_id','44444444-4444-4444-8444-444444444444', true);
SELECT set_config('record.vehicle_id','77777777-7777-4777-8777-777777777777', true);
DO $$
DECLARE doc uuid; sha text; expected jsonb; lic jsonb;
BEGIN
 FOREACH doc IN ARRAY ARRAY['55555555-5555-4555-8555-555555555555'::uuid,'66666666-6666-4666-8666-666666666666'::uuid] LOOP
  SELECT content_sha256 INTO sha FROM public.documents WHERE id = doc;
  SELECT pg_catalog.to_jsonb(d) INTO expected FROM (
   SELECT id, driver_id, storage_bucket, storage_path, content_sha256, integrity_v1,
    category, is_current, superseded_by, review_status, reviewed_by, reviewed_at
   FROM public.documents WHERE id = doc) d;
  PERFORM private.bind_document_integrity_v1(doc, expected, sha, 'immutable-v1/' || doc::text || '/' || sha || '.pdf', NULL);
 END LOOP;
 PERFORM set_config('role', 'rr_approval_executor', true);
 lic := private.license_snapshot_v1('44444444-4444-4444-8444-444444444444');
 PERFORM private.verify_license_v1('44444444-4444-4444-8444-444444444444', lic);
END $$;
RESET SESSION AUTHORIZATION;
-- A second, unrelated approved driver with no signed agreement, for refusal tests.
INSERT INTO public.vehicles (id, year, make, model, vin, weekly_rate, status)
VALUES ('78888888-7777-4777-8777-777777777777',2021,'Toyota','Camry','4T1BF1FK5CU123456',275,'available');
COMMIT;
