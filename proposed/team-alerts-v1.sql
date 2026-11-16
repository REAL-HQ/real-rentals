-- PROPOSED, NOT APPLIED. Team alerts to a person (Dolmar, card t299s1618):
-- GPS alerts, overnight roadside, late-pickup release and bot hand-offs.
-- One email to team@drivereal.com and one text to the field rep
-- (+18134768508, a constant in src/lib/team-alerts.ts).
--
-- 1. team_alert_sends: each alert is claimed once by key before it is sent.
-- 2. app_settings.team_alerts: every kind OFF. Turn one on with
--    proposed/team-alerts-on.sql only after Dolmar approves it.
-- Safe to run twice.
CREATE TABLE IF NOT EXISTS public.team_alert_sends (
  key text PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  detail text,
  rental_id uuid,
  vehicle_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_alert_sends ENABLE ROW LEVEL SECURITY;
-- Service role only (no policies): the server writes, staff read through the admin API.
CREATE INDEX IF NOT EXISTS team_alert_sends_created_idx ON public.team_alert_sends (created_at DESC);

INSERT INTO public.app_settings (key, value)
VALUES ('team_alerts', '{"gps": {"enabled": false}, "roadside_overnight": {"enabled": false}, "late_pickup": {"enabled": false}, "bot_handoff": {"enabled": false}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Rollback: DROP TABLE public.team_alert_sends; DELETE FROM public.app_settings WHERE key = 'team_alerts';
