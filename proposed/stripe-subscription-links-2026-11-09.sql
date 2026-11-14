-- PREPARED, NOT RUN. Needs Dolmar's approval.
-- Links the three active rentals to the Stripe customer and subscription that
-- is actually billing them (read from Stripe live on 11/9/2026), so the
-- payments webhook can match their invoices. Changes only these two columns
-- (plus autopay_active) on three rentals. No rent rows, no dates.
-- Schrita: sub_1UXN6dGsNNO50lXbRQy4GIOC was cancelled 11/9 1:28 PM ET (duplicate);
-- sub_1UZwGPGsNNO50lXbRCnRl4Yl is the live one.
BEGIN;
UPDATE public.rentals SET stripe_customer_id = 'cus_VXg511exteJySE', stripe_subscription_id = 'sub_1UWam8GsNNO50lXbvvIo4ZQI', autopay_active = true
 WHERE id = '83668a8d-1868-45c5-bb20-38f54491ab6c' AND status = 'active' AND stripe_subscription_id IS NULL;  -- Damon
UPDATE public.rentals SET stripe_customer_id = 'cus_VSUjRxg343D7Yk', stripe_subscription_id = 'sub_1URZk6GsNNO50lXbXuQV3lAH', autopay_active = true
 WHERE id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' AND status = 'active' AND stripe_subscription_id IS NULL;  -- Regina
UPDATE public.rentals SET stripe_customer_id = 'cus_Vb8XvqNW6d4IcX', stripe_subscription_id = 'sub_1UZwGPGsNNO50lXbRCnRl4Yl', autopay_active = true
 WHERE id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af' AND status = 'active' AND stripe_subscription_id IS NULL;  -- Schrita
SELECT id, stripe_customer_id, stripe_subscription_id, autopay_active FROM public.rentals WHERE status = 'active';
COMMIT;
