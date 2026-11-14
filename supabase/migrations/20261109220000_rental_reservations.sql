-- Soft holds for cars reserved for an applicant/renter before Activate.
-- Inserts with status = 'reserved' are already allowed by guard_rental_lifecycle
-- (only status = 'active' is blocked on INSERT). Starting a rental still goes
-- through activate_rental_tx / activate_rental_checked_tx — never mark anyone
-- insured or verified from this path.
--
-- Optional reservation deposit (Off by default via app_settings). Staff can
-- Record Deposit manually; Stripe deposit charging is a future hook only.
--
-- DO NOT apply to production until Dolmar approves publishing this PR.

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS reservation_note text,
  ADD COLUMN IF NOT EXISTS reservation_deposit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservation_deposit_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_deposit_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reservation_deposit_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.rentals.reservation_note IS
  'Optional staff note on a reserved (not yet active) rental.';
COMMENT ON COLUMN public.rentals.reservation_deposit_required IS
  'Whether this reservation expects a deposit before or at pickup.';
COMMENT ON COLUMN public.rentals.reservation_deposit_amount IS
  'Deposit amount asked for this reservation. Zero when not required.';
COMMENT ON COLUMN public.rentals.reservation_deposit_status IS
  'not_required | pending | paid | waived | refunded | applied';
COMMENT ON COLUMN public.rentals.reservation_deposit_payment_id IS
  'payments.id for the recorded reservation deposit, when paid.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rentals_reservation_deposit_status_chk'
  ) THEN
    ALTER TABLE public.rentals
      ADD CONSTRAINT rentals_reservation_deposit_status_chk
      CHECK (reservation_deposit_status = ANY (ARRAY[
        'not_required','pending','paid','waived','refunded','applied'
      ]));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_reserved_per_vehicle_idx
  ON public.rentals (vehicle_id)
  WHERE status = 'reserved';

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_reserved_per_driver_idx
  ON public.rentals (driver_id)
  WHERE status = 'reserved';

-- Global defaults. Missing row = deposit Off, amount 0, do not block Start Rental.
INSERT INTO public.app_settings (key, value)
VALUES (
  'reservation_deposit',
  '{"enabled":false,"default_amount":0,"block_start_when_pending":false}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
