-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
-- Turns on the applicant_approved team alert (FLEET -> POST /api/public/fleet/team-alert,
-- kind "applicant_approved"). Leaves every other team-alert switch as it is.
-- Data only (app_settings). Rollback at the bottom.
UPDATE public.app_settings
   SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{applicant_approved}', '{"enabled": true}'::jsonb, true)
 WHERE key = 'team_alerts';

-- Rollback:
-- UPDATE public.app_settings SET value = value - 'applicant_approved' WHERE key = 'team_alerts';
