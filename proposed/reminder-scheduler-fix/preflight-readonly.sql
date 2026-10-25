-- READ-ONLY. Reminder scheduler fix v1 preflight: job state, mechanism, tokens and first-run volume. Counts only.
SELECT jsonb_build_object(
 'at', pg_catalog.now(),
 'minutes_to_next_run', (75 - pg_catalog.date_part('minute', pg_catalog.now())::int) % 60,
 'job', (SELECT jsonb_build_object('jobid', jobid, 'schedule', schedule, 'active', active, 'username', username, 'database', database, 'md5', pg_catalog.md5(command))
         FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
 'ops_reminders_md5', (SELECT pg_catalog.md5(command) FROM cron.job WHERE jobname = 'ops-reminders-daily'),
 'gates', jsonb_build_object(
   'job_is_july_definition', (SELECT pg_catalog.md5(command) = '1c830e7409ddcb0275cea04ffcca74c9' AND jobid = 2 AND schedule = '15 * * * *' AND active AND username = 'postgres' FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
   'ops_reminders_untouched', (SELECT pg_catalog.md5(command) = '7a6594649bd441f8ecb8baf8fc529368' FROM cron.job WHERE jobname = 'ops-reminders-daily'),
   'pg_net_http_post', EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'net' AND p.proname = 'http_post'),
   'cron_token_present', EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'wizard-recovery' AND coalesce(pg_catalog.length(token), 0) > 0),
   'token_checker_present', pg_catalog.to_regprocedure('public.get_cron_token(text)') IS NOT NULL,
   'no_prior_fix_evidence', NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix')),
 'first_run_eligible', (WITH base AS (
   SELECT a.status, a.created_at, a.recovery_email_sent_24h AS s24, a.recovery_email_sent_72h AS s72, a.recovery_sent_at AS sab,
    (a.deleted_at IS NULL AND a.purged_at IS NULL AND coalesce(pg_catalog.btrim(a.email), '') <> ''
     AND coalesce(pg_catalog.lower(a.status), '') <> ALL (ARRAY['approved','active','suspended','declined','closed','duplicate','complete','completed','submitted'])
     AND (a.current_step IS NULL OR pg_catalog.lower(a.current_step) <> ALL (ARRAY['submitted','documents','profile_complete','confirmation','complete','done']))) AS open_draft
   FROM public.applications a)
  SELECT jsonb_build_object(
   'h24', count(*) FILTER (WHERE open_draft AND s24 IS NULL AND created_at < pg_catalog.now() - interval '24 hours' AND created_at >= pg_catalog.now() - interval '26 hours'),
   'h72', count(*) FILTER (WHERE open_draft AND s24 IS NOT NULL AND s72 IS NULL AND created_at < pg_catalog.now() - interval '72 hours' AND created_at >= pg_catalog.now() - interval '96 hours'),
   'abandoned', count(*) FILTER (WHERE open_draft AND pg_catalog.lower(status) = 'partial' AND sab IS NULL AND created_at < pg_catalog.now() - interval '3 hours' AND created_at >= pg_catalog.now() - interval '48 hours'),
   'open_drafts_outside_windows', count(*) FILTER (WHERE open_draft AND created_at < pg_catalog.now() - interval '96 hours'),
   'cap', 10) FROM base),
 'transaction_read_only', pg_catalog.current_setting('transaction_read_only')
) AS reminder_scheduler_preflight;
