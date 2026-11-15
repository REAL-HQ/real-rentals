-- PREPARED, NOT RUN. Needs Dolmar's approval, after
-- supabase/migrations/20261114130000_fleet_webhooks_quo_events_lead_activity.sql
-- is applied and the code is published. Runs the FLEET webhook queue every
-- minute (instant sends happen inline; this delivers retries and any lead
-- event the inline try missed). Sends nothing until FLEET_WEBHOOK_URL and
-- FLEET_WEBHOOK_KEY are set as server secrets.
INSERT INTO private.cron_tokens (name, token)
VALUES ('fleet-webhooks', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'fleet-webhooks-every-minute';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'fleet-webhooks-every-minute',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/fleet-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'fleet-webhooks')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'fleet-webhooks-every-minute';
