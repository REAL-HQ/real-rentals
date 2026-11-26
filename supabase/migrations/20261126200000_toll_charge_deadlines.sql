-- NOT APPLIED. This file is included for review only. Do not run it as part of
-- this change. Until it is applied, charge writes omit these columns and the
-- Charges screen treats the dates as blank.
--
-- Agency due date, the renter Pay By date, escalation, and the Stripe Payment
-- Link that collected the charge. All additive. Existing RLS policies and
-- grants are left as they are.

ALTER TABLE public.toll_charges
  ADD COLUMN IF NOT EXISTS agency_due_date date,
  ADD COLUMN IF NOT EXISTS renter_pay_by date,
  ADD COLUMN IF NOT EXISTS escalation text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_payment_link_id text;

ALTER TABLE public.toll_charges DROP CONSTRAINT IF EXISTS toll_charges_escalation_check;
ALTER TABLE public.toll_charges ADD CONSTRAINT toll_charges_escalation_check
  CHECK (escalation IN ('none', 'disputed', 'affidavit_filed', 'transferred'));

COMMENT ON COLUMN public.toll_charges.agency_due_date IS
  'The date the issuing agency says the notice must be paid.';
COMMENT ON COLUMN public.toll_charges.renter_pay_by IS
  'The date the renter is asked to pay. Defaults to agency_due_date minus 7 days and can be edited per charge.';
COMMENT ON COLUMN public.toll_charges.escalation IS
  'none | disputed | affidavit_filed | transferred';
COMMENT ON COLUMN public.toll_charges.escalated_at IS
  'When escalation was last set to something other than none.';
COMMENT ON COLUMN public.toll_charges.stripe_payment_link_id IS
  'Stripe Payment Link id (plink_...) when this charge was collected by a hand-made link.';

CREATE INDEX IF NOT EXISTS toll_charges_payment_link_idx
  ON public.toll_charges (stripe_payment_link_id)
  WHERE stripe_payment_link_id IS NOT NULL AND stripe_payment_link_id <> '';

CREATE INDEX IF NOT EXISTS toll_charges_pay_by_idx
  ON public.toll_charges (renter_pay_by)
  WHERE renter_pay_by IS NOT NULL;
