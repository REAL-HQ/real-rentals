-- PROPOSED, NOT APPLIED. Turns ON automatic activation from the pickup
-- checklist. Run only after proposed/pickup-handovers-v1.sql and Dolmar's OK.
--
-- With this on, a Manager or Owner who completes the pickup checklist (photo
-- of renter holding license, odometer, fuel, renter signature) starts the
-- rental and billing through the normal Activate Rental path when the
-- agreement is signed, a card is on file and the reservation fee is paid (or
-- none was required). Any other activation blocker still stops it.
--
-- override_no_interview / override_no_passed_inspection: the checklist stands
-- in for "interview not recorded" and "no passed pre-delivery inspection".
-- Each use is written to the rental.activated audit entry as an override with
-- the reason "Pickup checklist completed by <rep> ...". Set either to false
-- to keep requiring it.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('pickup_auto_activate', '{"enabled": true, "override_no_interview": true, "override_no_passed_inspection": true}'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Rollback (off):
--   UPDATE public.app_settings SET value = '{"enabled": false}'::jsonb, updated_at = now() WHERE key = 'pickup_auto_activate';
