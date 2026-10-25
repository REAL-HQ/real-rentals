-- PREPARATION ONLY. Reminder scheduler fix v1: wizard-recovery-hourly calls net.http_post (pg_net), as every working job does. Single statement.
-- Send only as request-fix-wizard-recovery-cron.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: cron.job jobid 2 command only (extensions.http_post( -> net.http_post(), via cron.alter_job; one audit_log evidence row.
-- Untouched: schedule, active flag, owner, every other cron job (ops-reminders-daily included), every application row, policies, ledgers.
-- Refuses unless the job is byte-identical to the July definition (md5 1c830e74...), and unless the first run would send at most 10 emails.
DO $rrcron$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 broken_md5 CONSTANT text := '1c830e7409ddcb0275cea04ffcca74c9';
 fixed_md5 CONSTANT text := '478d975efc9c11c5ad5e6c1fe7769ece';
 ops_md5 CONSTANT text := '7a6594649bd441f8ecb8baf8fc529368';
 first_run_cap CONSTANT integer := 10;
 prev_search_path text := pg_catalog.current_setting('search_path');
 j record;
 ops_before text;
 jobs_before jsonb;
 jobs_after jsonb;
 cmd_after text;
 e24 integer; e72 integer; eab integer;
 n integer;
 evidence_time timestamptz;
 evidence_id uuid;
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
 PERFORM pg_catalog.pg_advisory_xact_lock(7310201); -- cron.job is owned by supabase_admin; postgres may read it but not lock it for write
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;

 -- Replay: one fix per evidence row.
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix') THEN
  RAISE EXCEPTION 'CRON_FIX_EVIDENCE_REPLAY'; END IF;

 -- The job, exactly as defined in July: one row, same owner, schedule, state and bytes.
 SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'CRON_JOB_NOT_UNIQUE'; END IF;
 SELECT jobid, schedule, command, active, username, database INTO j FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF pg_catalog.md5(j.command) = fixed_md5 THEN RAISE EXCEPTION 'CRON_JOB_ALREADY_FIXED'; END IF;
 IF j.jobid IS DISTINCT FROM 2::bigint OR j.schedule IS DISTINCT FROM '15 * * * *' OR j.active IS NOT TRUE
 OR j.username IS DISTINCT FROM 'postgres' OR j.database IS DISTINCT FROM 'postgres'
 OR pg_catalog.md5(j.command) IS DISTINCT FROM broken_md5
 THEN RAISE EXCEPTION 'CRON_JOB_DRIFT'; END IF;
 SELECT pg_catalog.md5(command) INTO ops_before FROM cron.job WHERE jobname = 'ops-reminders-daily';
 IF ops_before IS DISTINCT FROM ops_md5 THEN RAISE EXCEPTION 'OPS_JOB_DRIFT'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_before FROM cron.job WHERE jobid <> j.jobid;

 -- The supported mechanism: pg_net, the path the working jobs use; the route's token row and checker.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace
                WHERE s.nspname = 'net' AND p.proname = 'http_post') THEN RAISE EXCEPTION 'PG_NET_MISSING'; END IF;
 IF NOT EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'wizard-recovery' AND coalesce(pg_catalog.length(token), 0) > 0)
 THEN RAISE EXCEPTION 'CRON_TOKEN_MISSING'; END IF;
 IF pg_catalog.to_regprocedure('public.get_cron_token(text)') IS NULL THEN RAISE EXCEPTION 'TOKEN_CHECKER_MISSING'; END IF;

 -- First-run volume, with the released app's own filters (src/lib/wizard-recovery.server.ts at 4a0eed9c):
 -- open drafts only (not deleted/purged, has email, not decided, not applied), 24h window 24-26h old,
 -- 72h window 72-96h old after a 24h nudge, abandoned window 3-48h old for status partial.
 WITH base AS (
  SELECT a.status, a.created_at, a.recovery_email_sent_24h AS s24, a.recovery_email_sent_72h AS s72, a.recovery_sent_at AS sab,
   (a.deleted_at IS NULL AND a.purged_at IS NULL AND coalesce(pg_catalog.btrim(a.email), '') <> ''
    AND coalesce(pg_catalog.lower(a.status), '') <> ALL (ARRAY['approved','active','suspended','declined','closed','duplicate','complete','completed','submitted'])
    AND (a.current_step IS NULL OR pg_catalog.lower(a.current_step) <> ALL (ARRAY['submitted','documents','profile_complete','confirmation','complete','done']))) AS open_draft
  FROM public.applications a)
 SELECT count(*) FILTER (WHERE open_draft AND s24 IS NULL AND created_at < pg_catalog.now() - interval '24 hours' AND created_at >= pg_catalog.now() - interval '26 hours'),
        count(*) FILTER (WHERE open_draft AND s24 IS NOT NULL AND s72 IS NULL AND created_at < pg_catalog.now() - interval '72 hours' AND created_at >= pg_catalog.now() - interval '96 hours'),
        count(*) FILTER (WHERE open_draft AND pg_catalog.lower(status) = 'partial' AND sab IS NULL AND created_at < pg_catalog.now() - interval '3 hours' AND created_at >= pg_catalog.now() - interval '48 hours')
  INTO e24, e72, eab FROM base;
 IF e24 + e72 + eab > first_run_cap THEN RAISE EXCEPTION 'FIRST_RUN_VOLUME_EXCEEDS_CAP' USING DETAIL = (e24 + e72 + eab)::text; END IF;

 -- The fix: the same command text with the missing function replaced by pg_net's. URL, headers, token lookup and body unchanged.
 PERFORM cron.alter_job(job_id := j.jobid, command := pg_catalog.replace(j.command, 'extensions.http_post(', 'net.http_post('));

 SELECT command INTO cmd_after FROM cron.job WHERE jobid = j.jobid;
 IF pg_catalog.md5(cmd_after) IS DISTINCT FROM fixed_md5 THEN RAISE EXCEPTION 'CRON_FIX_POSTCONDITION_COMMAND'; END IF;
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = j.jobid AND jobname = 'wizard-recovery-hourly' AND schedule = '15 * * * *'
                AND active AND username = 'postgres' AND database = 'postgres') THEN RAISE EXCEPTION 'CRON_FIX_POSTCONDITION_JOB'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_after FROM cron.job WHERE jobid <> j.jobid;
 IF jobs_after IS DISTINCT FROM jobs_before THEN RAISE EXCEPTION 'OTHER_JOBS_CHANGED'; END IF;

 evidence_time := pg_catalog.clock_timestamp();
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'scheduler_fix_verified', 'database_migration', 'wizard_recovery_cron_fix',
  'wizard-recovery-hourly now calls net.http_post; postconditions verified by database migration executor',
  jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'reminder-scheduler-fix v1', 'execution_at', evidence_time,
   'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user, 'session_executor', session_user,
   'jobid', j.jobid, 'command_md5_before', broken_md5, 'command_md5_after', fixed_md5,
   'first_run_eligible', jsonb_build_object('h24', e24, 'h72', e72, 'abandoned', eab), 'first_run_cap', first_run_cap,
   'ops_reminders_md5_unchanged', ops_md5),
  evidence_time)
 RETURNING id INTO evidence_id;
 SELECT count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix';
 IF evidence_id IS NULL OR n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrcron$;
