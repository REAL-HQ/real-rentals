ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_attempted',
  ADD COLUMN IF NOT EXISTS email_error text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_status text NOT NULL DEFAULT 'not_attempted',
  ADD COLUMN IF NOT EXISTS sms_error text,
  ADD COLUMN IF NOT EXISTS sms_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_last_attempt_at timestamptz;

INSERT INTO private.cron_tokens (name, token)
VALUES ('esign-archive-retry', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'esign-archive-retry-hourly';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'esign-archive-retry-hourly',
  '45 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/esign-archive-retry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'esign-archive-retry')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);