-- PREPARED ONLY. Target: yuyzdsnrbfhkmfzpvhwx, verified by the execution connection.
-- Requires separately approved pause/drain. Never schedules, resumes or invokes a job.
-- Changes only job 2's obsolete function namespace; preserves cadence and identity.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(7310031);
DO $repair$
DECLARE old_command text; new_command text;
BEGIN
  SELECT command INTO old_command FROM cron.job
    WHERE jobid=2 AND jobname='wizard-recovery-hourly' AND schedule='15 * * * *'
      AND active=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_JOB_NOT_PAUSED_OR_DRIFT'; END IF;
  IF md5(old_command)<>'1c830e7409ddcb0275cea04ffcca74c9' THEN
    RAISE EXCEPTION 'RECOVERY_COMMAND_DRIFT';
  END IF;
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'SUPPORTED_HTTP_DEPENDENCY_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.cron_tokens
    WHERE name='wizard-recovery' AND nullif(btrim(token),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'RECOVERY_AUTH_DEPENDENCY_MISSING';
  END IF;
  new_command := replace(old_command,'extensions.http_post(', 'net.http_post(');
  PERFORM cron.alter_job(2, command := new_command);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid=2 AND command=new_command
      AND jobname='wizard-recovery-hourly' AND schedule='15 * * * *' AND active=false) THEN
    RAISE EXCEPTION 'RECOVERY_REPAIR_POSTCONDITION_FAILED';
  END IF;
END $repair$;
COMMIT;
