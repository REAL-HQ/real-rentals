-- PREPARED, NOT RUN. Optional; needs Dolmar's approval.
-- Records the rent weeks already paid through Stripe as payments rows, so the
-- ledger and Active Rentals show history. Read from Stripe live on 11/9/2026
-- (paid invoices, $0 proration invoices left out). Times are ET.
-- Sends nothing: no email or SMS code runs from SQL, and notified_status =
-- 'paid' marks each row as already noticed in case a Stripe event replays.
-- Skips any invoice already in payments, so a second run inserts nothing.
--
-- Damon   in_1UQwOfGsNNO50lXbRNtfEOYZ  10/15 5:41 PM  (old sub_1UQwOj…, canceled)
--         in_1UU4klGsNNO50lXbuMnHu2Hv  10/24 9:12 AM  (old sub_1UU4kq…)
--         in_1UWam5GsNNO50lXbKlTt7mPz  10/31 7:48 AM  (current sub_1UWam8…)
-- Regina  in_1URZk3GsNNO50lXb0Jsh1lYP  10/17 11:41 AM
--         in_1UUq28GsNNO50lXbpMdhhXuG  due 10/26, paid 10/28 8:50 AM
--         in_1UXNN0GsNNO50lXblTIg15zP  due 11/2, paid 11/4 6:22 PM
-- Schrita in_1UXN6XGsNNO50lXbxWJRkB9b  11/2 10:25 AM (old sub_1UXN6d…, canceled)
--         in_1UZwGMGsNNO50lXbGIh5KjHV  11/9 12:21 PM (current sub_1UZwGP…)
BEGIN;
WITH src(rental_id, invoice_id, subscription_id, amount, due_date, paid_date) AS (
  VALUES
  ('83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, 'in_1UQwOfGsNNO50lXbRNtfEOYZ', 'sub_1UQwOjGsNNO50lXbq8y8hkVs', 350.00, '2026-10-15'::date, '2026-10-15'::date),
  ('83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, 'in_1UU4klGsNNO50lXbuMnHu2Hv', 'sub_1UU4kqGsNNO50lXb9QkjfqsU', 350.00, '2026-10-24', '2026-10-24'),
  ('83668a8d-1868-45c5-bb20-38f54491ab6c'::uuid, 'in_1UWam5GsNNO50lXbKlTt7mPz', 'sub_1UWam8GsNNO50lXbvvIo4ZQI', 350.00, '2026-10-31', '2026-10-31'),
  ('d8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, 'in_1URZk3GsNNO50lXb0Jsh1lYP', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 350.00, '2026-10-17', '2026-10-17'),
  ('d8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, 'in_1UUq28GsNNO50lXbpMdhhXuG', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 350.00, '2026-10-26', '2026-10-28'),
  ('d8fbb519-db84-4b33-8669-7c62474d6bfd'::uuid, 'in_1UXNN0GsNNO50lXblTIg15zP', 'sub_1URZk6GsNNO50lXbXuQV3lAH', 350.00, '2026-11-02', '2026-11-04'),
  ('49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid, 'in_1UXN6XGsNNO50lXbxWJRkB9b', 'sub_1UXN6dGsNNO50lXbRQy4GIOC', 350.00, '2026-11-02', '2026-11-02'),
  ('49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'::uuid, 'in_1UZwGMGsNNO50lXbGIh5KjHV', 'sub_1UZwGPGsNNO50lXbRCnRl4Yl', 350.00, '2026-11-09', '2026-11-09')
)
INSERT INTO public.payments (type, status, amount, due_date, paid_date, payment_method, balance_due, notes,
                             rental_id, driver_id, vehicle_id, stripe_invoice_id, stripe_subscription_id, notified_status)
SELECT 'rent', 'paid', s.amount, s.due_date, s.paid_date, 'card', 0, 'Backfilled from Stripe 11/9/2026',
       r.id, r.application_id, r.vehicle_id, s.invoice_id, s.subscription_id, 'paid'
FROM src s JOIN public.rentals r ON r.id = s.rental_id
WHERE NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.stripe_invoice_id = s.invoice_id);

SELECT r.id AS rental_id, p.stripe_invoice_id, p.amount, p.due_date, p.paid_date, p.status
FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
WHERE p.notes = 'Backfilled from Stripe 11/9/2026' ORDER BY r.id, p.due_date;
COMMIT;
