-- On Hold rentals and renter credits (Reservation Fee kept as a credit).
-- DO NOT apply to production until Dolmar approves.
--
-- 1. rentals.status gets a new value, 'on_hold' (no CHECK constraint exists on status;
--    guard_rental_lifecycle only guards moves to or from 'active', so Reserved <-> On Hold is allowed).
--    The three columns record why and when. The vehicle stays held: the new partial unique
--    index keeps one On Hold rental per vehicle, and the existing rentals_one_reserved_* indexes
--    still guard Resume (On Hold -> Reserved).
-- 2. renter_credits: one row per credit; source payment, amount, reason, status.

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS hold_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_by uuid;

COMMENT ON COLUMN public.rentals.hold_reason IS 'Why a rental is On Hold (status = on_hold). Cleared on Resume.';

CREATE UNIQUE INDEX IF NOT EXISTS rentals_one_on_hold_per_vehicle_idx
  ON public.rentals (vehicle_id) WHERE status = 'on_hold';

CREATE TABLE IF NOT EXISTS public.renter_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  source_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  source_rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','applied','void')),
  applied_to_rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  applied_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renter_credits_applied_needs_rental CHECK (status <> 'applied' OR applied_to_rental_id IS NOT NULL)
);

-- One live credit per source payment, so a fee can never be credited twice.
CREATE UNIQUE INDEX IF NOT EXISTS renter_credits_one_live_per_payment_idx
  ON public.renter_credits (source_payment_id) WHERE source_payment_id IS NOT NULL AND status <> 'void';
CREATE INDEX IF NOT EXISTS renter_credits_application_idx ON public.renter_credits (application_id, status);

GRANT SELECT, INSERT, UPDATE ON public.renter_credits TO authenticated;
GRANT ALL ON public.renter_credits TO service_role;
ALTER TABLE public.renter_credits ENABLE ROW LEVEL SECURITY;

-- Staff read and change credits. Renters never see this table (no driver policy).
CREATE POLICY "Staff manage renter credits" ON public.renter_credits
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE TRIGGER renter_credits_set_updated_at BEFORE UPDATE ON public.renter_credits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
