-- Payment receipt and invoice links for the renter back-office Payments section.
-- PREPARED IN THIS PR ONLY. Do not apply to production without Dolmar's approval.
-- Additive: existing payment rows and reminder / late-fee logic are unchanged.
-- Unique indexes keep webhook + backfill inserts idempotent.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_invoice_number text,
  ADD COLUMN IF NOT EXISTS stripe_hosted_invoice_url text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS stripe_receipt_url text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_charge_id_uidx
  ON public.payments(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_stripe_customer_id_idx
  ON public.payments(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_driver_paid_idx
  ON public.payments(driver_id, paid_date DESC)
  WHERE driver_id IS NOT NULL;
