-- PREPARATION ONLY. Ops reminders scheduler fix v1: ops-reminders-daily calls net.http_post (pg_net), as every working job does. Single statement.
-- Send only as request-fix-ops-reminders-cron.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: cron.job jobid 3 command only (extensions.http_post( -> net.http_post(), via cron.alter_job; one audit_log evidence row.
-- Untouched: schedule, active flag, owner, every other cron job (wizard-recovery-hourly included), every application, payment, agreement and message row.
-- Refuses unless the job is byte-identical to its August definition (md5 7a659464...), job 2 is the installed wizard fix (md5 478d975e...),
-- and the first run would send at most 10 driver emails by the route's own rules. The app release with the claim and cap must be live first.
DO $rrcronops$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 broken_md5 CONSTANT text := '7a6594649bd441f8ecb8baf8fc529368';
 fixed_md5 CONSTANT text := '9d4bc178b65e26da0d7899c96809fc44';
 wizard_fixed_md5 CONSTANT text := '478d975efc9c11c5ad5e6c1fe7769ece';
 first_run_cap CONSTANT integer := 10;
 prev_search_path text := pg_catalog.current_setting('search_path');
 j record;
 w record;
 jobs_before jsonb;
 jobs_after jsonb;
 cmd_after text;
 epd integer; elic integer; eag integer;
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
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix') THEN
  RAISE EXCEPTION 'CRON_FIX_EVIDENCE_REPLAY'; END IF;

 -- The job, exactly as defined in August: one row, same owner, schedule, state and bytes.
 SELECT count(*) INTO n FROM cron.job WHERE jobname = 'ops-reminders-daily';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'CRON_JOB_NOT_UNIQUE'; END IF;
 SELECT jobid, schedule, command, active, username, database INTO j FROM cron.job WHERE jobname = 'ops-reminders-daily';
 IF pg_catalog.md5(j.command) = fixed_md5 THEN RAISE EXCEPTION 'CRON_JOB_ALREADY_FIXED'; END IF;
 IF j.jobid IS DISTINCT FROM 3::bigint OR j.schedule IS DISTINCT FROM '30 13 * * *' OR j.active IS NOT TRUE
 OR j.username IS DISTINCT FROM 'postgres' OR j.database IS DISTINCT FROM 'postgres'
 OR pg_catalog.md5(j.command) IS DISTINCT FROM broken_md5
 THEN RAISE EXCEPTION 'CRON_JOB_DRIFT'; END IF;
 -- Scope: job 2 is the installed wizard-recovery fix, and nothing else is touched.
 SELECT count(*) INTO n FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'WIZARD_JOB_DRIFT'; END IF;
 SELECT jobid, schedule, command, active, username INTO w FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
 IF w.jobid IS DISTINCT FROM 2::bigint OR w.schedule IS DISTINCT FROM '15 * * * *' OR w.active IS NOT TRUE
 OR w.username IS DISTINCT FROM 'postgres' OR pg_catalog.md5(w.command) IS DISTINCT FROM wizard_fixed_md5
 THEN RAISE EXCEPTION 'WIZARD_JOB_DRIFT'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_before FROM cron.job WHERE jobid <> j.jobid;

 -- The supported mechanism: pg_net, the path the working jobs use; the route's token row and checker.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace
                WHERE s.nspname = 'net' AND p.proname = 'http_post') THEN RAISE EXCEPTION 'PG_NET_MISSING'; END IF;
 IF NOT EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'ops-reminders' AND coalesce(pg_catalog.length(token), 0) > 0)
 THEN RAISE EXCEPTION 'CRON_TOKEN_MISSING'; END IF;
 IF pg_catalog.to_regprocedure('public.get_cron_token(text)') IS NULL THEN RAISE EXCEPTION 'TOKEN_CHECKER_MISSING'; END IF;

 -- First-run driver emails, with the route's own rules (src/lib/ops-reminders.server.ts): one per driver per kind,
 -- 6-day spacing on outbound_messages; past due = a payment due before today (UTC) in an owed status with
 -- balance_due (else amount) > 0; licence = approved/active, expiry on or before today + 30; agreement = sent/viewed
 -- more than 3 days ago, token unexpired, one per driver. The route's read limits (200/200/100) are not applied,
 -- so this can only over-count.
 WITH t AS (SELECT (pg_catalog.now() AT TIME ZONE 'UTC')::date AS today, pg_catalog.now() - interval '6 days' AS since),
 pd AS (SELECT a.id FROM public.applications a, t
  WHERE coalesce(a.email, '') <> ''
   AND EXISTS (SELECT 1 FROM public.payments p WHERE p.driver_id = a.id AND p.due_date < t.today
    AND p.status = ANY (ARRAY['pending','failed','overdue','past_due','unpaid','late'])
    AND (CASE WHEN coalesce(p.balance_due, 0) <> 0 THEN p.balance_due ELSE coalesce(p.amount, 0) END) > 0)
   AND NOT EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = a.id AND m.kind = 'past_due' AND m.created_at >= t.since)),
 lic AS (SELECT a.id FROM public.applications a, t
  WHERE coalesce(a.email, '') <> '' AND a.license_expiration IS NOT NULL AND a.license_expiration <= t.today + 30
   AND a.status = ANY (ARRAY['approved','active'])
   AND NOT EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = a.id AND m.kind = 'license_expiring' AND m.created_at >= t.since)),
 ag AS (SELECT DISTINCT g.application_id FROM t, public.agreements g LEFT JOIN public.applications a ON a.id = g.application_id
  WHERE g.status = ANY (ARRAY['sent','viewed']) AND g.sent_at < pg_catalog.now() - interval '3 days' AND g.token_expires_at > pg_catalog.now()
   AND coalesce(NULLIF(g.signer_email, ''), a.email, '') <> ''
   AND NOT EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = g.application_id AND m.kind = 'agreement_reminder' AND m.created_at >= t.since))
 SELECT (SELECT count(*) FROM pd), (SELECT count(*) FROM lic), (SELECT count(*) FROM ag) INTO epd, elic, eag;
 IF epd + elic + eag > first_run_cap THEN RAISE EXCEPTION 'FIRST_RUN_VOLUME_EXCEEDS_CAP' USING DETAIL = (epd + elic + eag)::text; END IF;

 -- The fix: the same command text with the missing function replaced by pg_net's. URL, headers, token lookup and body unchanged.
 PERFORM cron.alter_job(job_id := j.jobid, command := pg_catalog.replace(j.command, 'extensions.http_post(', 'net.http_post('));

 SELECT command INTO cmd_after FROM cron.job WHERE jobid = j.jobid;
 IF pg_catalog.md5(cmd_after) IS DISTINCT FROM fixed_md5 THEN RAISE EXCEPTION 'CRON_FIX_POSTCONDITION_COMMAND'; END IF;
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = j.jobid AND jobname = 'ops-reminders-daily' AND schedule = '30 13 * * *'
                AND active AND username = 'postgres' AND database = 'postgres') THEN RAISE EXCEPTION 'CRON_FIX_POSTCONDITION_JOB'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid', jobid, 'md5', pg_catalog.md5(command), 'schedule', schedule, 'active', active) ORDER BY jobid)
  INTO jobs_after FROM cron.job WHERE jobid <> j.jobid;
 IF jobs_after IS DISTINCT FROM jobs_before THEN RAISE EXCEPTION 'OTHER_JOBS_CHANGED'; END IF;

 evidence_time := pg_catalog.clock_timestamp();
 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'scheduler_fix_verified', 'database_migration', 'ops_reminders_cron_fix',
  'ops-reminders-daily now calls net.http_post; postconditions verified by database migration executor',
  jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'ops-reminders-scheduler-fix v1', 'execution_at', evidence_time,
   'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user, 'session_executor', session_user,
   'jobid', j.jobid, 'command_md5_before', broken_md5, 'command_md5_after', fixed_md5,
   'first_run_eligible', jsonb_build_object('past_due', epd, 'license_expiring', elic, 'agreement_reminder', eag), 'first_run_cap', first_run_cap,
   'wizard_recovery_md5_unchanged', wizard_fixed_md5),
  evidence_time)
 RETURNING id INTO evidence_id;
 SELECT count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix';
 IF evidence_id IS NULL OR n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrcronops$;
