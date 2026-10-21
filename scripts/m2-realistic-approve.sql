-- A realistic applicant: status new, license on file, both license photos
-- uploaded, nothing hashed, nothing verified. Approve is refused. Staff
-- document review still leaves the storage hash missing. A dry-run backfill
-- writes nothing. Write-mode backfill plus verify_approval_identity then
-- approves. One transaction, then ROLLBACK. No 64-hex literal.
BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES
 ('21111111-2111-4111-8111-211111111111','realistic-manager@example.test', now()),
 ('22222222-2222-4222-8222-222222222223','realistic-driver@example.test', now());
INSERT INTO auth.sessions (id, user_id, not_after)
VALUES ('23333333-2333-4333-8333-233333333333','21111111-2111-4111-8111-211111111111', now() + interval '1 day');
INSERT INTO public.user_roles (user_id, role)
VALUES ('21111111-2111-4111-8111-211111111111','admin');
INSERT INTO public.applications (
 id, full_name, email, phone, status, user_id, license_number, license_state, license_expiration, dob
) VALUES (
 '24444444-2444-4444-8444-244444444444','Riley Applicant','realistic-driver@example.test','5552223333','new',
 '22222222-2222-4222-8222-222222222223','R4455667','FL','2027-12-31','1992-04-04'
);
INSERT INTO storage.buckets (id, name) VALUES ('driver-docs','driver-docs')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.documents (
 id, driver_id, kind, category, label, storage_bucket, storage_path, visibility,
 file_name, mime_type, size_bytes, is_current, uploaded_by, uploaded_by_role, review_status
) VALUES
 ('25555555-2555-4555-8555-255555555555','24444444-2444-4444-8444-244444444444',
  'license_front','license_front','Driver license front','driver-docs',
  '24444444-2444-4444-8444-244444444444/license_front.jpg',
  ARRAY['driver','admin'],'license-front.jpg','image/jpeg',
  octet_length(convert_to('m2-realistic-front','UTF8')), true,
  '22222222-2222-4222-8222-222222222223','driver','uploaded'),
 ('26666666-2666-4666-8666-266666666666','24444444-2444-4444-8444-244444444444',
  'license_back','license_back','Driver license back','driver-docs',
  '24444444-2444-4444-8444-244444444444/license_back.jpg',
  ARRAY['driver','admin'],'license-back.jpg','image/jpeg',
  octet_length(convert_to('m2-realistic-back','UTF8')), true,
  '22222222-2222-4222-8222-222222222223','driver','uploaded');

INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version)
VALUES
 ('driver-docs','24444444-2444-4444-8444-244444444444/license_front.jpg',
  jsonb_build_object('source','upload'),
  jsonb_build_object('mimetype','image/jpeg','size', octet_length(convert_to('m2-realistic-front','UTF8'))),
  'v1'),
 ('driver-docs','24444444-2444-4444-8444-244444444444/license_back.jpg',
  jsonb_build_object('source','upload'),
  jsonb_build_object('mimetype','image/jpeg','size', octet_length(convert_to('m2-realistic-back','UTF8'))),
  'v1');

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','21111111-2111-4111-8111-211111111111',
 'session_id','23333333-2333-4333-8333-233333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
DECLARE ver bigint;
BEGIN
 SELECT approval_evidence_version INTO ver FROM public.applications
  WHERE id='24444444-2444-4444-8444-244444444444';
 PERFORM public.approve_application_checked(
  '24444444-2444-4444-8444-244444444444', ver,
  '27777777-2777-4777-8777-277777777771','approve_only');
 RAISE EXCEPTION 'approve succeeded before document review';
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%documents_unverified%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT realistic refused documents_unverified';
END $$;

RESET SESSION AUTHORIZATION;
UPDATE public.documents
SET review_status='verified',
    reviewed_by='21111111-2111-4111-8111-211111111111',
    reviewed_at='2026-10-20 12:00:00+00'
WHERE id IN ('25555555-2555-4555-8555-255555555555','26666666-2666-4666-8666-266666666666');

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','21111111-2111-4111-8111-211111111111',
 'session_id','23333333-2333-4333-8333-233333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
DECLARE ver bigint;
BEGIN
 SELECT approval_evidence_version INTO ver FROM public.applications
  WHERE id='24444444-2444-4444-8444-244444444444';
 PERFORM public.approve_application_checked(
  '24444444-2444-4444-8444-244444444444', ver,
  '27777777-2777-4777-8777-277777777772','approve_only');
 RAISE EXCEPTION 'approve succeeded before the content hash';
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%approval_storage_version_unverified%' THEN RAISE; END IF;
 RAISE NOTICE 'RESULT realistic refused approval_storage_version_unverified';
END $$;

RESET SESSION AUTHORIZATION;
\ir ../proposed/backfill-document-content-sha.sql
DO $$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.documents
  WHERE id IN ('25555555-2555-4555-8555-255555555555','26666666-2666-4666-8666-266666666666')
    AND content_sha256 IS NOT NULL;
 IF n <> 0 THEN RAISE EXCEPTION 'dry-run backfill wrote % hashes', n; END IF;
 IF (SELECT mode FROM backfill_report) IS DISTINCT FROM 'dry-run' THEN
  RAISE EXCEPTION 'backfill mode %', (SELECT mode FROM backfill_report);
 END IF;
 RAISE NOTICE 'RESULT realistic backfill dry-run wrote nothing';
END $$;

CREATE TEMP TABLE backfill_object_bytes (bucket_id text, name text, bytes bytea);
INSERT INTO backfill_object_bytes (bucket_id, name, bytes) VALUES
 ('driver-docs','24444444-2444-4444-8444-244444444444/license_front.jpg', convert_to('m2-realistic-front','UTF8')),
 ('driver-docs','24444444-2444-4444-8444-244444444444/license_back.jpg', convert_to('m2-realistic-back','UTF8'));
SELECT set_config('m2.backfill_content_sha','write', true);
SELECT set_config('m2.backfill_local','yes', true);
\ir ../proposed/backfill-document-content-sha.sql
DO $$
DECLARE bad int;
BEGIN
 SELECT count(*) INTO bad
 FROM public.documents d
 JOIN backfill_object_bytes b ON b.bucket_id=d.storage_bucket AND b.name=d.storage_path
 JOIN storage.objects o ON o.bucket_id=d.storage_bucket AND o.name=d.storage_path
 WHERE d.id IN ('25555555-2555-4555-8555-255555555555','26666666-2666-4666-8666-266666666666')
   AND (
     d.content_sha256 IS DISTINCT FROM encode(extensions.digest(b.bytes,'sha256'),'hex')
     OR o.user_metadata->>'sha256' IS DISTINCT FROM d.content_sha256
   );
 IF bad <> 0 THEN RAISE EXCEPTION 'backfill left % documents without a matching hash', bad; END IF;
 IF (SELECT wrote FROM backfill_report) < 2 THEN RAISE EXCEPTION 'backfill wrote %', (SELECT wrote FROM backfill_report); END IF;
 RAISE NOTICE 'RESULT realistic backfill write pass';
END $$;

SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
 'sub','21111111-2111-4111-8111-211111111111',
 'session_id','23333333-2333-4333-8333-233333333333',
 'role','authenticated',
 'exp', extract(epoch FROM clock_timestamp())+3600)::text, true);

DO $$
DECLARE evidence jsonb; rid uuid; ver bigint; approved jsonb;
BEGIN
 evidence := public.preview_approval_identity('24444444-2444-4444-8444-244444444444');
 rid := public.verify_approval_identity(
  '24444444-2444-4444-8444-244444444444', evidence, 'License photos match Riley Applicant');
 SELECT approval_evidence_version INTO ver FROM public.applications
  WHERE id='24444444-2444-4444-8444-244444444444';
 IF (evidence->>'version')::bigint IS DISTINCT FROM ver THEN
  RAISE EXCEPTION 'identity review moved the evidence version from % to %', evidence->>'version', ver;
 END IF;
 approved := public.approve_application_checked(
  '24444444-2444-4444-8444-244444444444', ver,
  '27777777-2777-4777-8777-277777777773','approve_only');
 IF rid IS NULL OR approved->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'approve result %', approved;
 END IF;
 RAISE NOTICE 'RESULT realistic approved';
END $$;

RESET SESSION AUTHORIZATION;
DO $$
DECLARE em text; rl text; st text;
BEGIN
 SELECT status INTO st FROM public.applications WHERE id='24444444-2444-4444-8444-244444444444';
 SELECT actor_email, actor_role INTO em, rl FROM public.audit_log
  WHERE action='application.approved' AND entity_id='24444444-2444-4444-8444-244444444444';
 IF st IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'status %', st; END IF;
 IF em IS DISTINCT FROM 'realistic-manager@example.test' OR rl IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'approval audit actor email=% role=%', em, rl;
 END IF;
 RAISE NOTICE 'RESULT realistic audit pass email=% role=%', em, rl;
END $$;

ROLLBACK;
