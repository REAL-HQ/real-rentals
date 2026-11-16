-- Turns on the $50 Reservation Fee (src/lib/reservation-fee.server.ts; Dolmar t299s1618,
-- t309u, card t315s1710, t319u). Apply only with Dolmar's approval, after the code is published.
--   * every new agreement (staff and FLEET) is the Owner-approved v1.14
--     (agreement-library "insurance_included"), which prints the Reservation Fee row
--     ($50.00) and the Balance Due after the fee;
--   * the card is collected only AFTER signing: the renter always gets the Stripe
--     Checkout link (a card already saved from an earlier rental is never charged
--     automatically); Checkout takes the $50 and saves that card on file for the
--     rental balance;
--   * the Reservation Fee is never called a deposit (it is applied in full to week 1);
--   * the car is held only once it is paid (FLEET cannot book the pickup before);
--   * at activation it is credited to week 1 (Stripe customer balance credit);
--   * kept if the renter is 30+ minutes late and the car is released
--     (separate switch "Late Pickup Release" in Back Office -> Automations);
--   * updated agreements for a rental already running use reservation mode
--     "not_applicable": the row prints "Not Applicable" and nothing is charged;
--   * agreements signed before this switch are never changed or charged.
-- Undo: DELETE FROM public.app_settings WHERE key = 'reservation_fee_auto';
--   (or keep the row: UPDATE public.app_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'reservation_fee_auto';)
INSERT INTO public.app_settings (key, value)
VALUES ('reservation_fee_auto', '{"enabled": true, "amount": 50}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
