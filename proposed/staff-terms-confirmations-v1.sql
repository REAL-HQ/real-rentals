-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Staff "Move Forward" (Terms Confirmed row on the applicant's Next Step card).
-- Rosa or another manager calls an approved applicant, goes over the terms,
-- and clicks Move Forward. The server stores one staff_terms_confirmations
-- row per applicant and term set (a double click returns the same row) and
-- queues the FLEET webhook applicant_ready_for_agreement. FLEET then calls
-- POST /api/public/fleet/send-agreement with
--   terms_confirmation: { channel: "staff", staff_event_id: <this row's id> }.
--
--   1. public.staff_terms_confirmations (new, server-written, staff read).
--   2. fleet_webhook_deliveries: allow event applicant_ready_for_agreement
--      (keeps every event allowed on prod, checked Nov 17, 2026).
--   3. agreement_terms_confirmations: channel 'staff' + staff_event_id.
-- Additive. Sends nothing by itself. Re-runnable. Rollback at the bottom.
BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_terms_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  terms_key text NOT NULL CHECK (length(terms_key) BETWEEN 10 AND 200),
  weekly_rate numeric(10,2) NOT NULL CHECK (weekly_rate > 0),
  deposit numeric(10,2) NOT NULL CHECK (deposit >= 0),
  start_date date NOT NULL,
  vehicle_id uuid NOT NULL,
  vehicle_label text,
  clicked_by uuid NOT NULL,
  clicked_by_name text NOT NULL CHECK (length(btrim(clicked_by_name)) BETWEEN 1 AND 120),
  clicked_at timestamptz NOT NULL DEFAULT now(),
  fleet_delivery_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One event per applicant and term set: double clicks and retries reuse it.
  CONSTRAINT staff_terms_confirmations_once UNIQUE (application_id, terms_key)
);
CREATE INDEX IF NOT EXISTS staff_terms_confirmations_application_idx
  ON public.staff_terms_confirmations (application_id, clicked_at DESC);

ALTER TABLE public.staff_terms_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read staff terms confirmations" ON public.staff_terms_confirmations;
CREATE POLICY "Staff read staff terms confirmations" ON public.staff_terms_confirmations
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.staff_terms_confirmations FROM anon;

ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created','stage_changed',
    'quo_message_received','quo_call','quo_voicemail','quo_transcript',
    'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
    'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
    'pickup_checklist_completed','rental_activated','rental_returned','rental_ended',
    'agreement_amendment_signed',
    'applicant_ready_for_agreement'
  ));

ALTER TABLE public.agreement_terms_confirmations
  ADD COLUMN IF NOT EXISTS staff_event_id uuid REFERENCES public.staff_terms_confirmations(id) ON DELETE RESTRICT;
ALTER TABLE public.agreement_terms_confirmations
  DROP CONSTRAINT IF EXISTS agreement_terms_confirmations_channel_check;
ALTER TABLE public.agreement_terms_confirmations
  ADD CONSTRAINT agreement_terms_confirmations_channel_check CHECK (channel IN ('call', 'sms', 'staff'));
ALTER TABLE public.agreement_terms_confirmations
  DROP CONSTRAINT IF EXISTS agreement_terms_confirmations_ref;
ALTER TABLE public.agreement_terms_confirmations
  ADD CONSTRAINT agreement_terms_confirmations_ref CHECK (
    (channel = 'call' AND call_id IS NOT NULL)
    OR (channel = 'sms' AND message_id IS NOT NULL)
    OR (channel = 'staff' AND staff_event_id IS NOT NULL));

COMMIT;

-- Rollback (after reverting the code; until then Move Forward and send-agreement channel staff answer 503):
-- BEGIN;
-- DELETE FROM public.agreement_terms_confirmations WHERE channel = 'staff';
-- ALTER TABLE public.agreement_terms_confirmations DROP CONSTRAINT IF EXISTS agreement_terms_confirmations_ref;
-- ALTER TABLE public.agreement_terms_confirmations ADD CONSTRAINT agreement_terms_confirmations_ref CHECK (
--   (channel = 'call' AND call_id IS NOT NULL) OR (channel = 'sms' AND message_id IS NOT NULL));
-- ALTER TABLE public.agreement_terms_confirmations DROP CONSTRAINT IF EXISTS agreement_terms_confirmations_channel_check;
-- ALTER TABLE public.agreement_terms_confirmations ADD CONSTRAINT agreement_terms_confirmations_channel_check CHECK (channel IN ('call', 'sms'));
-- ALTER TABLE public.agreement_terms_confirmations DROP COLUMN IF EXISTS staff_event_id;
-- DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'applicant_ready_for_agreement';
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
--   'lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript',
--   'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
--   'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
--   'pickup_checklist_completed','rental_activated','rental_returned','rental_ended',
--   'agreement_amendment_signed'));
-- DROP TABLE IF EXISTS public.staff_terms_confirmations;
-- COMMIT;
