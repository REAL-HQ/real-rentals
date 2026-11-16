-- PROPOSED, NOT APPLIED. Turns team alerts on. Sends real texts to the field rep
-- (+18134768508) and emails to team@drivereal.com. Run only with Dolmar's
-- go-ahead, after proposed/team-alerts-v1.sql and the publish.
-- Turn on only the kinds he approved; each line is independent.
UPDATE public.app_settings SET value = jsonb_set(value, '{roadside_overnight,enabled}', 'true') WHERE key = 'team_alerts';
UPDATE public.app_settings SET value = jsonb_set(value, '{late_pickup,enabled}', 'true') WHERE key = 'team_alerts';
UPDATE public.app_settings SET value = jsonb_set(value, '{bot_handoff,enabled}', 'true') WHERE key = 'team_alerts';
-- GPS: only after the trackers are mapped to cars (see docs/gps-alerts.md).
-- UPDATE public.app_settings SET value = jsonb_set(value, '{gps,enabled}', 'true') WHERE key = 'team_alerts';
-- Verify: SELECT value FROM public.app_settings WHERE key = 'team_alerts';
