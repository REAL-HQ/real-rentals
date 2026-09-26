-- Screening pipeline gate — fixture tests.
--
--   Run inside a transaction and ROLLBACK. Leaves no residue.
--
-- The gate lives in the database (enforce_screening_pipeline) so it holds
-- whatever the UI believes. These fixtures prove it counts the document vault
-- the same way the screen does: current, not rejected, right category.
--
-- Expected results:
--   1 0/4 docs                                  BLOCKED (have 0)
--   2 1/4 docs                                  BLOCKED (have 1)
--   3 3/4 docs                                  BLOCKED (have 3)
--   4 4/4 docs, no recording                    BLOCKED (recording required)
--   5 4/4 docs + recording                      ALLOWED
--   6 4 rows, insurance REJECTED                BLOCKED (have 3)
--   7 4 rows, insurance SUPERSEDED              BLOCKED (have 3)
--   8 replacement current + previous superseded ALLOWED
--   9 recording superseded, no replacement      BLOCKED (recording required)

BEGIN;

INSERT INTO public.applications (id, full_name, email, phone, status, sms_consent)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Gate Fixture','gate@example.test','5550000001','partial', true);
INSERT INTO public.driver_screenings (lead_id, status, interview_completed_at, disqualified, insurance_verified)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001','docs_pending', now(), false, true);

CREATE TEMP TABLE gate_results(step int, scenario text, outcome text);

CREATE FUNCTION pg_temp.check(n int, label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    UPDATE public.driver_screenings SET status='insurance_verified'
     WHERE lead_id='aaaaaaaa-0000-4000-8000-000000000001';
    UPDATE public.driver_screenings SET status='docs_pending'
     WHERE lead_id='aaaaaaaa-0000-4000-8000-000000000001';
    INSERT INTO gate_results VALUES (n, label, 'ALLOWED');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_results VALUES (n, label, 'BLOCKED: '||SQLERRM);
  END;
END $fn$;

CREATE FUNCTION pg_temp.add(cat text, cur bool DEFAULT true, rev text DEFAULT 'uploaded')
RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO public.documents (driver_id, kind, category, storage_bucket, storage_path, is_current, review_status)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', cat, cat, 'driver-docs',
          'fixture/'||cat||'-'||md5(random()::text), cur, rev);
$fn$;

SELECT pg_temp.check(1,'0/4 docs');
SELECT pg_temp.add('license_front');          SELECT pg_temp.check(2,'1/4 docs');
SELECT pg_temp.add('license_back');
SELECT pg_temp.add('insurance');              SELECT pg_temp.check(3,'3/4 docs');
SELECT pg_temp.add('gig_profile');            SELECT pg_temp.check(4,'4/4 docs, no recording');
SELECT pg_temp.add('verification_recording'); SELECT pg_temp.check(5,'4/4 + recording');
UPDATE public.documents SET review_status='rejected'
 WHERE driver_id='aaaaaaaa-0000-4000-8000-000000000001' AND category='insurance';
                                              SELECT pg_temp.check(6,'insurance REJECTED');
UPDATE public.documents SET review_status='uploaded', is_current=false
 WHERE driver_id='aaaaaaaa-0000-4000-8000-000000000001' AND category='insurance';
                                              SELECT pg_temp.check(7,'insurance SUPERSEDED');
SELECT pg_temp.add('insurance');              SELECT pg_temp.check(8,'replacement current + previous superseded');
UPDATE public.documents SET is_current=false
 WHERE driver_id='aaaaaaaa-0000-4000-8000-000000000001' AND category='verification_recording';
                                              SELECT pg_temp.check(9,'recording superseded, no replacement');

SELECT step, scenario, outcome FROM gate_results ORDER BY step;

ROLLBACK;
