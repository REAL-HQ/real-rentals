-- Missing-Items Outreach.
-- 1. applications.income_proof_url: the applicant's proof-of-income upload
--    (private bucket path, same as license_photo_url).
-- 2. applicant_outreach_log: one row per message sent (or claimed) so the
--    ongoing sequence is capped (step 1, 2, 3 per missing set) and the one-time
--    backfill can never reach the same applicant twice.
-- 3. applicant_autoclose: one row per auto-close (no reply within N days of
--    the last message -> status closed, never declined), so it happens once
--    and opening the come-back link can restore the prior status.
-- 4. app_settings 'missing_items_outreach': schedule defaults. Sending and
--    closing are controlled by three Automations switches, all Off by default.
-- Idempotent. Applies nothing on its own: nobody is messaged until an Owner
-- turns a switch on.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS income_proof_url text;

CREATE TABLE IF NOT EXISTS public.applicant_outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  missing_key text NOT NULL,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 3),
  source text NOT NULL CHECK (source IN ('backfill', 'ongoing')),
  items text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applicant_outreach_log_once UNIQUE (application_id, missing_key, step)
);
-- The one-time message: at most one per application, ever.
CREATE UNIQUE INDEX IF NOT EXISTS applicant_outreach_log_backfill_once
  ON public.applicant_outreach_log (application_id) WHERE source = 'backfill';
CREATE INDEX IF NOT EXISTS applicant_outreach_log_app_idx
  ON public.applicant_outreach_log (application_id, created_at DESC);

ALTER TABLE public.applicant_outreach_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applicant_outreach_log FROM anon, authenticated;
DROP POLICY IF EXISTS "Staff read outreach log" ON public.applicant_outreach_log;
CREATE POLICY "Staff read outreach log" ON public.applicant_outreach_log
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.applicant_outreach_log TO authenticated;

CREATE TABLE IF NOT EXISTS public.applicant_autoclose (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  prior_status text NOT NULL,
  last_message_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}',
  error text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_at timestamptz,
  reopened boolean
);
-- At most one open (not yet reopened) auto-close per application.
CREATE UNIQUE INDEX IF NOT EXISTS applicant_autoclose_open_once
  ON public.applicant_autoclose (application_id) WHERE reopened_at IS NULL;
ALTER TABLE public.applicant_autoclose ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applicant_autoclose FROM anon, authenticated;
DROP POLICY IF EXISTS "Staff read autoclose" ON public.applicant_autoclose;
CREATE POLICY "Staff read autoclose" ON public.applicant_autoclose
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.applicant_autoclose TO authenticated;

INSERT INTO public.app_settings (key, value)
VALUES ('missing_items_outreach', jsonb_build_object(
  'waitHours', 24,
  'reminderDays', jsonb_build_array(3, 7),
  'minGapHours', 48,
  'maxAgeDays', 60,
  'maxSequences', 2,
  'statuses', jsonb_build_array('new', 'reviewing'),
  'email', true,
  'sms', true,
  'batchLimit', 25,
  'smsHours', jsonb_build_array(9, 20),
  'backfillMaxAgeDays', NULL,
  'autoCloseDays', 14))
ON CONFLICT (key) DO NOTHING;
