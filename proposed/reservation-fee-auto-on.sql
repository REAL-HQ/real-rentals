-- PROPOSED, NOT APPLIED. Needs Dolmar's approval, after the code is published.
-- Turns on the $50 Reservation Fee (src/lib/reservation-fee.server.ts, t299s1618, t309u):
--   * FLEET's agreements record a Required $50 Reservation Fee;
--   * the card is collected only AFTER signing (t309u): Stripe Checkout takes the
--     $50 and saves that card on file for the rental balance (a card already on
--     file is charged); only when the signed agreement text prints a Reservation Fee;
--   * the Reservation Fee is never called a deposit (it is applied to rent);
--   * the car is held only once it is paid (FLEET cannot book the pickup before);
--   * at activation it is credited to week 1 (Stripe customer balance credit);
--   * kept if the renter is 30+ minutes late and the car is released
--     (separate switch "Late Pickup Release" in Back Office -> Automations).
-- BEFORE RUNNING: the agreement template in use must print the Reservation Fee
-- (today there is no saved template, and the built-in text does not), or no fee
-- is ever charged.
-- Undo: UPDATE public.app_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'reservation_fee_auto';
INSERT INTO public.app_settings (key, value)
VALUES ('reservation_fee_auto', '{"enabled": true, "amount": 50}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
