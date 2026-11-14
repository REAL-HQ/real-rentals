-- PREPARED, NOT RUN. Needs Dolmar's approval, after
-- supabase/migrations/20261109210000_rent_reminders.sql is applied and the
-- code is published. Schedules the hourly rent-reminder run. Sends nothing by
-- itself: every stage is an Automations switch that is OFF until turned on.
INSERT INTO private.cron_tokens (name, token)
VALUES ('rent-reminders', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'rent-reminders-hourly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'rent-reminders-hourly',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/rent-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'rent-reminders')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'rent-reminders-hourly';
