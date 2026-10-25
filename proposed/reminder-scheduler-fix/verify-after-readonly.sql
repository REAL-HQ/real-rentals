-- READ-ONLY. Reminder scheduler fix v1 verification. Run right after the request, then again after the next :15 run.
SELECT jsonb_build_object(
 'at', pg_catalog.now(),
 'job_fixed', (SELECT pg_catalog.md5(command) = '478d975efc9c11c5ad5e6c1fe7769ece' AND jobid = 2 AND schedule = '15 * * * *' AND active AND username = 'postgres' FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
 'ops_reminders_untouched', (SELECT pg_catalog.md5(command) = '7a6594649bd441f8ecb8baf8fc529368' FROM cron.job WHERE jobname = 'ops-reminders-daily'),
 'evidence_rows', (SELECT count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'wizard_recovery_cron_fix'),
 'last_runs', (SELECT jsonb_agg(jsonb_build_object('start', start_time, 'status', status) ORDER BY start_time DESC)
               FROM (SELECT start_time, status FROM cron.job_run_details WHERE jobid = 2 ORDER BY start_time DESC LIMIT 3) r),
 'http_responses_since_fix', (SELECT jsonb_agg(jsonb_build_object('created', r.created, 'status', r.status_code,
      'report', CASE WHEN r.content ~ '^\{"ok":true' THEN r.content::jsonb ELSE NULL END,
      'error', pg_catalog.left(r.error_msg, 120)) ORDER BY r.created)
    FROM net._http_response r
    WHERE r.created > (SELECT max(created_at) FROM public.audit_log WHERE entity_id = 'wizard_recovery_cron_fix')
      AND (r.content ~ '^\{"ok":true,"considered_24h"' OR r.status_code IS DISTINCT FROM 200)),
 'reminders_since_fix', (SELECT jsonb_build_object(
      's24', count(*) FILTER (WHERE recovery_email_sent_24h > f.t), 's72', count(*) FILTER (WHERE recovery_email_sent_72h > f.t),
      'abandoned', count(*) FILTER (WHERE recovery_sent_at > f.t),
      'stamped_on_closed_or_deleted', count(*) FILTER (WHERE (recovery_email_sent_24h > f.t OR recovery_email_sent_72h > f.t OR recovery_sent_at > f.t)
          AND (deleted_at IS NOT NULL OR purged_at IS NOT NULL OR pg_catalog.lower(coalesce(status, '')) = ANY (ARRAY['approved','active','suspended','declined','closed','duplicate','complete']))))
    FROM public.applications, (SELECT max(created_at) AS t FROM public.audit_log WHERE entity_id = 'wizard_recovery_cron_fix') f),
 'recovery_tokens_since_fix', (SELECT jsonb_build_object(
      'thirty_minute', count(*) FILTER (WHERE expires_at - created_at <= interval '31 minutes'),
      'longer', count(*) FILTER (WHERE expires_at - created_at > interval '31 minutes'))
    FROM public.application_resume_tokens, (SELECT max(created_at) AS t FROM public.audit_log WHERE entity_id = 'wizard_recovery_cron_fix') f
    WHERE created_at > f.t),
 'transaction_read_only', pg_catalog.current_setting('transaction_read_only')
) AS reminder_scheduler_verify;
