-- PROPOSED, NOT APPLIED. Run only with Dolmar's approval, after
-- proposed/pickup-schedule-v1.sql and after PR373 is published.
--
-- Turns ON the confirmed-reservation alerts (Settings -> Rental Terms ->
-- Pickup Schedule): one text from the main business line to +18134768508 and
-- one email to DolmarCross@gmail.com and Team@DriveReal.com per fully
-- confirmed reservation. Only flips notify.enabled; every other saved field
-- (slots, location, field rep, recipients) is kept.
BEGIN;
INSERT INTO public.app_settings (key, value)
VALUES ('pickup_schedule', '{"days": [1, 2, 3, 4, 5], "startTimes": ["09:30", "10:30", "11:30"], "slotMinutes": 60, "minNoticeMinutes": 120, "horizonDays": 14, "timezone": "America/New_York", "defaultLocation": "3500 E Hillsborough Ave, Tampa, FL 33610", "fieldRep": {"name": "Dolmar Cross"}, "notify": {"enabled": true, "sms": ["+18134768508"], "emails": ["DolmarCross@gmail.com", "Team@DriveReal.com"], "requireSignedAgreement": true}, "blockedDates": []}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = jsonb_set(public.app_settings.value, '{notify,enabled}', 'true'::jsonb, true),
      updated_at = now();
COMMIT;

-- Check:
-- SELECT value->'notify' FROM public.app_settings WHERE key = 'pickup_schedule';
-- Turn off again:
-- UPDATE public.app_settings SET value = jsonb_set(value, '{notify,enabled}', 'false'::jsonb), updated_at = now() WHERE key = 'pickup_schedule';
