-- PROPOSED, NOT APPLIED. Needs Dolmar's approval, after the code is published.
-- Pickup reminders and unsigned-agreement texts (src/lib/renter-reminders.server.ts).
-- Creates the once-per-step claim table and schedules the every-5-minute job.
-- Sends nothing by itself: both switches ("Pickup Reminders", "Agreement
-- Sign Texts") stay OFF in Back Office -> Automations until an Owner turns them on.

CREATE TABLE IF NOT EXISTS public.renter_reminder_sends (
  key text PRIMARY KEY,
  kind text NOT NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  agreement_id uuid REFERENCES public.agreements(id) ON DELETE SET NULL,
  channel text,
  status text NOT NULL DEFAULT 'claimed',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renter_reminder_sends_app_idx ON public.renter_reminder_sends (application_id, created_at DESC);
ALTER TABLE public.renter_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renter_reminder_sends FROM anon, authenticated;
DROP POLICY IF EXISTS renter_reminder_sends_staff_read ON public.renter_reminder_sends;
CREATE POLICY renter_reminder_sends_staff_read ON public.renter_reminder_sends
  FOR SELECT TO authenticated USING (private.is_staff());
GRANT SELECT ON public.renter_reminder_sends TO authenticated;

INSERT INTO private.cron_tokens (name, token)
VALUES ('renter-reminders', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'renter-reminders-every-5-min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'renter-reminders-every-5-min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/renter-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'renter-reminders')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- Rollback:
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'renter-reminders-every-5-min';
--   DELETE FROM private.cron_tokens WHERE name = 'renter-reminders';
--   DROP TABLE IF EXISTS public.renter_reminder_sends;
