-- PROPOSED, NOT APPLIED. Needs Dolmar's OK. Requires staff-text-pause-v1.sql first.
--
-- 1) Tuning for the staff-text bot pause. The pause only starts once the site
--    can tell a person's Quo text from FLEET's. Fill in the Quo user ids
--    (they start with "US"; Quo → Settings → Members, or GET /v1/users):
--      staff_user_ids: people on the team who text from the 888 / 813 lines;
--      bot_user_ids:   the Quo user FLEET sends as (its API senderUserId).
--    With neither list filled in, nothing pauses even with the switch On.
INSERT INTO public.app_settings (key, value)
VALUES ('staff_text_pause', jsonb_build_object(
  'hours', 48,
  'staff_user_ids', jsonb_build_array(),   -- e.g. 'USxxxxxxxx'
  'bot_user_ids', jsonb_build_array(),     -- e.g. 'USyyyyyyyy' (FLEET)
  'approved_by', 'Dolmar Cross', 'approved_at', now()))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2) The switch itself is Back Office → Automations → "Pause Bots When Staff
--    Text" (automation key staff_text_pause, Off by default). Turn it on there
--    (an Owner toggle, audited), not with SQL.
--
-- Off again: turn the switch Off. Existing pauses still run out on their own
-- (or staff click Resume Bots); to end them all at once:
--   UPDATE public.bot_text_pauses SET cleared_at = now(), cleared_by = 'rollback' WHERE cleared_at IS NULL;
