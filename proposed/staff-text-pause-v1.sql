-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it runs on production.
--
-- Staff-text bot pause (card t310s1681: "auto-pause the bots when staff text
-- someone from Quo"). One row per phone number (last 10 digits). Written by the
-- Quo webhook when a person on the team texts someone from the 888 or 813 line
-- (switch Off by default), or by staff on the driver profile (+48 Hours /
-- Resume Bots). Read by every automatic bot sender: missing-items messages and
-- auto-close, the Follow-Up workflow, pickup and agreement reminders, rent and
-- late-fee notices, the Payment Failed Text, FLEET link resends, /fleet/status.
-- Additive. Sends nothing. Until this table exists the code treats every
-- check as "not paused" (today's behaviour). Rollback at the bottom.
BEGIN;
CREATE TABLE IF NOT EXISTS public.bot_text_pauses (
  phone_key text PRIMARY KEY CHECK (phone_key ~ '^[0-9]{10}$'),
  phone_e164 text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  paused_until timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'staff_text' CHECK (reason IN ('staff_text', 'staff_manual')),
  source text NOT NULL DEFAULT 'quo_staff_text' CHECK (source IN ('quo_staff_text', 'site_staff_text', 'staff')),
  last_staff_text_at timestamptz,
  quo_event_id text CHECK (quo_event_id IS NULL OR length(quo_event_id) <= 200),
  quo_user_id text CHECK (quo_user_id IS NULL OR length(quo_user_id) <= 100),
  line_e164 text,
  set_by text,
  cleared_at timestamptz,
  cleared_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_text_pauses_window CHECK (paused_until <= updated_at + interval '14 days 1 minute')
);
CREATE INDEX IF NOT EXISTS bot_text_pauses_active_idx
  ON public.bot_text_pauses (paused_until) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS bot_text_pauses_application_idx
  ON public.bot_text_pauses (application_id);

ALTER TABLE public.bot_text_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read bot text pauses" ON public.bot_text_pauses;
CREATE POLICY "Staff read bot text pauses" ON public.bot_text_pauses
  FOR SELECT TO authenticated USING (private.is_staff());
REVOKE ALL ON public.bot_text_pauses FROM anon;
COMMIT;

-- Rollback (after the code that reads it is reverted; until then the code treats a missing table as "not paused"):
-- DROP TABLE IF EXISTS public.bot_text_pauses;
