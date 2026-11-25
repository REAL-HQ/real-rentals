-- File only. Not applied by this change.
-- An offered Reservation Fee credit can expire. The row stays, so the same
-- fee cannot be offered again. A credit applied to a new fee (before a rental
-- exists) records applied_to_payment_id. A null expires_at is a kept
-- missed-pickup credit and is not expired by the job.

ALTER TABLE public.renter_credits
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_to_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

ALTER TABLE public.renter_credits DROP CONSTRAINT IF EXISTS renter_credits_status_check;
ALTER TABLE public.renter_credits ADD CONSTRAINT renter_credits_status_check
  CHECK (status IN ('available','applied','void','expired'));

ALTER TABLE public.renter_credits DROP CONSTRAINT IF EXISTS renter_credits_applied_needs_rental;
ALTER TABLE public.renter_credits ADD CONSTRAINT renter_credits_applied_needs_rental
  CHECK (status <> 'applied' OR applied_to_rental_id IS NOT NULL OR applied_to_payment_id IS NOT NULL);

COMMENT ON COLUMN public.renter_credits.expires_at IS 'When an offered Reservation Fee credit stops being usable. Null credits are not expired by the job.';
