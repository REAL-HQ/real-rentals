-- PROPOSED, NOT APPLIED. Needs Dolmar's approval (including the renter wording
-- in docs/late-pickup.md), after the code is published and
-- proposed/renter-reminders-v1.sql has been run (claim table + 5-minute job).
-- Turns on "Late Pickup Release" (src/lib/late-pickup.server.ts). Preferred:
-- switch it on in Back Office -> Automations (records who turned it on). This
-- is the same change in SQL.
-- Undo: switch it off in Back Office -> Automations.
INSERT INTO public.app_settings (key, value)
VALUES ('automation_controls', jsonb_build_object('off', '{}'::jsonb, 'on',
  jsonb_build_object('late_pickup_release', jsonb_build_object('at', now()::text, 'by', 'sql'))))
ON CONFLICT (key) DO UPDATE SET value = jsonb_set(
  public.app_settings.value, '{on}',
  COALESCE(public.app_settings.value->'on', '{}'::jsonb)
    || jsonb_build_object('late_pickup_release', jsonb_build_object('at', now()::text, 'by', 'sql')));
