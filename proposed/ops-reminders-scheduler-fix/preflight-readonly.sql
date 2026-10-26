-- READ-ONLY. Ops reminders scheduler fix v1 preflight: job state, scope, mechanism, token, first-run volume and backlog. Counts only.
WITH t AS (SELECT (pg_catalog.now() AT TIME ZONE 'UTC')::date AS today, pg_catalog.now() - interval '6 days' AS since),
pd AS (SELECT a.id,
   (SELECT pg_catalog.min(p.due_date) FROM public.payments p WHERE p.driver_id = a.id AND p.due_date < t.today
     AND p.status = ANY (ARRAY['pending','failed','overdue','past_due','unpaid','late'])
     AND (CASE WHEN coalesce(p.balance_due, 0) <> 0 THEN p.balance_due ELSE coalesce(p.amount, 0) END) > 0) AS oldest_due,
   EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = a.id AND m.kind = 'past_due' AND m.created_at >= t.since) AS recent,
   coalesce(a.email, '') <> '' AS has_email
  FROM public.applications a, t),
lic AS (SELECT a.license_expiration < t.today AS already_expired,
   EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = a.id AND m.kind = 'license_expiring' AND m.created_at >= t.since) AS recent,
   coalesce(a.email, '') <> '' AS has_email
  FROM public.applications a, t
  WHERE a.license_expiration IS NOT NULL AND a.license_expiration <= t.today + 30 AND a.status = ANY (ARRAY['approved','active'])),
ag AS (SELECT DISTINCT g.application_id,
   EXISTS (SELECT 1 FROM public.outbound_messages m WHERE m.application_id = g.application_id AND m.kind = 'agreement_reminder' AND m.created_at >= t.since) AS recent
  FROM t, public.agreements g LEFT JOIN public.applications a ON a.id = g.application_id
  WHERE g.status = ANY (ARRAY['sent','viewed']) AND g.sent_at < pg_catalog.now() - interval '3 days' AND g.token_expires_at > pg_catalog.now()
   AND coalesce(NULLIF(g.signer_email, ''), a.email, '') <> ''),
c AS (SELECT
   (SELECT count(*) FROM pd WHERE oldest_due IS NOT NULL AND has_email AND NOT recent) AS past_due,
   (SELECT count(*) FROM lic WHERE has_email AND NOT recent) AS license_expiring,
   (SELECT count(*) FROM ag WHERE NOT recent) AS agreement_reminder)
SELECT jsonb_build_object(
 'at', pg_catalog.now(),
 'minutes_to_next_run', (13 * 60 + 30 - (pg_catalog.date_part('hour', pg_catalog.now() AT TIME ZONE 'UTC')::int * 60
     + pg_catalog.date_part('minute', pg_catalog.now() AT TIME ZONE 'UTC')::int) + 1440) % 1440,
 'job', (SELECT jsonb_build_object('jobid', jobid, 'schedule', schedule, 'active', active, 'username', username, 'database', database, 'md5', pg_catalog.md5(command))
         FROM cron.job WHERE jobname = 'ops-reminders-daily'),
 'wizard_recovery_md5', (SELECT pg_catalog.md5(command) FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
 'gates', jsonb_build_object(
   'job_is_august_definition', (SELECT pg_catalog.md5(command) = '7a6594649bd441f8ecb8baf8fc529368' AND jobid = 3 AND schedule = '30 13 * * *' AND active AND username = 'postgres' AND database = 'postgres' FROM cron.job WHERE jobname = 'ops-reminders-daily'),
   'wizard_job_is_installed_fix', (SELECT pg_catalog.md5(command) = '478d975efc9c11c5ad5e6c1fe7769ece' AND jobid = 2 AND schedule = '15 * * * *' AND active AND username = 'postgres' FROM cron.job WHERE jobname = 'wizard-recovery-hourly'),
   'pg_net_http_post', EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'net' AND p.proname = 'http_post'),
   'cron_token_present', EXISTS (SELECT 1 FROM private.cron_tokens WHERE name = 'ops-reminders' AND coalesce(pg_catalog.length(token), 0) > 0),
   'token_checker_present', pg_catalog.to_regprocedure('public.get_cron_token(text)') IS NOT NULL,
   'no_prior_fix_evidence', NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'ops_reminders_cron_fix'),
   'first_run_within_cap', (SELECT past_due + license_expiring + agreement_reminder <= 10 FROM c)),
 'first_run_eligible', (SELECT jsonb_build_object('past_due', past_due, 'license_expiring', license_expiring, 'agreement_reminder', agreement_reminder,
   'total_driver_emails', past_due + license_expiring + agreement_reminder, 'cap', 10) FROM c),
 'backlog', jsonb_build_object(
   'past_due_by_oldest_due', (SELECT jsonb_build_object(
      'within_30_days', count(*) FILTER (WHERE oldest_due >= (SELECT today FROM t) - 30),
      'days_31_to_90', count(*) FILTER (WHERE oldest_due < (SELECT today FROM t) - 30 AND oldest_due >= (SELECT today FROM t) - 90),
      'over_90_days', count(*) FILTER (WHERE oldest_due < (SELECT today FROM t) - 90),
      'reminded_within_6_days', count(*) FILTER (WHERE recent),
      'no_email', count(*) FILTER (WHERE NOT has_email))
     FROM pd WHERE oldest_due IS NOT NULL),
   'licence', (SELECT jsonb_build_object('already_expired', count(*) FILTER (WHERE already_expired AND has_email AND NOT recent),
      'expiring_within_30_days', count(*) FILTER (WHERE NOT already_expired AND has_email AND NOT recent),
      'reminded_within_6_days', count(*) FILTER (WHERE recent)) FROM lic),
   'agreements_reminded_within_6_days', (SELECT count(*) FROM ag WHERE recent)),
 'team_digests', jsonb_build_object(
   'service_due_vehicles', (SELECT count(*) FROM public.vehicles v WHERE v.status <> 'retired' AND (
      (v.current_odometer IS NOT NULL AND v.last_oil_change_miles IS NOT NULL AND coalesce(v.oil_interval_miles, 0) <> 0
        AND v.current_odometer - v.last_oil_change_miles >= v.oil_interval_miles)
      OR (v.last_tire_date IS NOT NULL AND pg_catalog.date_part('epoch', pg_catalog.now() - (v.last_tire_date::timestamp AT TIME ZONE 'UTC')) / 86400 / 30.44 >= 6)
      OR (v.last_brake_inspection_date IS NOT NULL AND pg_catalog.date_part('epoch', pg_catalog.now() - (v.last_brake_inspection_date::timestamp AT TIME ZONE 'UTC')) / 86400 / 30.44 >= 12))),
   'expiring_documents', (SELECT count(*) FROM public.documents d, t WHERE d.is_current AND d.expires_at IS NOT NULL AND d.expires_at <= t.today + 30),
   'note', 'at most one email per digest per UTC day, to team@drivereal.com'),
 'transaction_read_only', pg_catalog.current_setting('transaction_read_only')
) AS ops_reminders_scheduler_preflight;
