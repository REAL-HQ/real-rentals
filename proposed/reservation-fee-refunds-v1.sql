-- Reservation Fee refunds (Dolmar, t406u, Nov 17 2026).
--
--   1. public.reservation_fee_refunds: one audit row per Reservation Fee
--      (who, reason, Stripe refund id, time). One refund per payment.
--   2. applications.renter_policy_status: pending / issued / declined.
--      Auto-refund on decline is gated by the Automations switch
--      "Auto-Refund Reservation On Insurance Decline" (default Off in code).
--   3. fleet_webhook_deliveries: allow event reservation_refunded
--      (keeps every event allowed on the integration tip, checked Nov 17 2026).
--
-- Not applied. Do not run against production until Dolmar approves.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_fee_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.applications(id) ON DELETE RESTRICT,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN (
    'insurance_declined',
    'no_vehicle',
    'failed_inspection',
    'terms_changed',
    'post_payment_denial',
    'duplicate_or_mistaken_charge'
  )),
  note text,
  stripe_refund_id text,
  stripe_payment_intent_id text,
  source text NOT NULL CHECK (source IN ('staff', 'fleet', 'auto_insurance_decline')),
  refunded_by uuid,
  refunded_by_email text,
  refunded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_fee_refunds_payment_id_uidx
  ON public.reservation_fee_refunds (payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS reservation_fee_refunds_stripe_refund_id_uidx
  ON public.reservation_fee_refunds (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

COMMENT ON TABLE public.reservation_fee_refunds IS
  'One refund of a paid Reservation Fee. Idempotent: one row per payment. Written only by the service role.';

ALTER TABLE public.reservation_fee_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read reservation fee refunds" ON public.reservation_fee_refunds;
CREATE POLICY "Staff read reservation fee refunds" ON public.reservation_fee_refunds
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.reservation_fee_refunds FROM anon, authenticated;
GRANT SELECT ON public.reservation_fee_refunds TO authenticated;
GRANT ALL ON public.reservation_fee_refunds TO service_role;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS renter_policy_status text;
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_renter_policy_status_chk;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_renter_policy_status_chk
  CHECK (renter_policy_status IS NULL OR renter_policy_status IN ('pending', 'issued', 'declined'));
COMMENT ON COLUMN public.applications.renter_policy_status IS
  'Status of the Renter Policy we arrange (pending, issued, declined). Not the renter''s own insurance card and never a verification. Declined may auto-refund the Reservation Fee when the Automations switch is On.';

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
    'applicant_ready_for_agreement',
    'reservation_refunded'
  ));

COMMIT;

-- Rollback (after reverting the code):
-- BEGIN;
-- DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'reservation_refunded';
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
--   'lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript',
--   'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
--   'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
--   'pickup_checklist_completed','rental_activated','rental_returned','rental_ended',
--   'agreement_amendment_signed',
--   'applicant_ready_for_agreement'));
-- ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_renter_policy_status_chk;
-- ALTER TABLE public.applications DROP COLUMN IF EXISTS renter_policy_status;
-- DROP TABLE IF EXISTS public.reservation_fee_refunds;
-- COMMIT;
