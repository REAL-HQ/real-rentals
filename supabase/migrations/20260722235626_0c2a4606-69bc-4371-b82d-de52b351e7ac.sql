
-- Wizard recovery: track when 24h/72h nudge emails were sent
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS recovery_email_sent_24h TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_email_sent_72h TIMESTAMPTZ;

-- Private schema for cron shared-secret storage (not exposed via Data API)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.cron_tokens (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO private.cron_tokens (name, token)
VALUES ('wizard-recovery', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- Extensions for scheduled HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any prior version, then schedule hourly recovery sweep
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'wizard-recovery-hourly';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'wizard-recovery-hourly',
  '15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/wizard-recovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'wizard-recovery')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);
