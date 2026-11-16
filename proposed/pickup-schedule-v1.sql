-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
-- Run after proposed/fleet-applicant-review-v1.sql and
-- proposed/agreement-terms-confirmations-v1.sql.
--
-- Pickup schedule + reservation_confirmed (src/lib/pickup-schedule.ts,
-- src/lib/reservation-confirmation.server.ts, src/lib/fleet-pickup.server.ts).
--  1. One reserved booking per pickup slot (date + time), enforced in the DB
--     (the app also checks first). Production had 0 reserved rentals when this
--     was written, so no existing rows conflict.
--  2. reservation_confirmations: one row per rental once it is fully
--     confirmed; claims the staff text/email so it is sent at most once.
--  3. Allow the reservation_confirmed FLEET webhook event.
-- The schedule itself lives in app_settings key "pickup_schedule" (seeded
-- below; without a row the code uses the same defaults (Mon-Fri 09:00/10:00/11:00 ET, 60 minutes,
-- pickup at 3500 E Hillsborough Ave, Tampa, FL 33610, field rep Dolmar Cross,
-- alerts Off)). Nothing here sends anything.
BEGIN;

CREATE OR REPLACE FUNCTION private.reservation_pickup_time(note text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT substring(note FROM '"reservation_details":1.*"pickup_time":"([0-2][0-9]:[0-5][0-9])"')
$$;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_reserved_per_pickup_slot
  ON public.rentals (start_date, private.reservation_pickup_time(reservation_note))
  WHERE status = 'reserved' AND private.reservation_pickup_time(reservation_note) IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reservation_confirmations (
  rental_id uuid PRIMARY KEY REFERENCES public.rentals(id) ON DELETE CASCADE,
  application_id uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  notice_status text NOT NULL CHECK (notice_status IN ('off', 'sending', 'sent', 'partial')),
  sms_status text,
  email_status text,
  notified_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reservation_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read reservation confirmations" ON public.reservation_confirmations;
CREATE POLICY "Staff read reservation confirmations" ON public.reservation_confirmations
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.reservation_confirmations FROM anon;

ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created', 'stage_changed',
    'quo_message_received', 'quo_call', 'quo_voicemail', 'quo_transcript',
    'agreement_signed_by_renter',
    'application_ready_for_review',
    'reservation_confirmed'));

-- Seed the schedule with the defaults (alerts Off). Never overwrites a saved schedule.
INSERT INTO public.app_settings (key, value)
VALUES ('pickup_schedule', '{"days": [1, 2, 3, 4, 5], "startTimes": ["09:00", "10:00", "11:00"], "slotMinutes": 60, "minNoticeMinutes": 120, "horizonDays": 14, "timezone": "America/New_York", "defaultLocation": "3500 E Hillsborough Ave, Tampa, FL 33610", "fieldRep": {"name": "Dolmar Cross"}, "notify": {"enabled": false, "sms": ["+18134768508"], "emails": ["DolmarCross@gmail.com", "Team@DriveReal.com"], "requireSignedAgreement": true}}'::jsonb)
ON CONFLICT (key) DO NOTHING;
COMMIT;

-- Rollback:
-- DELETE FROM public.app_settings WHERE key = 'pickup_schedule';
-- DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'reservation_confirmed';
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check
--   CHECK (event_type IN ('lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript','agreement_signed_by_renter','application_ready_for_review'));
-- DROP TABLE IF EXISTS public.reservation_confirmations;
-- DROP INDEX IF EXISTS public.rentals_one_reserved_per_pickup_slot;
-- DROP FUNCTION IF EXISTS private.reservation_pickup_time(text);
