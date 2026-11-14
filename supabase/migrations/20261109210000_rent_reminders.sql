-- =============================================================================
-- Uniform rent reminders: send ledger + late-fee waivers
--
-- rent_reminder_log   one row per reminder claimed: rental + due date + stage
--                     (+ day, for daily) + channel. The UNIQUE key is the claim
--                     that makes the hourly scheduler and the Stripe webhook's
--                     failed-payment text idempotent with each other.
-- rent_late_fee_waivers  staff decisions to waive the $50/day late fee for a
--                     rental's due date (whole week, or through a date). Who
--                     and when are recorded. Fees are never auto-charged.
--
-- Nothing here sends anything, schedules a job, or changes existing rows.
-- Managers read and write (private.is_manager()); the service role writes the log.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rent_reminder_log (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  stage text NOT NULL CHECK (stage ~ '^(due_tomorrow|due_today|overdue|daily:\d{4}-\d{2}-\d{2})$'),
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  source text NOT NULL DEFAULT 'scheduler' CHECK (source IN ('scheduler', 'webhook')),
  outcome text NOT NULL DEFAULT 'claimed',
  detail text CHECK (detail IS NULL OR length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_reminder_log_once UNIQUE (rental_id, due_date, stage, channel)
);
CREATE INDEX IF NOT EXISTS rent_reminder_log_rental_idx ON public.rent_reminder_log (rental_id, due_date);

CREATE TABLE IF NOT EXISTS public.rent_late_fee_waivers (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  -- NULL = the whole week's late fees are waived; a date = waived through that day.
  waived_through date,
  amount_waived numeric(10,2) CHECK (amount_waived IS NULL OR amount_waived >= 0),
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  waived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  waived_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_late_fee_waivers_once UNIQUE (rental_id, due_date),
  CONSTRAINT rent_late_fee_waivers_order CHECK (waived_through IS NULL OR waived_through >= due_date)
);

ALTER TABLE public.rent_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_late_fee_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read rent reminder log" ON public.rent_reminder_log;
CREATE POLICY "Managers read rent reminder log" ON public.rent_reminder_log
  FOR SELECT TO authenticated USING (private.is_manager());

DROP POLICY IF EXISTS "Managers manage late fee waivers" ON public.rent_late_fee_waivers;
CREATE POLICY "Managers manage late fee waivers" ON public.rent_late_fee_waivers
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

REVOKE ALL ON public.rent_reminder_log FROM anon;
REVOKE ALL ON public.rent_late_fee_waivers FROM anon;
GRANT SELECT ON public.rent_reminder_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_reminder_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_late_fee_waivers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_late_fee_waivers TO service_role;

CREATE OR REPLACE FUNCTION public.touch_rent_reminder_row()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rent_reminder_log_touch ON public.rent_reminder_log;
CREATE TRIGGER rent_reminder_log_touch BEFORE UPDATE ON public.rent_reminder_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_rent_reminder_row();
DROP TRIGGER IF EXISTS rent_late_fee_waivers_touch ON public.rent_late_fee_waivers;
CREATE TRIGGER rent_late_fee_waivers_touch BEFORE UPDATE ON public.rent_late_fee_waivers
  FOR EACH ROW EXECUTE FUNCTION public.touch_rent_reminder_row();
