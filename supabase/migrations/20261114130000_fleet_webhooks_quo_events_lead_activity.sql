-- FLEET lead alerts, Quo call/voicemail/transcript events, and one activity
-- log per lead (Automation Blueprint, Nov 14 2026).
--
-- Additive only. Nothing here sends anything: rows queue in
-- fleet_webhook_deliveries and the app delivers them only once
-- FLEET_WEBHOOK_URL and FLEET_WEBHOOK_KEY are configured. While they are not,
-- the app marks queued rows 'skipped' so turning it on later never replays
-- a backlog.

-- 1. Lead stage history (applications.status), written by trigger.
CREATE TABLE IF NOT EXISTS public.application_status_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_status_changes_app_idx
  ON public.application_status_changes (application_id, changed_at DESC);

-- 2. Outbound FLEET webhook queue and delivery log.
CREATE TABLE IF NOT EXISTS public.fleet_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'lead_created', 'stage_changed',
    'quo_message_received', 'quo_call', 'quo_voicemail', 'quo_transcript')),
  dedupe_key text NOT NULL UNIQUE,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  quo_event_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_webhook_deliveries_due_idx
  ON public.fleet_webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS fleet_webhook_deliveries_app_idx
  ON public.fleet_webhook_deliveries (application_id, created_at DESC);

-- 3. Quo events (texts in, calls, voicemails, recordings, transcripts), one
-- row per Quo event id. Every row carries the line it came in on.
CREATE TABLE IF NOT EXISTS public.quo_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quo_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  quo_resource_id text,
  call_id text,
  conversation_id text,
  phone_number_id text NOT NULL,
  line_e164 text NOT NULL,
  line_label text NOT NULL,
  direction text,
  from_e164 text,
  to_e164 text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  body text,
  transcript text,
  recording_url text,
  voicemail_url text,
  duration_seconds integer,
  occurred_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quo_events_app_idx ON public.quo_events (application_id, occurred_at DESC);

-- Staff read; only the server (service role) writes.
ALTER TABLE public.application_status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quo_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read status changes" ON public.application_status_changes;
CREATE POLICY "Staff read status changes" ON public.application_status_changes
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS "Staff read fleet deliveries" ON public.fleet_webhook_deliveries;
CREATE POLICY "Staff read fleet deliveries" ON public.fleet_webhook_deliveries
  FOR SELECT TO authenticated USING (private.is_staff());
DROP POLICY IF EXISTS "Staff read quo events" ON public.quo_events;
CREATE POLICY "Staff read quo events" ON public.quo_events
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.application_status_changes, public.fleet_webhook_deliveries, public.quo_events FROM anon;

-- 4. Trigger: new lead and every stage change are recorded and queued.
CREATE OR REPLACE FUNCTION private.fleet_track_application_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE change_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.application_status_changes (application_id, from_status, to_status, changed_at)
      VALUES (NEW.id, NULL, NEW.status, coalesce(NEW.created_at, now()));
    INSERT INTO public.fleet_webhook_deliveries (event_type, dedupe_key, application_id, payload)
      VALUES ('lead_created', 'lead_created:' || NEW.id, NEW.id, jsonb_build_object('stage', NEW.status))
      ON CONFLICT (dedupe_key) DO NOTHING;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.application_status_changes (application_id, from_status, to_status)
      VALUES (NEW.id, OLD.status, NEW.status) RETURNING id INTO change_id;
    INSERT INTO public.fleet_webhook_deliveries (event_type, dedupe_key, application_id, payload)
      VALUES ('stage_changed', 'stage_changed:' || change_id, NEW.id,
              jsonb_build_object('stage', NEW.status, 'previous_stage', OLD.status))
      ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.fleet_track_application_status() FROM PUBLIC;

DROP TRIGGER IF EXISTS applications_fleet_track_status ON public.applications;
CREATE TRIGGER applications_fleet_track_status
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION private.fleet_track_application_status();

-- 5. One activity log per lead: texts, calls, voicemails, transcripts,
-- emails and stage changes. security_invoker: staff RLS of each table applies.
CREATE OR REPLACE VIEW public.lead_activity WITH (security_invoker = true) AS
  SELECT o.application_id,
         coalesce(o.sent_at, o.created_at) AS occurred_at,
         CASE WHEN o.channel = 'sms' THEN 'text' ELSE 'email' END AS activity_type,
         'outbound'::text AS direction,
         coalesce(o.subject, o.body) AS summary,
         o.status,
         o.kind AS template,
         CASE WHEN o.channel = 'sms' THEN o.from_address END AS line_e164,
         CASE o.from_address WHEN '+18888338280' THEN 'PNrZULvFMn' WHEN '+18132124174' THEN 'PNcX8a0PLJ' END AS phone_number_id,
         CASE o.from_address WHEN '+18888338280' THEN 'REAL Rentals 888' WHEN '+18132124174' THEN 'Primary 813' END AS line_label,
         NULL::text AS recording_url,
         'outbound_messages'::text AS source_table,
         o.id::text AS source_id
    FROM public.outbound_messages o
   WHERE o.application_id IS NOT NULL
  UNION ALL
  SELECT q.application_id,
         coalesce(q.occurred_at, q.created_at),
         CASE
           WHEN q.event_type = 'message.received' THEN 'text'
           WHEN q.event_type = 'call.voicemail.completed' THEN 'voicemail'
           WHEN q.event_type = 'call.transcript.completed' THEN 'transcript'
           WHEN q.event_type = 'call.recording.completed' THEN 'recording'
           WHEN q.event_type = 'call.summary.completed' THEN 'call_summary'
           ELSE 'call'
         END,
         coalesce(q.direction, 'incoming'),
         coalesce(q.body, q.transcript, q.event_type),
         q.event_type,
         NULL,
         q.line_e164, q.phone_number_id, q.line_label,
         coalesce(q.voicemail_url, q.recording_url),
         'quo_events', q.id::text
    FROM public.quo_events q
   WHERE q.application_id IS NOT NULL
  UNION ALL
  -- Inbound texts threaded before Quo events were recorded.
  SELECT m.application_id, m.created_at, 'text', 'incoming', m.body, m.delivery_state, NULL,
         NULL, NULL, NULL, NULL, 'messages', m.id::text
    FROM public.messages m
   WHERE m.application_id IS NOT NULL AND m.direction = 'inbound'
     AND NOT EXISTS (
       SELECT 1 FROM public.quo_events q
        WHERE q.event_type = 'message.received' AND q.application_id = m.application_id
          AND q.body IS NOT DISTINCT FROM m.body
          AND abs(extract(epoch FROM (coalesce(q.occurred_at, q.created_at) - m.created_at))) < 300)
  UNION ALL
  SELECT a.id, e.created_at, 'email', 'outbound', e.workflow, e.state, e.workflow,
         NULL, NULL, NULL, NULL, 'email_deliveries', e.id::text
    FROM public.email_deliveries e
    JOIN public.applications a ON lower(a.email) = lower(e.recipient)
  UNION ALL
  SELECT s.application_id, s.changed_at, 'status_change', NULL,
         coalesce(s.from_status || ' → ', '') || s.to_status, s.to_status, NULL,
         NULL, NULL, NULL, NULL, 'application_status_changes', s.id::text
    FROM public.application_status_changes s;

REVOKE ALL ON public.lead_activity FROM anon;
GRANT SELECT ON public.lead_activity TO authenticated;
