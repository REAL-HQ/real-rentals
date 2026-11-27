-- PROPOSED, NOT APPLIED. Turns on "Waitlist Joined Notice" (email + SMS with
-- consent, 8 AM–9 PM ET). Preferred: switch it on in Back Office -> Automations
-- (records who turned it on). This is the same change in SQL.
-- Undo: switch it off in Back Office -> Automations.
INSERT INTO public.app_settings (key, value)
VALUES ('automation_controls', jsonb_build_object('off', '{}'::jsonb, 'on',
  jsonb_build_object('waitlist_joined_notice', jsonb_build_object('at', now()::text, 'by', 'sql'))))
ON CONFLICT (key) DO UPDATE SET value = jsonb_set(
  public.app_settings.value, '{on}',
  COALESCE(public.app_settings.value->'on', '{}'::jsonb)
    || jsonb_build_object('waitlist_joined_notice', jsonb_build_object('at', now()::text, 'by', 'sql')));
