-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Adds 'reservation' to payments.type so a Reservation Fee can be stored as its
-- own type (Dolmar t505u, Nov 19 2026: "so we can quickly filter to find
-- reservations, rent, fees"). Until this runs, the app keeps writing
-- Reservation Fees as type 'fee' with reason 'reservation_fee', and the
-- Payments Type column/filter already reads those rows as Reservation
-- (src/lib/payment-category.ts), so nothing is blocked on this.
--
-- After applying: flip RESERVATION_ROW_TYPE to "reservation" in
-- src/lib/payment-category.ts in the same release. Revenue sets already include
-- 'reservation'.

BEGIN;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_type_check
  CHECK (type = ANY (ARRAY['rent','deposit','late_fee','toll','damage','fee','other','reservation']::text[]));

-- Backfill: every Reservation Fee row stored as 'fee'.
-- Backup first:
--   SELECT id, type, reason, notes, amount, status FROM public.payments
--   WHERE type = 'fee' AND (reason = 'reservation_fee' OR notes LIKE 'reservation_fee:%');
UPDATE public.payments
   SET type = 'reservation', updated_at = now()
 WHERE type = 'fee'
   AND (reason = 'reservation_fee' OR notes LIKE 'reservation_fee:%');

COMMIT;

-- Rollback:
-- BEGIN;
-- UPDATE public.payments SET type = 'fee' WHERE type = 'reservation';
-- ALTER TABLE public.payments DROP CONSTRAINT payments_type_check;
-- ALTER TABLE public.payments ADD CONSTRAINT payments_type_check
--   CHECK (type = ANY (ARRAY['rent','deposit','late_fee','toll','damage','fee','other']::text[]));
-- COMMIT;
