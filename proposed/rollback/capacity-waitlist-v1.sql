-- Rollback for proposed/capacity-waitlist-v1.sql.
-- Drops the notice queue and the additive columns. Existing waitlist holds
-- stay; only the source column is removed.

DROP TABLE IF EXISTS public.waitlist_notice_jobs;

ALTER TABLE public.application_waitlist_holds
  DROP CONSTRAINT IF EXISTS application_waitlist_holds_source_check;

ALTER TABLE public.application_waitlist_holds
  DROP COLUMN IF EXISTS source;

ALTER TABLE public.applications
  DROP COLUMN IF EXISTS approved_at;

-- Restore the event-type CHECK to the list from proposed/reservation-fee-refunds-v1.sql
-- (integration after PR 427). Delete vehicle_available deliveries first if any exist.
DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'vehicle_available';
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
