-- ------------------------------------------------- 7. automation workflows

CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  trigger_event text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  quiet_hours_start integer NOT NULL DEFAULT 21,
  quiet_hours_end integer NOT NULL DEFAULT 8,
  stop_on_reply boolean NOT NULL DEFAULT true,
  stop_on_statuses text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_quiet_hours_valid CHECK (
    quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23
  )
);
COMMENT ON COLUMN public.automation_workflows.trigger_event IS
  'application_submitted | application_abandoned | application_approved | rental_started | payment_past_due';
COMMENT ON COLUMN public.automation_workflows.stop_on_statuses IS
  'Application statuses that cancel an in-flight enrollment (e.g. approved, rejected)';

CREATE TABLE IF NOT EXISTS public.automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  delay_minutes integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'sms',
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_steps_channel CHECK (channel IN ('sms', 'email')),
  CONSTRAINT automation_steps_delay_nonneg CHECK (delay_minutes >= 0)
);
COMMENT ON COLUMN public.automation_steps.delay_minutes IS
  'Minutes after enrollment (not after the previous step) that this step fires';
CREATE UNIQUE INDEX IF NOT EXISTS automation_steps_order_idx
  ON public.automation_steps(workflow_id, step_order);

CREATE TABLE IF NOT EXISTS public.automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  current_step integer NOT NULL DEFAULT 0,
  next_run_at timestamptz,
  cancelled_reason text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.automation_enrollments.status IS 'active | completed | cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS automation_enrollments_unique_idx
  ON public.automation_enrollments(workflow_id, application_id)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_enrollments_due_idx
  ON public.automation_enrollments(next_run_at) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_enrollments TO authenticated;
GRANT ALL ON public.automation_workflows TO service_role;
GRANT ALL ON public.automation_steps TO service_role;
GRANT ALL ON public.automation_enrollments TO service_role;

ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage automation workflows" ON public.automation_workflows
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage automation steps" ON public.automation_steps
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff manage automation enrollments" ON public.automation_enrollments
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

CREATE TRIGGER automation_workflows_set_updated_at BEFORE UPDATE ON public.automation_workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER automation_steps_set_updated_at BEFORE UPDATE ON public.automation_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER automation_enrollments_set_updated_at BEFORE UPDATE ON public.automation_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------ 8. outbound message log + SMS opt-out ledger

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  to_address text NOT NULL,
  from_address text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  provider text,
  provider_message_id text,
  error text,
  kind text,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  rental_id uuid REFERENCES public.rentals(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES public.automation_workflows(id) ON DELETE SET NULL,
  enrollment_id uuid REFERENCES public.automation_enrollments(id) ON DELETE SET NULL,
  step_id uuid REFERENCES public.automation_steps(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_messages_channel CHECK (channel IN ('sms', 'email')),
  CONSTRAINT outbound_messages_status CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS outbound_messages_application_idx
  ON public.outbound_messages(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_created_idx
  ON public.outbound_messages(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS outbound_messages_enrollment_step_idx
  ON public.outbound_messages(enrollment_id, step_id)
  WHERE enrollment_id IS NOT NULL AND step_id IS NOT NULL;

GRANT SELECT ON public.outbound_messages TO authenticated;
GRANT ALL ON public.outbound_messages TO service_role;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read outbound messages" ON public.outbound_messages
  FOR SELECT TO authenticated USING (private.is_staff());

CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  phone text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sms_opt_outs TO authenticated;
GRANT ALL ON public.sms_opt_outs TO service_role;
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read sms opt-outs" ON public.sms_opt_outs
  FOR SELECT TO authenticated USING (private.is_staff());