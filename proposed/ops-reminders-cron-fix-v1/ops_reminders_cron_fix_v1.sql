-- Staged only. NOT applied. Owner approval required.
--
-- ops-reminders-daily has failed every run: its command calls
-- extensions.http_post(url, headers, body), which does not exist. Every other
-- job (automations, late-fees, esign-archive-retry, wizard-recovery) calls
-- net.http_post (pg_net) and succeeds. This rewrites only that job's command
-- to the same working form. Schedule (30 13 * * * = 8:30 AM ET in winter)
-- and the token lookup are unchanged; no token value appears here.
--
-- EFFECT WHEN APPLIED: the next 8:30 AM ET run will really send, subject to
-- the Automations switches: due-tomorrow / past-due renter emails, team
-- payment alerts, collections plan, license-expiring emails, the service
-- digest and agreement reminders (unsigned agreements older than 3 days).
-- Turn off anything not wanted in Back Office → Automations first.
DO $$
DECLARE v_jobid bigint;
BEGIN
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'pg_net net.http_post is not installed; nothing changed';
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ops-reminders-daily';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'ops-reminders-daily not found; nothing changed';
  END IF;
  PERFORM cron.alter_job(
    job_id := v_jobid,
    command := $cmd$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/ops-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'ops-reminders')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
  );
END $$;
