-- Fleet tweaks (Dolmar, Nov 15, 2026). Run after the migration
-- supabase/migrations/20261116030000_license_front_only.sql.
-- Pickup slots back to 09:30 / 10:30 / 11:30 ET. Only startTimes changes and
-- blockedDates is added (empty: the built-in holidays live in code). Every
-- other field, including notify.enabled, is kept as stored.
UPDATE public.app_settings
   SET value = jsonb_set(value, '{startTimes}', '["09:30","10:30","11:30"]'::jsonb)
             || CASE WHEN value ? 'blockedDates' THEN '{}'::jsonb ELSE '{"blockedDates": []}'::jsonb END,
       updated_at = now()
 WHERE key = 'pickup_schedule';
