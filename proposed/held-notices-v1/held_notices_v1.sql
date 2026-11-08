-- Staged only. NOT applied. Owner approval required.
--
-- A small retry list for renter/team payment notices that were HELD because
-- the Back Office → Automations switches could not be read. References only:
-- which notice, which Stripe object, which payment rows. No email address, no
-- message body. The 5-minute automations cron re-checks everything from the
-- live rows before it sends, at most once per (kind, source_ref).
CREATE TABLE IF NOT EXISTS public.held_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('payment_receipt','payment_failed','card_expiring','payment_team_alert')),
  source_ref text NOT NULL,              -- Stripe payment_intent or invoice id
  rental_id uuid,
  payment_ids uuid[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL CHECK (outcome IN ('paid','failed')),
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','sending','sent','dropped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, source_ref)
);
CREATE INDEX IF NOT EXISTS held_notices_open ON public.held_notices (created_at) WHERE status IN ('held','sending');
ALTER TABLE public.held_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.held_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.held_notices TO service_role;
