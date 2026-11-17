-- Follow-up to staff-terms-confirmations-v1.sql (applied Nov 17, 2026 10:33 AM ET).
-- Dolmar, Nov 17 10:36 AM: the Confirm Terms dialog has both "Reservation ($)"
-- (the Reservation Fee the agreement prints and signing charges, applied to
-- week 1) and "Deposit ($)" (security deposit, 0 today, kept for the future).
-- Stores the Reservation Fee on the Move Forward row; terms_key now includes
-- it (the table had no rows when this was written). Additive, re-runnable.
BEGIN;
ALTER TABLE public.staff_terms_confirmations
  ADD COLUMN IF NOT EXISTS reservation_fee numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.staff_terms_confirmations
  DROP CONSTRAINT IF EXISTS staff_terms_confirmations_reservation_fee_check;
ALTER TABLE public.staff_terms_confirmations
  ADD CONSTRAINT staff_terms_confirmations_reservation_fee_check CHECK (reservation_fee >= 0 AND reservation_fee <= 10000);
COMMIT;

-- Rollback (after reverting the code that reads reservation_fee):
-- ALTER TABLE public.staff_terms_confirmations DROP CONSTRAINT IF EXISTS staff_terms_confirmations_reservation_fee_check;
-- ALTER TABLE public.staff_terms_confirmations DROP COLUMN IF EXISTS reservation_fee;
