-- Capacity waitlist (Nov 17 2026). Additive only. Do not apply until Dolmar
-- approves go-live. Rollback: proposed/rollback/capacity-waitlist-v1.sql.
--
-- 1. applications.approved_at — FIFO for the approved/ready queue.
-- 2. application_waitlist_holds.source — 'manual' or 'auto_capacity'.
-- 3. waitlist_notice_jobs — email/SMS to the applicant, sent only when the
--    Automations switch is on (default off). SMS scheduled for 8 AM–9 PM ET.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.applications.approved_at IS
  'When the applicant was approved. Used to order the capacity waitlist.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'audit_log'
  ) THEN
    UPDATE public.applications a
       SET approved_at = sub.first_at
      FROM (
        SELECT entity_id, MIN(created_at) AS first_at
          FROM public.audit_log
         WHERE action = 'application.approved'
           AND entity_type = 'application'
         GROUP BY entity_id
      ) sub
     WHERE a.id = sub.entity_id
       AND a.approved_at IS NULL
       AND a.status IN ('approved', 'active', 'reserved');
  END IF;
END $$;

ALTER TABLE public.application_waitlist_holds
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'application_waitlist_holds_source_check'
  ) THEN
    ALTER TABLE public.application_waitlist_holds
      ADD CONSTRAINT application_waitlist_holds_source_check
      CHECK (source IN ('manual', 'auto_capacity'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.waitlist_notice_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id),
  kind text NOT NULL DEFAULT 'joined',
  channel text NOT NULL,
  position integer NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_notice_jobs_kind_check CHECK (kind IN ('joined')),
  CONSTRAINT waitlist_notice_jobs_channel_check CHECK (channel IN ('email', 'sms')),
  CONSTRAINT waitlist_notice_jobs_position_check CHECK (position >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_notice_jobs_one_open
  ON public.waitlist_notice_jobs (application_id, kind, channel)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS waitlist_notice_jobs_due_idx
  ON public.waitlist_notice_jobs (scheduled_for)
  WHERE sent_at IS NULL;

ALTER TABLE public.waitlist_notice_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.waitlist_notice_jobs IS
  'Queued waitlist joined notices. Processed by the automations cron. Never sent while the Automations switch is off.';

-- Allow FLEET's vehicle_available event. Keeps every event allowed in prod
-- on Nov 17, 2026, and adds this one.
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
    'reservation_refunded',
    'vehicle_available'
  ));
