-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Lets fleet_webhook_deliveries hold the new agreement_signed_by_renter event
-- (queued by esign completeSigning when a renter signs). Without this, the
-- insert is refused by the CHECK constraint: the app logs it and signing still
-- succeeds, but FLEET gets no alert.
--
-- Additive and reversible (rollback at the bottom). Sends nothing by itself.
BEGIN;
ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created', 'stage_changed',
    'quo_message_received', 'quo_call', 'quo_voicemail', 'quo_transcript',
    'agreement_signed_by_renter'));
COMMIT;

-- Rollback (only if no agreement_signed_by_renter rows exist, or delete them first):
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check
--   CHECK (event_type IN ('lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript'));
