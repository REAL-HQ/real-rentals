-- Turns on the vehicle_available team alert (email to team@, rosa@ during
-- her hours, company-line text, and the FLEET vehicle_available webhook).
-- Leaves every other team-alert switch as it is. Do not apply until go-live.
UPDATE public.app_settings
   SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{vehicle_available}', '{"enabled": true}'::jsonb, true)
 WHERE key = 'team_alerts';
INSERT INTO public.app_settings (key, value)
SELECT 'team_alerts', '{"vehicle_available":{"enabled":true}}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'team_alerts');

-- Rollback:
-- UPDATE public.app_settings SET value = value - 'vehicle_available' WHERE key = 'team_alerts';
