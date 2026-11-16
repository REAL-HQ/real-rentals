-- FLEET lifecycle events (feat/fleet-lifecycle-events). NOT APPLIED.
-- Lets public.fleet_webhook_deliveries hold the eight new event names.
-- Nothing is queued until app_settings.fleet_lifecycle_events is enabled
-- (fleet-lifecycle-events-on.sql), so applying this alone changes nothing.
-- Keeps every event allowed today (checked on prod Nov 16, 2026: the nine below).
BEGIN;
ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created','stage_changed',
    'quo_message_received','quo_call','quo_voicemail','quo_transcript',
    'agreement_signed_by_renter','application_ready_for_review','reservation_confirmed',
    'documents_uploaded','payment_succeeded','payment_failed','agreement_delivery_failed',
    'pickup_checklist_completed','rental_activated','rental_returned','rental_ended'
  ));
COMMIT;

-- Rollback (only after deleting rows with the new event names):
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check
--   CHECK (event_type IN ('lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript','agreement_signed_by_renter','application_ready_for_review','reservation_confirmed'));
