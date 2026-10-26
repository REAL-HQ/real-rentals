-- PREPARATION ONLY. Ops reminders scheduler fix v1 ROLLBACK: ops-reminders-daily back to its August command (extensions.http_post). Single statement.
-- Send only as request-rollback-ops-reminders-cron.sql (guard v3 + these exact bytes) through query_database. Separate approval.
-- Effect: the job fails again on every run, as it did from August until the fix, so no ops reminder or digest can be sent. Nothing else changes.
-- Changes: cron.job jobid 3 command only, via cron.alter_job; one audit_log rollback row. The fix's evidence row is kept.
-- Faster stop without restoring the old text: cron.alter_job(3, active := false) (see README, emergency stop).
DO $rrcronopsrb$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 broken_md5 CONSTANT text := '7a6594649bd441f8ecb8baf8fc529368';
 fixed_md5 CONSTANT text := '9d4bc178b65e26da0d7899c96809fc44';
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

 SELECT count(*) INTO n FROM cron.job WHERE jobname = 'ops-reminders-daily';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'CRON_JOB_NOT_UNIQUE'; END IF;
 SELECT jobid, command, username INTO j FROM cron.job WHERE jobname = 'ops-reminders-daily';
 IF pg_catalog.md5(j.command) = broken_md5 THEN RAISE EXCEPTION 'CRON_FIX_NOT_INSTALLED'; END IF;
 IF j.jobid IS DISTINCT FROM 3::bigint OR j.username IS DISTINCT FROM 'postgres' OR pg_catalog.md5(j.command) IS DISTINCT FROM fixed_md5
 THEN RAISE EXCEPTION 'CRON_JOB_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix')
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
 VALUES (NULL, NULL, current_user, 'scheduler_fix_rolled_back', 'database_migration', 'ops_reminders_cron_fix_rollback',
  'ops-reminders-daily restored to its August command (extensions.http_post); no ops reminders can be sent',
  jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'ops-reminders-scheduler-fix v1 rollback', 'execution_at', evidence_time,
   'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user, 'jobid', j.jobid,
   'command_md5_before', fixed_md5, 'command_md5_after', broken_md5),
  evidence_time);
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrcronopsrb$;
