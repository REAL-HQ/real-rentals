-- Unmatched Stripe payments: a succeeded charge or invoice that could not be
-- tied to exactly one active rental. Staff review the row in Payments and
-- either assign it (one payments row, oldest unpaid period) or dismiss it.
--
-- This migration adds:
--   public.unmatched_stripe_payments
--     id uuid primary key
--     stripe_payment_intent_id text, unique when set
--     stripe_invoice_id text, unique when set
--     stripe_charge_id text, unique when set
--     stripe_customer_id text
--     amount_cents integer, currency text
--     renter_name text, email text
--     why text: no_match | ambiguous
--     status text: open | assigned | dismissed
--     rental_id, payment_id (set when assigned)
--     note (dismiss reason)
--     assigned_by, dismissed_by, created_at, updated_at
--   At least one of payment intent, invoice or charge id is required.
--   Phone numbers are not stored.
--   RLS: Managers may SELECT. Inserts and updates are service-role only
--   (the webhook, the nightly reconciliation and the assign/dismiss server
--   functions). No cron job is added. The nightly check rides the existing
--   ops-reminders job and stays off until an Owner turns on Automations →
--   Stripe Charge Reconciliation and Team Alerts → Stripe Payment Gap.
--
-- DO NOT apply to production until this PR is reviewed.

CREATE TABLE IF NOT EXISTS public.unmatched_stripe_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  stripe_charge_id text,
  stripe_customer_id text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  renter_name text,
  email text,
  why text NOT NULL CHECK (why IN ('no_match', 'ambiguous')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'dismissed')),
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  note text,
  assigned_by uuid,
  dismissed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unmatched_stripe_payments_ref_chk CHECK (
    stripe_payment_intent_id IS NOT NULL
    OR stripe_invoice_id IS NOT NULL
    OR stripe_charge_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS unmatched_stripe_payments_intent_idx
  ON public.unmatched_stripe_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unmatched_stripe_payments_invoice_idx
  ON public.unmatched_stripe_payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unmatched_stripe_payments_charge_idx
  ON public.unmatched_stripe_payments (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unmatched_stripe_payments_open_idx
  ON public.unmatched_stripe_payments (status, created_at);

ALTER TABLE public.unmatched_stripe_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.unmatched_stripe_payments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.unmatched_stripe_payments FROM anon, authenticated;

DROP POLICY IF EXISTS "Managers read unmatched stripe payments" ON public.unmatched_stripe_payments;
CREATE POLICY "Managers read unmatched stripe payments"
  ON public.unmatched_stripe_payments
  FOR SELECT TO authenticated
  USING (private.is_manager());

COMMENT ON TABLE public.unmatched_stripe_payments IS
  'Succeeded Stripe charges with no single active rental. Staff assign or dismiss. No phone numbers.';
