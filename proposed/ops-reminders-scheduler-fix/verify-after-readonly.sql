-- READ-ONLY. Ops reminders scheduler fix v1 verification. Run right after the request, then after each 13:30 UTC run.
-- Outcomes are reported separately; an HTTP 200 is not proof that any email was delivered:
--  1 cron_executed     pg_cron ran the job (cron.job_run_details) - the request was queued
--  2 http              the app answered (net._http_response status + the route's JSON report: per category
--                      considered / sent / failed / capped, digests, driver_claims, budget_reached)
--  3 claimed           outbound_messages claim rows written before each send (queued = claimed, outcome unknown;
--                      sent = provider accepted the request), per kind and per UTC day
--  4 provider_accepted email_deliveries rows for this route's workflows that Resend accepted
--  5 delivered         rows the signed Resend webhook later marked delivered (bounced/complained shown too)
WITH f AS (SELECT max(created_at) AS t FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix')
SELECT jsonb_build_object(
 'at', pg_catalog.now(),
 'job_fixed', (SELECT pg_catalog.md5(command) = '9d4bc178b65e26da0d7899c96809fc44' AND jobid = 3 AND schedule = '30 13 * * *' AND active AND username = 'postgres' FROM cron.job WHERE jobname = 'ops-reminders-daily'),
 'wizard_recovery_untouched', (SELECT pg_catalog.md5(command) = '478d975efc9c11c5ad5e6c1fe7769ece' AND jobid = 2 FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
 'evidence_rows', (SELECT count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix'),
 '1_cron_executed', (SELECT jsonb_agg(jsonb_build_object('start', start_time, 'status', status) ORDER BY start_time DESC)
    FROM (SELECT start_time, status FROM cron.job_run_details, f WHERE jobid = 3 AND start_time > f.t ORDER BY start_time DESC LIMIT 6) r),
 '2_http', (SELECT jsonb_agg(jsonb_build_object('created', r.created, 'status', r.status_code,
      'report', CASE WHEN r.content ~ '^\{"ok":true,"past_due"' THEN r.content::jsonb ELSE NULL END,
      'error', pg_catalog.left(r.error_msg, 120)) ORDER BY r.created)
    FROM net._http_response r, f
    WHERE r.created > f.t AND (r.content ~ '^\{"ok":true,"past_due"' OR r.status_code IS DISTINCT FROM 200)),
 '3_claimed', (SELECT jsonb_build_object(
      'by_kind', coalesce((SELECT jsonb_object_agg(kind, s) FROM (
          SELECT kind, jsonb_build_object('queued', count(*) FILTER (WHERE status = 'queued'), 'sent', count(*) FILTER (WHERE status = 'sent'),
            'other', count(*) FILTER (WHERE status NOT IN ('queued', 'sent')), 'uncertain', count(*) FILTER (WHERE error LIKE 'uncertain:%')) AS s
          FROM public.outbound_messages, f WHERE created_at > f.t
            AND kind IN ('past_due', 'license_expiring', 'agreement_reminder', 'ops_service_digest', 'ops_documents_digest')
          GROUP BY kind) k), '{}'::jsonb),
      'driver_claims_per_utc_day', coalesce((SELECT jsonb_object_agg(d, n) FROM (
          SELECT (created_at AT TIME ZONE 'UTC')::date::text AS d, count(*) AS n FROM public.outbound_messages, f
          WHERE created_at > f.t AND channel = 'email' AND kind IN ('past_due', 'license_expiring', 'agreement_reminder') GROUP BY 1) x), '{}'::jsonb),
      'max_driver_claims_in_any_utc_day_le_10', coalesce((SELECT max(n) <= 10 FROM (
          SELECT count(*) AS n FROM public.outbound_messages, f
          WHERE created_at > f.t AND channel = 'email' AND kind IN ('past_due', 'license_expiring', 'agreement_reminder')
          GROUP BY (created_at AT TIME ZONE 'UTC')::date) y), true),
      'drivers_reminded_twice_within_6_days', (SELECT count(*) FROM public.outbound_messages m, f
          WHERE m.created_at > f.t AND m.kind IN ('past_due', 'license_expiring', 'agreement_reminder')
            AND EXISTS (SELECT 1 FROM public.outbound_messages o WHERE o.id <> m.id AND o.kind = m.kind AND o.application_id = m.application_id
              AND o.created_at <= m.created_at AND o.created_at > m.created_at - interval '6 days')),
      'digests_more_than_once_a_day', (SELECT count(*) FROM (SELECT 1 FROM public.outbound_messages, f WHERE created_at > f.t
          AND kind IN ('ops_service_digest', 'ops_documents_digest') GROUP BY kind, (created_at AT TIME ZONE 'UTC')::date HAVING count(*) > 1) z))),
 '4_5_email_outcomes', (SELECT coalesce(jsonb_object_agg(workflow, o), '{}'::jsonb) FROM (
    SELECT workflow, jsonb_build_object(
      'attempts', count(*),
      'provider_accepted', count(*) FILTER (WHERE accepted_at IS NOT NULL OR state IN ('accepted','delivered','bounced','complained')),
      'provider_failed', count(*) FILTER (WHERE state = 'failed'),
      'still_sending', count(*) FILTER (WHERE state = 'sending'),
      'delivered', count(*) FILTER (WHERE delivered_at IS NOT NULL OR state = 'delivered'),
      'bounced', count(*) FILTER (WHERE bounced_at IS NOT NULL OR state = 'bounced'),
      'complained', count(*) FILTER (WHERE complained_at IS NOT NULL OR state = 'complained')) AS o
    FROM public.email_deliveries, f
    WHERE workflow IN ('payment_past_due', 'license_expiring', 'esign_signing_reminder', 'service_digest') AND created_at > f.t
    GROUP BY workflow) e),
 'transaction_read_only', pg_catalog.current_setting('transaction_read_only')
) AS ops_reminders_scheduler_verify;
