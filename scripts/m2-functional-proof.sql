-- Local functional proof. One transaction, then ROLLBACK.
-- rr_evidence_transport exists only for this file. It is not a packet role.
SELECT 'CREATE ROLE rr_evidence_transport NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rr_evidence_transport')
\gexec
-- Local functional proof. One transaction, then ROLLBACK.
-- License and agreement hashes are extensions.digest of the byte strings below.
-- No sha256 hex literal is written in this file.
-- (a) and (b) insert the confirmDocumentUpload column list with no content_sha256.
-- The objects are inserted without a sha. service_role then calls
-- public.record_uploaded_content_sha, which sets documents.content_sha256
-- and merges storage.objects.user_metadata.sha256. metadata stays system data.
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

-- Flag-on upload path. The object exists before the hash. user_metadata has
-- no sha256. service_role calls public.record_uploaded_content_sha, which
-- merges the digest and sets documents.content_sha256. This does not re-upload.
INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version)
SELECT 'driver-docs', b.path,
 jsonb_build_object('source', 'upload'),
 jsonb_build_object('mimetype', 'image/jpeg', 'size', octet_length(b.bytes)),
 'v1'
FROM upload_bytes b WHERE b.slot IN ('front','back');
DO $$
DECLARE
  r record;
  got text;
BEGIN
  FOR r IN
    SELECT o.id, b.path, encode(extensions.digest(b.bytes, 'sha256'), 'hex') AS sha
    FROM upload_bytes b
    JOIN storage.objects o ON o.bucket_id = 'driver-docs' AND o.name = b.path
    WHERE b.slot IN ('front','back')
  LOOP
    PERFORM set_config('role','service_role', true);
    got := public.record_uploaded_content_sha('driver-docs', r.path, r.sha, r.id, 'v1', NULL);
    PERFORM set_config('role','postgres', true);
    IF got IS DISTINCT FROM r.sha THEN RAISE EXCEPTION 'sha function returned %', got; END IF;
  END LOOP;
  RAISE NOTICE 'RESULT sha function pass';
END $$;
UPDATE public.documents
SET review_status='verified', reviewed_by='11111111-1111-4111-8111-111111111111', reviewed_at='2026-10-20 12:00:00+00'
WHERE id IN ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666');

DO $$
DECLARE
  front_id uuid := '55555555-5555-4555-8555-555555555555';
  front_path text := '44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg';
  object_id uuid;
  front_sha text;
  other_sha text;
BEGIN
  SELECT id INTO object_id FROM storage.objects WHERE bucket_id='driver-docs' AND name=front_path;
  front_sha := encode(extensions.digest(convert_to('m2-license-front-v1','UTF8'), 'sha256'), 'hex');
  other_sha := encode(extensions.digest(convert_to('m2-license-other-v1','UTF8'), 'sha256'), 'hex');
  BEGIN
    PERFORM set_config('role','anon', true);
    PERFORM public.record_uploaded_content_sha('driver-docs', front_path, front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'anon was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha anon pass %', SQLERRM;
  END;
  BEGIN
    PERFORM set_config('role','authenticated', true);
    PERFORM public.record_uploaded_content_sha('driver-docs', front_path, front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'authenticated was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha authenticated pass %', SQLERRM;
  END;
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha('driver-docs', front_path, front_sha, object_id, 'stale', NULL);
    RAISE EXCEPTION 'stale version accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_object_changed%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha stale pass %', SQLERRM;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id=object_id) IS DISTINCT FROM front_sha
     OR (SELECT user_metadata->>'source' FROM storage.objects WHERE id=object_id) IS DISTINCT FROM 'upload' THEN
    RAISE EXCEPTION 'stale version changed user_metadata';
  END IF;
  BEGIN
    UPDATE public.documents SET content_sha256 = other_sha WHERE id = front_id;
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha('driver-docs', front_path, front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'mismatch accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_mismatch%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha mismatch pass %', SQLERRM;
  END;
  IF (SELECT content_sha256 FROM public.documents WHERE id=front_id) IS DISTINCT FROM front_sha THEN
    RAISE EXCEPTION 'mismatch changed the stored hash';
  END IF;
  INSERT INTO storage.buckets (id, name) VALUES ('rental-agreements','rental-agreements') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.documents (id, kind, category, storage_bucket, storage_path, is_current)
  VALUES (
    'abababab-abab-4aba-8aba-abababababab',
    'rental_agreement','agreement','rental-agreements',
    'immutable-v1/abababab-abab-4aba-8aba-abababababab/file.pdf',
    true
  );
  INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version)
  VALUES (
    'acacacac-acac-4aca-8aca-acacacacacac',
    'rental-agreements',
    'immutable-v1/abababab-abab-4aba-8aba-abababababab/file.pdf',
    jsonb_build_object('source','archive'),
    'v1'
  );
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha(
      'rental-agreements',
      'immutable-v1/abababab-abab-4aba-8aba-abababababab/file.pdf',
      front_sha,
      'acacacac-acac-4aca-8aca-acacacacacac',
      'v1',
      NULL);
    RAISE EXCEPTION 'immutable-v1 accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_immutable%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha immutable pass %', SQLERRM;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id='acacacac-acac-4aca-8aca-acacacacacac') IS NOT NULL THEN
    RAISE EXCEPTION 'immutable-v1 wrote a hash';
  END IF;
  INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version)
  VALUES (
    'adadadad-adad-4ada-8ada-adadadadadad',
    'driver-docs',
    'unclaimed/not-a-document.jpg',
    jsonb_build_object('source','upload'),
    'v1'
  );
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha(
      'driver-docs',
      'unclaimed/not-a-document.jpg',
      front_sha,
      'adadadad-adad-4ada-8ada-adadadadadad',
      'v1',
      NULL);
    RAISE EXCEPTION 'unclaimed path accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_unclaimed%' THEN RAISE; END IF;
    RAISE NOTICE 'RESULT sha unclaimed pass %', SQLERRM;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id='adadadad-adad-4ada-8ada-adadadadadad') IS NOT NULL THEN
    RAISE EXCEPTION 'unclaimed path wrote a hash';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE storage_bucket='driver-docs' AND storage_path='unclaimed/not-a-document.jpg'
  ) THEN
    RAISE EXCEPTION 'unclaimed path invented a documents row';
  END IF;
END $$;

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
 INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version) VALUES (
  'rental-agreements',
  'completed-v1/cccccccc-cccc-4ccc-8ccc-cccccccccccc/' || sha || '.pdf',
  jsonb_build_object('sha256', sha),
  jsonb_build_object('mimetype', 'application/pdf'),
  'v1'
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
INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version)
SELECT 'rental-agreements',
 'immutable-v1/99999999-9999-4999-8999-999999999999/' || encode(extensions.digest(b.bytes, 'sha256'), 'hex') || '.pdf',
 jsonb_build_object('sha256', encode(extensions.digest(b.bytes, 'sha256'), 'hex')),
 jsonb_build_object('mimetype', 'application/pdf', 'size', octet_length(b.bytes)),
 'v1'
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
DECLARE snap jsonb; rid uuid;
BEGIN
 snap := public.preview_approval_identity('44444444-4444-4444-8444-444444444444');
 rid := public.verify_approval_identity('44444444-4444-4444-8444-444444444444', snap, 'license matches the applicant');
 IF rid IS NULL THEN RAISE EXCEPTION 'verify returned null'; END IF;
 RAISE NOTICE 'RESULT d verified %', rid;
END $$;

-- A hosted upsert replaces the object and advances storage.objects.version.
-- This UPDATE is that version change. The stored review still says v1.
RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET version = 'v2'
 WHERE bucket_id = 'driver-docs'
   AND name = '44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg';

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);
SELECT set_config('record.application_id','44444444-4444-4444-8444-444444444444', true);

DO $$
DECLARE ctx text; ver bigint;
BEGIN
 SELECT approval_evidence_version INTO ver FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444';
 PERFORM public.approve_application_checked(
  '44444444-4444-4444-8444-444444444444', ver,
  'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc', 'approve_only');
 RAISE EXCEPTION 'version change was accepted';
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%positive_identity_required%' THEN
  GET STACKED DIAGNOSTICS ctx = PG_EXCEPTION_CONTEXT;
  RAISE NOTICE 'RESULT version context %', ctx;
  RAISE;
 END IF;
 RAISE NOTICE 'RESULT version upsert refused %', SQLERRM;
END $$;

RESET SESSION AUTHORIZATION;
UPDATE storage.objects SET version = 'v1'
 WHERE bucket_id = 'driver-docs'
   AND name = '44444444-4444-4444-8444-444444444444/license_front-55555555-5555-4555-8555-555555555555.jpg';

-- record_existing_rental_tx is executor-only. An authenticated manager must
-- record through record_existing_rental_evidence_v1. link_replacement_agreement_v1
-- is executor-only too, so both calls are denied before any write.
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
BEGIN
 PERFORM public.link_replacement_agreement_v1(
  '44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 RAISE EXCEPTION 'authenticated was allowed to link a replacement agreement';
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM NOT LIKE '%link_replacement_agreement_v1%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT link replacement permission denied for authenticated';
END $$;

DO $$
BEGIN
 PERFORM public.record_existing_rental_tx(
  '88888888-8888-4888-8888-888888888888',
  '44444444-4444-4444-8444-444444444444',
  '77777777-7777-4777-8777-777777777777',
  '2026-10-01 15:00:00+00', 250.00, NULL, NULL, NULL, 'seeded existing rental');
 RAISE EXCEPTION 'authenticated recorded without evidence';
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM NOT LIKE '%record_existing_rental_tx%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT record tx permission denied for authenticated';
END $$;

-- The live Approve write, as authenticator to service_role, is the path the
-- application used before the packet. The triggers refuse it. The manager
-- RPC below is the path that still works.
RESET SESSION AUTHORIZATION;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
DO $$
BEGIN
 UPDATE public.applications SET status = 'approved'
  WHERE id = '44444444-4444-4444-8444-444444444444';
 RAISE EXCEPTION 'direct approve accepted';
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM NOT LIKE '%approval_rpc_required%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT direct approve refused %', SQLERRM;
END $$;
DO $$
BEGIN
 INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary)
 VALUES (
  '11111111-1111-4111-8111-111111111111',
  'application.approved', 'application',
  '44444444-4444-4444-8444-444444444444',
  'Direct approval audit');
 RAISE EXCEPTION 'direct approval audit accepted';
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM NOT LIKE '%approval_audit_rpc_required%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT direct approval audit refused %', SQLERRM;
END $$;

RESET SESSION AUTHORIZATION;
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
DECLARE approved jsonb; recorded jsonb; ctx text; ver bigint;
BEGIN
 SELECT approval_evidence_version INTO ver FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444';
 approved := public.approve_application_checked(
  '44444444-4444-4444-8444-444444444444',
  ver,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','approve_only');
 RAISE NOTICE 'RESULT d pass approved=%', approved;
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

-- Evidence path. The issuer binds the documents and issues the token.
-- The authenticated manager consumes it. That is the only record call.
RESET SESSION AUTHORIZATION;
GRANT rr_evidence_issuer TO rr_evidence_transport;
GRANT rr_approval_executor TO rr_evidence_transport;
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
DECLARE
 app uuid := '44444444-4444-4444-8444-444444444444';
 veh uuid := '77777777-7777-4777-8777-777777777777';
 agr uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 doc_id uuid := '99999999-9999-4999-8999-999999999999';
 op uuid := '88888888-8888-4888-8888-888888888888';
 driver uuid := '22222222-2222-4222-8222-222222222222';
 actor uuid := '11111111-1111-4111-8111-111111111111';
 started timestamptz := '2026-10-01 15:00:00+00';
 sha text; path text; expected jsonb; lic jsonb; snap jsonb; req jsonb; verified jsonb; token uuid; g jsonb;
 doc uuid;
BEGIN
 FOREACH doc IN ARRAY ARRAY[
  '55555555-5555-4555-8555-555555555555'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  doc_id
 ] LOOP
  SELECT content_sha256 INTO sha FROM public.documents WHERE id = doc;
  path := 'immutable-v1/' || doc::text || '/' || sha || '.pdf';
  SELECT pg_catalog.to_jsonb(d) INTO expected FROM (
   SELECT id, driver_id, storage_bucket, storage_path, content_sha256, integrity_v1,
    category, is_current, superseded_by, review_status, reviewed_by, reviewed_at
   FROM public.documents WHERE id = doc
  ) d;
  PERFORM private.bind_document_integrity_v1(doc, expected, sha, path, CASE WHEN doc = doc_id THEN agr ELSE NULL END);
 END LOOP;
 PERFORM set_config('role', 'rr_approval_executor', true);
 lic := private.license_snapshot_v1(app);
 PERFORM private.verify_license_v1(app, lic);
 PERFORM set_config('role', 'rr_evidence_issuer', true);
 snap := private.record_snapshot_v1(app, veh, agr, doc_id);
 g := snap->'document';
 req := pg_catalog.jsonb_build_object(
  'operationId', op, 'applicationId', app, 'vehicleId', veh, 'startedAt', started,
  'weeklyRate', 250, 'reason', 'seeded existing rental', 'currency', 'usd');
 verified := pg_catalog.jsonb_build_object(
  'request', pg_catalog.jsonb_build_object(
   'actorId', actor, 'operationId', op, 'applicationId', app, 'vehicleId', veh,
   'startedAt', started, 'weeklyCents', 25000, 'driverId', driver, 'currency', 'usd'),
  'agreement', pg_catalog.jsonb_build_object(
   'id', agr, 'documentId', doc_id, 'provenanceId', agr,
   'signedVersion', g->>'version', 'currentVersion', g->>'version',
   'signedHash', g->>'sha256', 'currentHash', g->>'sha256',
   'status', 'signed', 'kind', 'esign', 'verification', 'esign-verified',
   'applicationId', app, 'driverId', driver, 'vehicleId', veh,
   'weeklyCents', 25000, 'currency', 'usd', 'effectiveAt', started,
   'signedAt', '2026-09-30 15:00:00+00'),
  'subscription', 'null'::jsonb);
 token := private.issue_record_evidence_v1(req, verified, snap);
 PERFORM set_config('m2.evidence_token', token::text, true);
 PERFORM set_config('m2.evidence_req', req::text, true);
 RAISE NOTICE 'RESULT evidence issued %', token;
END $$;

RESET SESSION AUTHORIZATION;
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
DECLARE recorded jsonb; ctx text;
BEGIN
 recorded := public.record_existing_rental_evidence_v1(
  current_setting('m2.evidence_token')::uuid,
  current_setting('m2.evidence_req')::jsonb);
 IF recorded->>'status' IS DISTINCT FROM 'recorded' OR recorded->>'recovered' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'evidence record result %', recorded;
 END IF;
 RAISE NOTICE 'RESULT evidence record pass %', recorded;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS ctx = PG_EXCEPTION_CONTEXT;
 RAISE NOTICE 'RESULT evidence record fail %', SQLERRM;
 RAISE NOTICE 'RESULT evidence record context %', ctx;
 RAISE;
END $$;

-- Replacement car, signed archive, and agreement evidence. Seeded as the
-- table owner. The authenticated swap call does not write these rows.
-- Mileage stays null, so the swap writes no odometer reading.
RESET SESSION AUTHORIZATION;
DO $$
DECLARE
 app uuid := '44444444-4444-4444-8444-444444444444';
 rep uuid := 'abababab-abab-4aba-8aba-abababababab';
 doc uuid := 'edededed-eded-4ede-8ede-edededededed';
 agr uuid := 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc';
 rid uuid; assign uuid; sha text; rate numeric; sub text; autopay boolean;
 bytes bytea := convert_to('m2-swap-agreement-v1','UTF8');
BEGIN
 SELECT id, weekly_rate, stripe_subscription_id, autopay_active
  INTO rid, rate, sub, autopay
  FROM public.rentals WHERE application_id=app AND status='active';
 IF rid IS NULL THEN RAISE EXCEPTION 'swap fixture rental missing'; END IF;
 SELECT a.id INTO assign
  FROM public.booking_vehicle_assignments a
  LEFT JOIN private.assignment_closures c ON c.assignment_id=a.id
  WHERE a.rental_id=rid AND c.assignment_id IS NULL;
 IF assign IS NULL THEN RAISE EXCEPTION 'swap fixture assignment missing'; END IF;
 sha := encode(extensions.digest(bytes, 'sha256'), 'hex');
 INSERT INTO public.vehicles (id, year, make, model, vin, weekly_rate, status)
 VALUES (rep, 2021, 'Toyota', 'Camry', '2HGBH41JXMN109186', 275, 'available');
 INSERT INTO public.documents (
  id, driver_id, kind, category, storage_bucket, storage_path, content_sha256, is_current
 ) VALUES (
  doc, app, 'rental_agreement', 'rental_agreement', 'rental-agreements',
  'immutable-v1/' || doc::text || '/' || sha || '.pdf', sha, false
 );
 INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version) VALUES (
  'rental-agreements',
  'immutable-v1/' || doc::text || '/' || sha || '.pdf',
  jsonb_build_object('sha256', sha),
  jsonb_build_object('mimetype', 'application/pdf', 'size', octet_length(bytes)),
  'v1'
 );
 INSERT INTO public.agreements (
  id, application_id, vehicle_id, title, body, status, signed_at, document_id, completed_document_id,
  archive_status, sha256, body_sha256, merge_data, company_signer_name
 ) VALUES (
  agr, app, rep, 'Replacement Vehicle Agreement', 'swap terms', 'signed',
  '2026-10-14 15:00:00+00', doc, doc, 'archived', sha,
  encode(extensions.digest(convert_to('swap terms','UTF8'), 'sha256'), 'hex'),
  jsonb_build_object('record_rental_terms_v1', jsonb_build_object(
   'effectiveAt','2026-10-15T16:00:00+00','weeklyCents',27500,'currency','usd')),
  'REAL RENTALS'
 );
 INSERT INTO private.agreement_evidence (
  agreement_id, rental_id, application_id, vehicle_id, document_id, sha256,
  signed_at, signer_user_id, actor_id
 ) VALUES (
  agr, rid, app, rep, doc, sha, '2026-10-14 15:00:00+00',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111'
 );
 PERFORM set_config('m2.swap_rental', rid::text, true);
 PERFORM set_config('m2.swap_assignment', assign::text, true);
 PERFORM set_config('m2.swap_agreement', agr::text, true);
 PERFORM set_config('m2.swap_vehicle', rep::text, true);
 PERFORM set_config('m2.swap_rate', rate::text, true);
 PERFORM set_config('m2.swap_sub', coalesce(sub, ''), true);
 PERFORM set_config('m2.swap_autopay', coalesce(autopay::text, ''), true);
END $$;

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
DECLARE result jsonb;
BEGIN
 result := public.swap_rental_vehicle_tx(
  'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
  current_setting('m2.swap_rental')::uuid,
  current_setting('m2.swap_assignment')::uuid,
  current_setting('m2.swap_vehicle')::uuid,
  '2026-10-15 16:00:00+00',
  NULL, NULL,
  'ready replacement car',
  current_setting('m2.swap_agreement')::uuid);
 IF result->>'contract' IS DISTINCT FROM 'vehicle-swap-v1'
  OR result->>'recovered' IS DISTINCT FROM 'false'
  OR result->>'outgoingStatus' IS DISTINCT FROM 'maintenance'
  OR result->>'billing' IS DISTINCT FROM 'unchanged'
  OR result->>'rentalId' IS DISTINCT FROM current_setting('m2.swap_rental')
 THEN RAISE EXCEPTION 'swap result %', result; END IF;
 PERFORM set_config('m2.swap_result', result::text, true);
 RAISE NOTICE 'RESULT swap pass %', result->>'replacementAssignmentId';
END $$;

RESET SESSION AUTHORIZATION;
DO $$
DECLARE result jsonb := current_setting('m2.swap_result')::jsonb;
 rid uuid := current_setting('m2.swap_rental')::uuid;
 rep uuid := current_setting('m2.swap_vehicle')::uuid;
 oldv uuid := '77777777-7777-4777-8777-777777777777';
 rate numeric; sub text; autopay text; closures int; replacements int; audits int;
BEGIN
 SELECT weekly_rate, stripe_subscription_id, coalesce(autopay_active::text, '')
  INTO rate, sub, autopay
  FROM public.rentals WHERE id=rid;
 IF (SELECT vehicle_id FROM public.rentals WHERE id=rid) IS DISTINCT FROM rep THEN
  RAISE EXCEPTION 'rental pointer did not move'; END IF;
 IF (SELECT status FROM public.rentals WHERE id=rid) IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'swap closed the rental'; END IF;
 IF rate IS DISTINCT FROM current_setting('m2.swap_rate')::numeric
  OR coalesce(sub, '') IS DISTINCT FROM current_setting('m2.swap_sub')
  OR autopay IS DISTINCT FROM current_setting('m2.swap_autopay') THEN
  RAISE EXCEPTION 'billing changed rate % sub % autopay %', rate, sub, autopay; END IF;
 IF (SELECT status FROM public.vehicles WHERE id=oldv) IS DISTINCT FROM 'maintenance' THEN
  RAISE EXCEPTION 'outgoing car was not held'; END IF;
 IF (SELECT status FROM public.vehicles WHERE id=rep) IS DISTINCT FROM 'rented' THEN
  RAISE EXCEPTION 'replacement was not marked rented'; END IF;
 SELECT count(*) INTO closures FROM private.assignment_closures c
  JOIN public.booking_vehicle_assignments a ON a.id=c.assignment_id
  WHERE a.rental_id=rid;
 SELECT count(*) INTO replacements FROM public.booking_vehicle_assignments
  WHERE rental_id=rid AND assignment_kind='replacement';
 SELECT count(*) INTO audits FROM public.audit_log
  WHERE action='rental.vehicle_swapped' AND entity_id=rid::text;
 IF closures<>1 OR replacements<>1 OR audits<>1 THEN
  RAISE EXCEPTION 'swap history closures % replacements % audits %', closures, replacements, audits; END IF;
 IF (SELECT id FROM public.booking_vehicle_assignments
     WHERE rental_id=rid AND assignment_kind='replacement')::text
    IS DISTINCT FROM result->>'replacementAssignmentId' THEN
  RAISE EXCEPTION 'replacement assignment id mismatch'; END IF;
END $$;

-- Same operation id and the same arguments. Recovery returns before another write.
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','11111111-1111-4111-8111-111111111111',
 'session_id','33333333-3333-4333-8333-333333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
DECLARE result jsonb; first jsonb := current_setting('m2.swap_result')::jsonb;
BEGIN
 result := public.swap_rental_vehicle_tx(
  'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
  current_setting('m2.swap_rental')::uuid,
  current_setting('m2.swap_assignment')::uuid,
  current_setting('m2.swap_vehicle')::uuid,
  '2026-10-15 16:00:00+00',
  NULL, NULL,
  'ready replacement car',
  current_setting('m2.swap_agreement')::uuid);
 IF result->>'recovered' IS DISTINCT FROM 'true'
  OR result->>'contract' IS DISTINCT FROM 'vehicle-swap-v1'
  OR result->>'swapNumber' IS DISTINCT FROM first->>'swapNumber'
  OR result->>'replacementAssignmentId' IS DISTINCT FROM first->>'replacementAssignmentId'
  OR result->>'closedAssignmentId' IS DISTINCT FROM first->>'closedAssignmentId'
 THEN RAISE EXCEPTION 'swap replay %', result; END IF;
 RAISE NOTICE 'RESULT swap replay recovered %', result->>'recovered';
END $$;

RESET SESSION AUTHORIZATION;
DO $$
DECLARE rid uuid := current_setting('m2.swap_rental')::uuid; closures int; replacements int; audits int;
BEGIN
 SELECT count(*) INTO closures FROM private.assignment_closures c
  JOIN public.booking_vehicle_assignments a ON a.id=c.assignment_id WHERE a.rental_id=rid;
 SELECT count(*) INTO replacements FROM public.booking_vehicle_assignments
  WHERE rental_id=rid AND assignment_kind='replacement';
 SELECT count(*) INTO audits FROM public.audit_log
  WHERE action='rental.vehicle_swapped' AND entity_id=rid::text;
 IF closures<>1 OR replacements<>1 OR audits<>1 THEN
  RAISE EXCEPTION 'swap replay wrote again closures % replacements % audits %', closures, replacements, audits;
 END IF;
END $$;

-- Real service_role call, the PostgREST shape: session_user authenticator,
-- role service_role. No stub of approval_actor. extend_rental_tx must accept
-- a manager id and reject a non-manager before taking the approval lock.
RESET SESSION AUTHORIZATION;
UPDATE public.rentals SET end_date = DATE '2026-11-01'
 WHERE application_id = '44444444-4444-4444-8444-444444444444' AND status = 'active';

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb; started timestamptz; ms numeric; msg text; rid uuid;
BEGIN
 IF session_user IS DISTINCT FROM 'authenticator' OR current_user IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'service_role gateway missing session=% current=%', session_user, current_user;
 END IF;
 IF position('approval_actor' in pg_get_functiondef('public.extend_rental_tx(uuid,uuid,date,date,text,uuid)'::regprocedure)) > 0 THEN
  RAISE EXCEPTION 'extend still calls approval_actor';
 END IF;
 SELECT id INTO rid FROM public.rentals WHERE application_id='44444444-4444-4444-8444-444444444444' AND status='active';
 IF rid IS NULL THEN RAISE EXCEPTION 'recorded rental missing'; END IF;
 started := clock_timestamp();
 BEGIN
  PERFORM public.extend_rental_tx(rid, rid, DATE '2026-11-01', DATE '2026-12-01', 'keep the car',
   '22222222-2222-4222-8222-222222222222');
  RAISE EXCEPTION 'non-manager extend succeeded';
 EXCEPTION WHEN insufficient_privilege THEN msg := SQLERRM;
 END;
 ms := extract(epoch FROM clock_timestamp()-started)*1000;
 IF msg IS DISTINCT FROM 'manager_required' THEN RAISE EXCEPTION 'non-manager extend %', msg; END IF;
 IF ms > 200 THEN RAISE EXCEPTION 'non-manager extend waited % ms', ms; END IF;
 result := public.extend_rental_tx(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rid, DATE '2026-11-01', DATE '2026-12-01', 'keep the car',
  '11111111-1111-4111-8111-111111111111');
 IF result->>'newEnd' IS DISTINCT FROM '2026-12-01' OR result->>'recovered' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'extend result %', result;
 END IF;
 IF (SELECT end_date FROM public.rentals WHERE id=rid) IS DISTINCT FROM DATE '2026-12-01' THEN
  RAISE EXCEPTION 'end date was not written';
 END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE action='rental.extended' AND entity_id=rid::text
     AND actor_user_id='11111111-1111-4111-8111-111111111111') <> 1 THEN
  RAISE EXCEPTION 'extend audit missing';
 END IF;
 RAISE NOTICE 'RESULT extend service_role pass %', result->>'newEnd';
END $$;

ROLLBACK;
DROP ROLE IF EXISTS rr_evidence_transport;
