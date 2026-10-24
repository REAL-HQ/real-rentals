-- One more approved synthetic driver for the acceptance test, through the same steps
-- the M2 functional proof uses: licence images uploaded (service_role shape), hashed by
-- record_uploaded_content_sha, reviewed, the approval identity verified and the driver
-- approved through the PostgREST RPCs. The licence images are NOT bound and no positive
-- licence review exists: the acceptance test does those through the app's flow.
-- psql -v app= drv= front= back= veh= vin= name= email= license= approve_op= ; local harness only.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (:'drv', :'email', now());
INSERT INTO public.applications (id, full_name, email, phone, status, user_id, license_number, license_state, license_expiration, dob)
VALUES (:'app', :'name', :'email', '5550001111', 'reviewing', :'drv', :'license', 'FL', '2028-06-30', '1988-04-02');
INSERT INTO public.vehicles (id, year, make, model, vin, weekly_rate, status)
VALUES (:'veh', 2022, 'Toyota', 'Corolla', :'vin', 275, 'available');
-- JPEG magic bytes, so the archive keeps the real content type.
CREATE TEMP TABLE drv_bytes AS
SELECT 'front' slot, :'front'::uuid doc, decode('ffd8ffe0', 'hex') || convert_to('synthetic-license-front-' || :'app', 'UTF8') bytes,
       :'app' || '/license_front-' || :'front' || '.jpg' path
UNION ALL
SELECT 'back', :'back'::uuid, decode('ffd8ffe0', 'hex') || convert_to('synthetic-license-back-' || :'app', 'UTF8'),
       :'app' || '/license_back-' || :'back' || '.jpg';
GRANT SELECT ON drv_bytes TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO public.documents (id, driver_id, kind, category, label, storage_bucket, storage_path, visibility,
  file_name, mime_type, size_bytes, expires_at, is_current, uploaded_by, uploaded_by_role)
SELECT b.doc, :'app', 'license_' || b.slot, 'license_' || b.slot, 'Driver''s license (' || b.slot || ')', 'driver-docs', b.path,
  ARRAY['driver','admin'], 'license-' || b.slot || '.jpg', 'image/jpeg', octet_length(b.bytes), '2028-06-30', true, :'drv', 'driver'
FROM drv_bytes b ORDER BY b.slot DESC;
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version)
SELECT 'driver-docs', b.path, jsonb_build_object('source', 'upload'), jsonb_build_object('mimetype', 'image/jpeg', 'size', octet_length(b.bytes)), 'v1'
FROM drv_bytes b;
SET LOCAL ROLE service_role;
SELECT public.record_uploaded_content_sha('driver-docs', b.path, encode(extensions.digest(b.bytes, 'sha256'), 'hex'), o.id, 'v1', NULL, b.doc)
FROM drv_bytes b JOIN storage.objects o ON o.bucket_id = 'driver-docs' AND o.name = b.path;
RESET ROLE;
UPDATE public.documents SET review_status = 'verified', reviewed_by = '11111111-1111-4111-8111-111111111111', reviewed_at = now() - interval '1 hour'
WHERE id IN (:'front', :'back');
INSERT INTO public.rr_harness_objects (bucket, path, bytes) SELECT 'driver-docs', b.path, b.bytes FROM drv_bytes b;

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111',
  'session_id','33333333-3333-4333-8333-333333333333','role','authenticated',
  'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
SELECT set_config('record.application_id', :'app', true);
SELECT public.verify_approval_identity(:'app', public.preview_approval_identity(:'app'), 'license matches the applicant');
SELECT public.approve_application_checked(:'app', (SELECT approval_evidence_version FROM public.applications WHERE id = :'app'), :'approve_op', 'approve_only');
RESET SESSION AUTHORIZATION;
COMMIT;
SELECT 'driver ' || full_name || ' ' || status FROM public.applications WHERE id = :'app';
