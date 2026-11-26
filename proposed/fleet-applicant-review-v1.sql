-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- FLEET applicant review (src/lib/fleet-review.server.ts):
--   1. public.fleet_review_decisions: every FLEET decision (approve,
--      declined, or needs_staff) with its reason, and the staff queue (open
--      needs_staff rows). Written only by the server (service role). Staff
--      can read.
--   2. fleet_webhook_deliveries accepts the new application_ready_for_review event.
--
-- Additive. Sends nothing by itself. Before this runs: FLEET's approve still
-- works (the decision row is skipped and only the audit log records it),
-- needs_staff answers 503 and changes nothing, the Needs Staff filter is empty,
-- and the ready-for-review alert is refused by the CHECK (logged, nothing sent).
-- Rollback at the bottom.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fleet_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'needs_staff', 'declined')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 1000),
  escalation_codes text[] NOT NULL DEFAULT '{}',
  assessment jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL DEFAULT 'FLEET (automated)',
  idempotency_key text UNIQUE CHECK (idempotency_key IS NULL OR length(idempotency_key) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 500)
);
-- One open Needs Staff flag per applicant.
CREATE UNIQUE INDEX IF NOT EXISTS fleet_review_decisions_one_open_needs_staff
  ON public.fleet_review_decisions (application_id)
  WHERE decision = 'needs_staff' AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS fleet_review_decisions_application_idx
  ON public.fleet_review_decisions (application_id, created_at DESC);

ALTER TABLE public.fleet_review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read fleet review decisions" ON public.fleet_review_decisions;
CREATE POLICY "Staff read fleet review decisions" ON public.fleet_review_decisions
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.fleet_review_decisions FROM anon;

-- Re-run: a database that already has the table keeps the old check until this.
ALTER TABLE public.fleet_review_decisions DROP CONSTRAINT IF EXISTS fleet_review_decisions_decision_check;
ALTER TABLE public.fleet_review_decisions
  ADD CONSTRAINT fleet_review_decisions_decision_check
  CHECK (decision IN ('approved', 'needs_staff', 'declined'));

ALTER TABLE public.fleet_webhook_deliveries
  DROP CONSTRAINT IF EXISTS fleet_webhook_deliveries_event_type_check;
ALTER TABLE public.fleet_webhook_deliveries
  ADD CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN (
    'lead_created', 'stage_changed',
    'quo_message_received', 'quo_call', 'quo_voicemail', 'quo_transcript',
    'agreement_signed_by_renter',
    'application_ready_for_review'));
COMMIT;

-- Rollback (delete application_ready_for_review rows first):
-- DELETE FROM public.fleet_webhook_deliveries WHERE event_type = 'application_ready_for_review';
-- ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT fleet_webhook_deliveries_event_type_check;
-- ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check
--   CHECK (event_type IN ('lead_created','stage_changed','quo_message_received','quo_call','quo_voicemail','quo_transcript','agreement_signed_by_renter'));
-- DROP TABLE IF EXISTS public.fleet_review_decisions;
