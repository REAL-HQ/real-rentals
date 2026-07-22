
-- Unschedule the existing cron job (it referenced net.http_post in public)
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

-- Reinstall pg_net into extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- Re-schedule using the fully-qualified function
SELECT cron.schedule(
  'wizard-recovery-hourly',
  '15 * * * *',
  $cron$
  SELECT extensions.http_post(
    url := 'https://drivereal.com/api/public/cron/wizard-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'wizard-recovery')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);
