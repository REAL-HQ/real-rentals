-- =============================================================================
-- Renter reimbursements
--
-- Money the business pays BACK to a renter: lost gig revenue while their car
-- was down, an out-of-pocket cost they covered for us, an overpayment. Until
-- now the only place to write these down was vehicle_expenses, which made them
-- look like a cost of owning a particular car and hid who was paid.
--
-- One row = one payment to one renter. The renter is the application (the
-- same id payments.driver_id holds); rental and vehicle are optional context.
-- Nothing here sends email or SMS, touches rent rows, or changes a rental.
--
-- Money, so Managers only (private.is_manager()), like vehicle_expenses.
-- Receipts reuse the private `receipts` bucket and its Manager-only policy.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.renter_reimbursements (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  paid_on date NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  method text NOT NULL CHECK (method IN ('zelle', 'cash_app', 'cash', 'check', 'venmo', 'paypal', 'card', 'other')),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  reason text NOT NULL CHECK (reason IN ('lost_revenue', 'out_of_pocket', 'overpayment', 'goodwill', 'other')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  receipt_path text,
  receipt_name text,
  receipt_mime text,
  -- Set only when a row was moved here from vehicle_expenses, so the one-time
  -- catalog step can never copy the same expense twice.
  source_expense_id uuid UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS renter_reimbursements_app_idx    ON public.renter_reimbursements (application_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS renter_reimbursements_paid_idx   ON public.renter_reimbursements (paid_on DESC);
CREATE INDEX IF NOT EXISTS renter_reimbursements_rental_idx ON public.renter_reimbursements (rental_id) WHERE rental_id IS NOT NULL;

COMMENT ON TABLE public.renter_reimbursements IS
  'Payments made back to renters (lost revenue, out-of-pocket, overpayment). Not rent, not a vehicle expense.';

ALTER TABLE public.renter_reimbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers manage renter reimbursements" ON public.renter_reimbursements;
CREATE POLICY "Managers manage renter reimbursements" ON public.renter_reimbursements
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

REVOKE ALL ON public.renter_reimbursements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.renter_reimbursements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.renter_reimbursements TO service_role;

CREATE OR REPLACE FUNCTION public.touch_renter_reimbursement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS renter_reimbursements_touch ON public.renter_reimbursements;
CREATE TRIGGER renter_reimbursements_touch
  BEFORE UPDATE ON public.renter_reimbursements
  FOR EACH ROW EXECUTE FUNCTION public.touch_renter_reimbursement();
