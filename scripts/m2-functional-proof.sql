-- Local functional proof. One transaction, then ROLLBACK.
-- License and agreement hashes are extensions.digest of the byte strings below.
-- No sha256 hex literal is written in this file.
-- (a) and (b) insert the confirmDocumentUpload column list with no content_sha256.
-- The sha is applied afterwards the way the flag-on client records it:
-- documents.content_sha256, and storage.objects.user_metadata.sha256.
-- metadata is system data and is left without a sha. Both values are the
-- digest of those bytes.
BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES
 ('11111111-1111-4111-8111-111111111111','manager@example.test', now()),
 ('22222222-2222-4222-8222-222222222222','driver@example.test', now());
INSERT INTO auth.sessions (id, user_id, not_after)
VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111', now() + interval '1 day');
INSERT INTO public.user_roles (user_id, role) VALUES ('11111111-1111-4111-8111-111111111111','admin');

INSERT INTO public.applications (
 id, full_name, email, phone, status, user_id, license_number, license_state, license_expiration, dob
) VALUES (
 '44444444-4444-4444-8444-444444444444','Ada Driver','driver@example.test','5551234567','reviewing',
 '22222222-2222-4222-8222-222222222222','D1234567','FL','2027-12-31','1990-01-15'
);
INSERT INTO public.vehicles (id, year, make, model, vin, weekly_rate, status)
VALUES ('77777777-7777-4777-8777-777777777777',2020,'Honda','Accord','1HGBH41JXMN109186',250,'available');
INSERT INTO storage.buckets (id, name) VALUES ('driver-docs','driver-docs'), ('rental-agreements','rental-agreements')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE upload_bytes (slot text PRIMARY KEY, bytes bytea, doc uuid, path text);
INSERT INTO upload_bytes (slot, bytes, doc, path) VALUES
 ('front', convert_to('m2-license-front-v1','UTF8'), '55555555-5555-4555-8555-555555555555',
  '44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg'),
 ('back', convert_to('m2-license-back-v1','UTF8'), '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444/license_back-66666666-6666-4666-8666-666666666666.jpg'),
 ('agreement', convert_to('m2-signed-agreement-v1','UTF8'), '99999999-9999-4999-8999-999999999999', NULL),
 ('body', convert_to('signed terms','UTF8'), NULL, NULL);

-- (a) confirmDocumentUpload shape. service_role. No content_sha256.
DO $$
DECLARE new_id uuid; ver bigint;
BEGIN
 PERFORM set_config('role','service_role',true);
 INSERT INTO public.documents (
  id, driver_id, kind, category, label, storage_bucket, storage_path, visibility,
  file_name, mime_type, size_bytes, expires_at, is_current, uploaded_by, uploaded_by_role
 ) VALUES (
  '55555555-5555-4555-8555-555555555555',
  '44444444-4444-4444-8444-444444444444',
  'license_front','license_front','Driver''s license (front)','driver-docs',
  '44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg',
  ARRAY['driver','admin'], 'license-front.jpg','image/jpeg', octet_length(convert_to('m2-license-front-v1','UTF8')),
  '2027-12-31', true, '22222222-2222-4222-8222-222222222222','driver'
 ) RETURNING id INTO new_id;
 PERFORM set_config('role','postgres',true);
 SELECT approval_evidence_version INTO ver FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444';
 IF new_id IS NULL OR ver IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'id % version %', new_id, ver; END IF;
 IF (SELECT content_sha256 FROM public.documents WHERE id=new_id) IS NOT NULL THEN RAISE EXCEPTION 'confirm path set a sha before the hash step'; END IF;
 RAISE NOTICE 'RESULT a pass id=% version=%', new_id, ver;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('role','postgres',true);
 RAISE NOTICE 'RESULT a fail %', SQLERRM;
 RAISE;
END $$;

-- (b) same shape for the back.
DO $$
DECLARE new_id uuid; ver bigint;
BEGIN
 PERFORM set_config('role','service_role',true);
 INSERT INTO public.documents (
  id, driver_id, kind, category, label, storage_bucket, storage_path, visibility,
  file_name, mime_type, size_bytes, expires_at, is_current, uploaded_by, uploaded_by_role
 ) VALUES (
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'license_back','license_back','Driver''s license (back)','driver-docs',
  '44444444-4444-4444-8444-444444444444/license_back-66666666-6666-4666-8666-666666666666.jpg',
  ARRAY['driver','admin'], 'license-back.jpg','image/jpeg', octet_length(convert_to('m2-license-back-v1','UTF8')),
  '2027-12-31', true, '22222222-2222-4222-8222-222222222222','driver'
 ) RETURNING id INTO new_id;
 PERFORM set_config('role','postgres',true);
 SELECT approval_evidence_version INTO ver FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444';
 IF new_id IS NULL OR ver IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'id % version %', new_id, ver; END IF;
 RAISE NOTICE 'RESULT b pass id=% version=%', new_id, ver;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('role','postgres',true);
 RAISE NOTICE 'RESULT b fail %', SQLERRM;
 RAISE;
END $$;

DO $$
DECLARE new_id uuid; ver bigint;
BEGIN
 PERFORM set_config('request.jwt.claims', json_build_object(
  'sub','11111111-1111-4111-8111-111111111111',
  'session_id','33333333-3333-4333-8333-333333333333',
  'role','authenticated','exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
 PERFORM set_config('role','authenticated',true);
 INSERT INTO public.documents (
  driver_id, kind, category, storage_bucket, storage_path, visibility, is_current, uploaded_by, uploaded_by_role
 ) VALUES (
  '44444444-4444-4444-8444-444444444444',
  'insurance','insurance','driver-docs',
  '44444444-4444-4444-8444-444444444444/insurance-manager.pdf',
  ARRAY['driver','admin'], true,
  '11111111-1111-4111-8111-111111111111','team'
 ) RETURNING id INTO new_id;
 PERFORM set_config('role','postgres',true);
 SELECT approval_evidence_version INTO ver FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444';
 IF new_id IS NULL OR ver IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'id % version %', new_id, ver; END IF;
 RAISE NOTICE 'RESULT manager pass id=% version=%', new_id, ver;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('role','postgres',true);
 RAISE NOTICE 'RESULT manager fail %', SQLERRM;
 RAISE;
END $$;

-- (c) direct version tamper
DO $$
BEGIN
 UPDATE public.applications SET approval_evidence_version=approval_evidence_version+1
  WHERE id='44444444-4444-4444-8444-444444444444';
 RAISE NOTICE 'RESULT c postgres fail tamper was accepted';
 RAISE EXCEPTION 'tamper accepted';
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%evidence_version_managed%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT c postgres pass %', SQLERRM;
END $$;
DO $$
BEGIN
 PERFORM set_config('role','service_role',true);
 UPDATE public.applications SET approval_evidence_version=approval_evidence_version+5
  WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM set_config('role','postgres',true);
 RAISE EXCEPTION 'tamper accepted';
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('role','postgres',true);
 IF SQLERRM NOT LIKE '%evidence_version_managed%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT c service_role pass %', SQLERRM;
END $$;
DO $$
BEGIN
 PERFORM set_config('request.jwt.claims', json_build_object(
  'sub','11111111-1111-4111-8111-111111111111',
  'role','authenticated','exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
 PERFORM set_config('role','authenticated',true);
 UPDATE public.applications SET approval_evidence_version=0
  WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM set_config('role','postgres',true);
 RAISE EXCEPTION 'tamper accepted';
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('role','postgres',true);
 IF SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT c authenticated pass %', SQLERRM;
END $$;

-- Flag-on upload path: hash the stored bytes and record them the way the
-- client does. No hex literal. metadata stays free of sha256.
UPDATE public.documents d
SET content_sha256 = encode(extensions.digest(b.bytes, 'sha256'), 'hex')
FROM upload_bytes b
WHERE d.id = b.doc AND b.slot IN ('front','back');
INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata)
SELECT 'driver-docs', b.path,
 jsonb_build_object('sha256', encode(extensions.digest(b.bytes, 'sha256'), 'hex')),
 jsonb_build_object('mimetype', 'image/jpeg', 'size', octet_length(b.bytes))
FROM upload_bytes b WHERE b.slot IN ('front','back');
UPDATE public.documents
SET review_status='verified', reviewed_by='11111111-1111-4111-8111-111111111111', reviewed_at='2026-10-20 12:00:00+00'
WHERE id IN ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');

DO $$
DECLARE front text; back text; obj text; sys text;
BEGIN
 SELECT content_sha256 INTO front FROM public.documents WHERE id='55555555-5555-4555-8555-555555555555';
 SELECT content_sha256 INTO back FROM public.documents WHERE id='66666666-6666-4666-8666-666666666666';
 SELECT user_metadata->>'sha256', metadata->>'sha256' INTO obj, sys FROM storage.objects
  WHERE bucket_id='driver-docs' AND name='44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg';
 IF sys IS NOT NULL THEN RAISE EXCEPTION 'sha was seeded into metadata'; END IF;
 IF front !~ '^[0-9a-f]{64}$' OR back !~ '^[0-9a-f]{64}$' OR front = back OR front IS DISTINCT FROM obj THEN
  RAISE EXCEPTION 'sha recording mismatch front % back % object %', front, back, obj;
 END IF;
 IF front IS DISTINCT FROM encode(extensions.digest(convert_to('m2-license-front-v1','UTF8'), 'sha256'), 'hex') THEN
  RAISE EXCEPTION 'front sha is not the digest of the uploaded bytes';
 END IF;
 RAISE NOTICE 'RESULT sha pass front=%', front;
END $$;

-- Live eSign paths do not reach immutable-v1. Step 19 freezes a finalized document.
SAVEPOINT esign_paths;
DO $$
DECLARE sha text; started timestamptz := '2026-10-01 15:00:00+00';
BEGIN
 sha := encode(extensions.digest(convert_to('m2-signed-agreement-v1','UTF8'), 'sha256'), 'hex');
 INSERT INTO public.documents (
  id, driver_id, kind, category, storage_bucket, storage_path, content_sha256, is_current
 ) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '44444444-4444-4444-8444-444444444444',
  'rental_agreement','rental_agreement','rental-agreements',
  'completed-v1/cccccccc-cccc-4ccc-8ccc-cccccccccccc/' || sha || '.pdf',
  sha, true
 );
 INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata) VALUES (
  'rental-agreements',
  'completed-v1/cccccccc-cccc-4ccc-8ccc-cccccccccccc/' || sha || '.pdf',
  jsonb_build_object('sha256', sha),
  jsonb_build_object('mimetype', 'application/pdf')
 );
 INSERT INTO public.agreements (
  id, application_id, vehicle_id, title, body, status, signed_at, document_id, completed_document_id,
  archive_status, sha256, body_sha256, merge_data, company_signer_name
 ) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
  '44444444-4444-4444-8444-444444444444',
  '77777777-7777-4777-8777-777777777777',
  'Vehicle Rental Agreement','signed terms','signed','2026-09-30 15:00:00+00',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'archived', sha, encode(extensions.digest(convert_to('signed terms','UTF8'), 'sha256'), 'hex'),
  jsonb_build_object('record_rental_terms_v1', jsonb_build_object(
   'effectiveAt','2026-10-01T15:00:00+00','weeklyCents',25000,'currency','usd')),
  'REAL RENTALS'
 );
 BEGIN
  PERFORM private.record_agreement_evidence(
   '44444444-4444-4444-8444-444444444444'::uuid,
   '77777777-7777-4777-8777-777777777777'::uuid,
   started, 250);
  RAISE EXCEPTION '19c accepted completed-v1';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%agreement_contract_unverified%' THEN RAISE; END IF;
  RAISE NOTICE 'RESULT esign completed-v1 refused %', SQLERRM;
 END;
 BEGIN
  UPDATE public.documents
  SET storage_path = 'immutable-v1/cccccccc-cccc-4ccc-8ccc-cccccccccccc/' || sha || '.pdf'
  WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  RAISE EXCEPTION 'step 19 allowed the rebind';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%finalized_archive_immutable%' THEN RAISE; END IF;
  RAISE NOTICE 'RESULT esign rebind refused %', SQLERRM;
 END;
END $$;
ROLLBACK TO SAVEPOINT esign_paths;

-- The missing production write: the first insert is already immutable-v1, in
-- rental-agreements, and the object user_metadata sha is the digest of the bytes.
-- Step 9 cannot do this after eSign finalizes the row.
INSERT INTO public.documents (
 id, driver_id, kind, category, storage_bucket, storage_path, content_sha256, is_current
)
SELECT
 '99999999-9999-4999-8999-999999999999',
 '44444444-4444-4444-8444-444444444444',
 'rental_agreement','rental_agreement','rental-agreements',
 'immutable-v1/99999999-9999-4999-8999-999999999999/' || encode(extensions.digest(b.bytes, 'sha256'), 'hex') || '.pdf',
 encode(extensions.digest(b.bytes, 'sha256'), 'hex'),
 true
FROM upload_bytes b WHERE b.slot='agreement';
INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata)
SELECT 'rental-agreements',
 'immutable-v1/99999999-9999-4999-8999-999999999999/' || encode(extensions.digest(b.bytes, 'sha256'), 'hex') || '.pdf',
 jsonb_build_object('sha256', encode(extensions.digest(b.bytes, 'sha256'), 'hex')),
 jsonb_build_object('mimetype', 'application/pdf', 'size', octet_length(b.bytes))
FROM upload_bytes b WHERE b.slot='agreement';
INSERT INTO public.agreements (
 id, application_id, vehicle_id, title, body, status, signed_at, document_id, completed_document_id,
 archive_status, sha256, body_sha256, merge_data, company_signer_name
)
SELECT
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '44444444-4444-4444-8444-444444444444',
 '77777777-7777-4777-8777-777777777777',
 'Vehicle Rental Agreement','signed terms','signed','2026-09-30 15:00:00+00',
 '99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999',
 'archived',
 encode(extensions.digest(a.bytes, 'sha256'), 'hex'),
 encode(extensions.digest(body.bytes, 'sha256'), 'hex'),
 jsonb_build_object('record_rental_terms_v1', jsonb_build_object(
  'effectiveAt','2026-10-01T15:00:00+00','weeklyCents',25000,'currency','usd')),
 'REAL RENTALS'
FROM upload_bytes a, upload_bytes body
WHERE a.slot='agreement' AND body.slot='body';

-- (e) The check that will accept the review is 06b. Step 6 rejects
-- kind approval_identity with resolution verified. Checked before the
-- session switch, because authenticator cannot read pg_constraint.
DO $$
DECLARE def text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname='application_identity_reviews_resolution_check'
    AND conrelid='public.application_identity_reviews'::regclass;
 IF def NOT LIKE '%approval_identity%' OR def NOT LIKE '%positive_license_v1%' THEN
  RAISE EXCEPTION 'installed check is not 06b: %', def;
 END IF;
 IF def LIKE '%kind <> ''approval_identity''%' AND def NOT LIKE '%kind = ''approval_identity''%' THEN
  RAISE EXCEPTION 'installed check is the unmodified step 6 text';
 END IF;
 RAISE NOTICE 'RESULT e check is 06b';
END $$;

-- The provider accepts a PostgREST session: session user authenticator, role
-- authenticated. SET LOCAL is undone when this transaction rolls back.
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
SELECT set_config('record.application_id','44444444-4444-4444-8444-444444444444', true);
SELECT set_config('record.vehicle_id','77777777-7777-4777-8777-777777777777', true);

DO $$
DECLARE snap jsonb; rid uuid; approved jsonb; recorded jsonb; ctx text;
BEGIN
 snap := public.preview_approval_identity('44444444-4444-4444-8444-444444444444');
 rid := public.verify_approval_identity('44444444-4444-4444-8444-444444444444', snap, 'license matches the applicant');
 approved := public.approve_application_checked(
  '44444444-4444-4444-8444-444444444444',
  (SELECT approval_evidence_version FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','approve_only');
 recorded := public.record_existing_rental_tx(
  '88888888-8888-4888-8888-888888888888',
  '44444444-4444-4444-8444-444444444444',
  '77777777-7777-4777-8777-777777777777',
  '2026-10-01 15:00:00+00', 250.00, NULL, NULL, NULL, 'seeded existing rental');
 RAISE NOTICE 'RESULT d pass review=% approved=% recorded=%', rid, approved, recorded;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS ctx = PG_EXCEPTION_CONTEXT;
 RAISE NOTICE 'RESULT d fail %', SQLERRM;
 RAISE NOTICE 'RESULT d context %', ctx;
 RAISE;
END $$;

SELECT r.id AS rental_id, r.status AS rental_status, r.weekly_rate
 FROM public.rentals r WHERE r.application_id='44444444-4444-4444-8444-444444444444';
SELECT id AS agreement_id, rental_id, status, archive_status, storage_path_ok
 FROM (
  SELECT a.id, a.rental_id, a.status, a.archive_status,
   d.storage_bucket = 'rental-agreements'
   AND d.storage_path = 'immutable-v1/' || d.id::text || '/' || a.sha256 || '.pdf' AS storage_path_ok
  FROM public.agreements a
  JOIN public.documents d ON d.id = a.document_id
  WHERE a.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 ) s;
SELECT id AS review_id, kind, status, resolution,
 (approval_evidence IS NOT NULL) AS has_approval_evidence,
 (positive_evidence_v1 IS NULL) AS positive_evidence_null
 FROM public.application_identity_reviews
 WHERE application_id='44444444-4444-4444-8444-444444444444';

DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.application_identity_reviews
  WHERE application_id='44444444-4444-4444-8444-444444444444'
    AND kind='approval_identity' AND status='resolved' AND resolution='verified'
    AND approval_evidence IS NOT NULL AND positive_evidence_v1 IS NULL;
 IF n <> 1 THEN RAISE EXCEPTION 'review shape missing'; END IF;
 RAISE NOTICE 'RESULT e pass review is approval_identity/resolved/verified under the 06b check';
END $$;

ROLLBACK;
