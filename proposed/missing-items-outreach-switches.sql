-- Missing-Items Outreach: switches. RUN ONLY WITH DOLMAR'S APPROVAL.
-- Preferred path: Back Office -> Automations (Owner) toggles the same keys.
-- Prerequisite: supabase/migrations/20261116040000_missing_items_outreach.sql
-- applied and the site published.

-- A) One-time message to existing applicants: turn ON, run the FLEET backfill
--    (POST /api/public/fleet/missing-items {"action":"backfill","confirm":"send-once"})
--    until eligible = 0, then turn it OFF again (section C).
INSERT INTO public.app_settings (key, value)
VALUES ('automation_controls', jsonb_build_object('off', '{}'::jsonb, 'on', '{}'::jsonb))
ON CONFLICT (key) DO NOTHING;
UPDATE public.app_settings
SET value = jsonb_set(coalesce(value, '{}'::jsonb), '{on}',
  coalesce(value->'on', '{}'::jsonb) || jsonb_build_object('missing_items_backfill', jsonb_build_object('at', now(), 'by', null)))
WHERE key = 'automation_controls';

-- B) Ongoing follow-up (every 5 minutes, 9 AM-8 PM ET): turn ON.
UPDATE public.app_settings
SET value = jsonb_set(coalesce(value, '{}'::jsonb), '{on}',
  coalesce(value->'on', '{}'::jsonb) || jsonb_build_object('missing_items_outreach', jsonb_build_object('at', now(), 'by', null)))
WHERE key = 'automation_controls';

-- C) Turn the one-time switch back OFF after the backfill.
UPDATE public.app_settings
SET value = jsonb_set(value, '{on}', coalesce(value->'on', '{}'::jsonb) - 'missing_items_backfill')
WHERE key = 'automation_controls';
