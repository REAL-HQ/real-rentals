-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Reminder scheduler fix v1 ROLLBACK: wizard-recovery-hourly back to its July command (extensions.http_post). Single statement.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '36c4067a882b5a788869b3e709bb58a79f76d2098db7752820de8bb43ce3b2f1', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '36c4067a882b5a788869b3e709bb58a79f76d2098db7752820de8bb43ce3b2f1';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 4465), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '698b62657ddb3c358fb26709f62ad602434003d5e03496e7276098171c90761e';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 4465) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Reminder scheduler fix v1 ROLLBACK: wizard-recovery-hourly back to its July command (extensions.http_post). Single statement.
-- Send only as request-rollback-wizard-recovery-cron.sql (guard v3 + these exact bytes) through query_database. Separate approval.
-- Effect: the job fails again on every run, as it did from July until the fix, so no reminder can be sent. Nothing else changes.
-- Changes: cron.job jobid 2 command only, via cron.alter_job; one audit_log rollback row. The fix's evidence row is kept.
-- Faster stop without restoring the old text: cron.alter_job(2, active := false) (see README, emergency stop).
DO $rrcronrb$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 broken_md5 CONSTANT text := '1c830e7409ddcb0275cea04ffcca74c9';
 fixed_md5 CONSTANT text := '478d975efc9c11c5ad5e6c1fe7769ece';
 prev_search_path text := pg_catalog.current_setting('search_path');
 j record;
 jobs_before jsonb;
 jobs_after jsonb;
 n integer;
 evidence_time timestamptz;
BEGIN
 IF profile->>'project_ref' IS DISTINCT FROM 'yuyzdsnrbfhkmfzpvhwx'
 OR profile->>'lovable_project_id' IS DISTINCT FROM '8cf1f99e-71ad-4a93-a47c-bfbe833616d6'
 OR profile->>'system_identifier' IS NULL OR profile->>'execution_role' IS NULL OR profile->>'database' IS NULL
 THEN RAISE EXCEPTION 'UNSEALED_TARGET_PROFILE'; END IF;
 IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM profile->>'system_identifier'
 OR pg_catalog.current_database() IS DISTINCT FROM profile->>'database'
 OR current_user IS DISTINCT FROM (profile->>'execution_role')::name
 THEN RAISE EXCEPTION 'WRONG_TARGET'; END IF;

 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310201);
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;

 SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'CRON_JOB_NOT_UNIQUE'; END IF;
 SELECT jobid, command, username INTO j FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF pg_catalog.md5(j.command) = broken_md5 THEN RAISE EXCEPTION 'CRON_FIX_NOT_INSTALLED'; END IF;
 IF j.jobid IS DISTINCT FROM 2::bigint OR j.username IS DISTINCT FROM 'postgres' OR pg_catalog.md5(j.command) IS DISTINCT FROM fixed_md5
 THEN RAISE EXCEPTION 'CRON_JOB_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix')
 THEN RAISE EXCEPTION 'CRON_FIX_EVIDENCE_MISSING'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_before FROM cron.job WHERE jobid <> j.jobid;

 PERFORM cron.alter_job(job_id := j.jobid, command := pg_catalog.replace(j.command, 'net.http_post(', 'extensions.http_post('));

 IF (SELECT pg_catalog.md5(command) FROM cron.job WHERE jobid = j.jobid) IS DISTINCT FROM broken_md5 THEN RAISE EXCEPTION 'ROLLBACK_POSTCONDITION_COMMAND'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_after FROM cron.job WHERE jobid <> j.jobid;
 IF jobs_after IS DISTINCT FROM jobs_before THEN RAISE EXCEPTION 'OTHER_JOBS_CHANGED'; END IF;

 evidence_time := pg_catalog.clock_timestamp();
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'scheduler_fix_rolled_back', 'database_migration', 'wizard_recovery_cron_fix_rollback',
  'wizard-recovery-hourly restored to its July command (extensions.http_post); no reminders can be sent',
  jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'reminder-scheduler-fix v1 rollback', 'execution_at', evidence_time,
   'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user, 'jobid', j.jobid,
   'command_md5_before', fixed_md5, 'command_md5_after', broken_md5),
  evidence_time);
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrcronrb$;
