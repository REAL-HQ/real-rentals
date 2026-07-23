
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id text,
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS card_exp_month int,
  ADD COLUMN IF NOT EXISTS card_exp_year int,
  ADD COLUMN IF NOT EXISTS card_on_file_at timestamptz,
  ADD COLUMN IF NOT EXISTS autopay_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'current';

CREATE UNIQUE INDEX IF NOT EXISTS rentals_stripe_subscription_id_key
  ON public.rentals(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_intent_id_key
  ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_id_key
  ON public.payments(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_rental_id_idx ON public.payments(rental_id);

CREATE UNIQUE INDEX IF NOT EXISTS applications_stripe_customer_id_key
  ON public.applications(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
