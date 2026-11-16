-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- agreement_terms_confirmations: the record of an applicant confirming the
-- rental terms (on a call or by text) before FLEET sends the agreement through
-- POST /api/public/fleet/send-agreement (src/lib/fleet-agreement.server.ts).
-- The endpoint stores this row first and sends nothing without it.
-- Written only by the server (service role). Staff can read.
-- Additive. Sends nothing by itself. Rollback at the bottom.
BEGIN;
CREATE TABLE IF NOT EXISTS public.agreement_terms_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL,
  channel text NOT NULL CHECK (channel IN ('call', 'sms')),
  call_id text CHECK (call_id IS NULL OR length(call_id) <= 120),
  message_id text CHECK (message_id IS NULL OR length(message_id) <= 120),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 10 AND 2000),
  weekly_rate numeric(10,2) NOT NULL CHECK (weekly_rate > 0),
  deposit numeric(10,2) NOT NULL CHECK (deposit >= 0),
  start_date date NOT NULL,
  vehicle_id uuid NOT NULL,
  vehicle_label text,
  recorded_by text NOT NULL,
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 120),
  agreement_id uuid,
  agreement_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_terms_confirmations_ref CHECK (
    (channel = 'call' AND call_id IS NOT NULL) OR (channel = 'sms' AND message_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agreement_terms_confirmations_application_idx
  ON public.agreement_terms_confirmations (application_id, created_at DESC);

ALTER TABLE public.agreement_terms_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read agreement terms confirmations" ON public.agreement_terms_confirmations;
CREATE POLICY "Staff read agreement terms confirmations" ON public.agreement_terms_confirmations
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.agreement_terms_confirmations FROM anon;
COMMIT;

-- Rollback (after the endpoint is reverted; until then it answers 503 and sends nothing):
-- DROP TABLE IF EXISTS public.agreement_terms_confirmations;
