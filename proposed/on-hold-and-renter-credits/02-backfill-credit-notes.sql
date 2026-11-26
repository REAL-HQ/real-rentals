-- PROPOSED ONLY. Run after the migration is approved and applied. Not run.
-- Payments whose notes say credit:next_rental get a renter_credits row (available).
-- Idempotent: the unique index renter_credits_one_live_per_payment_idx plus NOT EXISTS.
-- Back up first: create table _backup_<date>_renter_credits_backfill as select * from payments where notes ~ 'credit:next_rental';
INSERT INTO public.renter_credits (application_id, source_payment_id, source_rental_id, amount, reason, status)
SELECT p.driver_id,
       p.id,
       NULLIF(substring(p.notes from 'credit:next_rental:([0-9a-f-]{36})'), '')::uuid,
       (p.amount - COALESCE(p.refunded_amount, 0)),
       'Reservation Fee Credit Toward Next Rental',
       'available'
FROM public.payments p
WHERE p.notes ~ 'credit:next_rental'
  AND p.reason = 'reservation_fee'
  AND p.status = 'paid'
  AND p.notes !~ 'credited_week1'
  AND (p.amount - COALESCE(p.refunded_amount, 0)) > 0
  AND p.driver_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.renter_credits c WHERE c.source_payment_id = p.id AND c.status <> 'void');
-- Expected today: one row, payment 03733dbe-a9c1-4eaf-9f42-2c04e386945a (Jonathon Boykins), $50.00.
