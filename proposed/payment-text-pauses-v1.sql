-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Payment text pauses: hold the app's automatic payment texts and emails to one
-- renter until a date (a payment deal). Written by staff or by FLEET through
-- POST /api/public/fleet/payment-text-pause (Bearer FLEET_API_KEY). Read by the
-- rent-reminders job, the Payment Failed Text and the Stripe failed-payment email.
-- Additive. Sends nothing. Rollback at the bottom.
BEGIN;
CREATE TABLE IF NOT EXISTS public.payment_text_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  pause_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'fleet')),
  created_by text NOT NULL,
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 120),
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_text_pauses_window CHECK (pause_until > starts_at AND pause_until <= starts_at + interval '45 days')
);
CREATE INDEX IF NOT EXISTS payment_text_pauses_active_idx
  ON public.payment_text_pauses (rental_id, pause_until) WHERE cancelled_at IS NULL;

ALTER TABLE public.payment_text_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read payment text pauses" ON public.payment_text_pauses;
CREATE POLICY "Staff read payment text pauses" ON public.payment_text_pauses
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.payment_text_pauses FROM anon;
COMMIT;

-- Rollback (after the code that reads it is reverted; until then the code treats a missing table as "not paused"):
-- DROP TABLE IF EXISTS public.payment_text_pauses;
