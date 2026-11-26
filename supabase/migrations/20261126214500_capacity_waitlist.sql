-- Capacity waitlist. FILE ONLY. Do not apply until Dolmar approves.
-- Rollback: proposed/rollback/capacity-waitlist-v1.sql
--
-- What this does, and nothing else:
-- 1. applications.approved_at — when the applicant was approved, used to order
--    the capacity waitlist. Backfilled from the first application.approved
--    audit row for people still approved, reserved, or active.
-- 2. application_waitlist_holds.source — 'manual' (staff) or 'auto_capacity'.
--    Existing rows become manual. added_by may be null only on an
--    auto_capacity row, because that hold is the capacity rule, not a person.
--    A manual hold still requires added_by.
-- 3. Closing a hold still requires removed_by, except an auto_capacity hold
--    closed by a path with no staff user (a FLEET decline). Staff closes
--    still record who. authenticated still cannot update this table.
-- 4. waitlist_notice_jobs — email/SMS queue for the joined notice. RLS on,
--    no policies, and anon/authenticated have no grants. The automations
--    cron (service role) is the only reader. Nothing is sent while the
--    Waitlist Joined Notice switch is off.
-- 5. fleet_webhook_deliveries event check — appends vehicle_available to
--    whatever events are already allowed. It does not replace the list.
--
-- Does not turn on Waitlist Joined Notice or Car Available Alerts.
-- Does not send email, SMS, or webhooks.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN public.applications.approved_at IS
  'When the applicant was approved. Orders the capacity waitlist. Null until the approval stamp or this backfill.';

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
     WHERE a.id::text = sub.entity_id::text
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
       AND conrelid = 'public.application_waitlist_holds'::regclass
  ) THEN
    ALTER TABLE public.application_waitlist_holds
      ADD CONSTRAINT application_waitlist_holds_source_check
      CHECK (source IN ('manual', 'auto_capacity'));
  END IF;
END $$;

ALTER TABLE public.application_waitlist_holds
  ALTER COLUMN added_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'application_waitlist_holds_manual_actor_check'
       AND conrelid = 'public.application_waitlist_holds'::regclass
  ) THEN
    ALTER TABLE public.application_waitlist_holds
      ADD CONSTRAINT application_waitlist_holds_manual_actor_check
      CHECK (source = 'auto_capacity' OR added_by IS NOT NULL);
  END IF;
END $$;

-- The original pair check is unnamed. Replace it so an auto_capacity hold
-- can be closed without a staff user. A manual hold still needs removed_by.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'application_waitlist_holds'
       AND c.contype = 'c'
       AND c.conname <> 'application_waitlist_holds_source_check'
       AND c.conname <> 'application_waitlist_holds_manual_actor_check'
       AND pg_get_constraintdef(c.oid) ILIKE '%removed_at%'
       AND pg_get_constraintdef(c.oid) ILIKE '%removed_by%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%auto_capacity%'
  LOOP
    EXECUTE format('ALTER TABLE public.application_waitlist_holds DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'application_waitlist_holds_removed_pair_check'
       AND conrelid = 'public.application_waitlist_holds'::regclass
  ) THEN
    ALTER TABLE public.application_waitlist_holds
      ADD CONSTRAINT application_waitlist_holds_removed_pair_check
      CHECK (
        (removed_at IS NULL AND removed_by IS NULL)
        OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
        OR (removed_at IS NOT NULL AND removed_by IS NULL AND source = 'auto_capacity')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.waitlist_holds_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Waitlist history cannot be deleted'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A closed waitlist hold is immutable'; END IF;
  IF NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.added_at IS DISTINCT FROM OLD.added_at
     OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'Only removal may be recorded on a waitlist hold';
  END IF;
  RETURN NEW;
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

CREATE INDEX IF NOT EXISTS waitlist_notice_jobs_application_idx
  ON public.waitlist_notice_jobs (application_id);

ALTER TABLE public.waitlist_notice_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.waitlist_notice_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.waitlist_notice_jobs TO service_role;

COMMENT ON TABLE public.waitlist_notice_jobs IS
  'Queued waitlist joined notices. Processed by the automations cron. Never sent while the Automations switch is off.';

-- Append vehicle_available. Keep every event the live check already allows,
-- including reservation_refunded and any event added after this file was written.
DO $$
DECLARE
  cname text;
  expr text;
  rewritten text;
BEGIN
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO cname, expr
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'fleet_webhook_deliveries'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
   ORDER BY c.conname
   LIMIT 1;

  IF cname IS NULL THEN
    RAISE NOTICE 'fleet_webhook_deliveries has no event_type check; vehicle_available was not added to a list';
    RETURN;
  END IF;
  IF expr ILIKE '%vehicle_available%' THEN
    RETURN;
  END IF;
  IF expr NOT LIKE '%ARRAY[%' THEN
    RAISE EXCEPTION 'fleet_webhook_deliveries event check is not an ARRAY list (%). Refusing to replace it.', expr;
  END IF;
  rewritten := regexp_replace(expr, 'ARRAY\[', 'ARRAY[''vehicle_available''::text, ', 1, 1);
  EXECUTE format('ALTER TABLE public.fleet_webhook_deliveries DROP CONSTRAINT %I', cname);
  EXECUTE format(
    'ALTER TABLE public.fleet_webhook_deliveries ADD CONSTRAINT fleet_webhook_deliveries_event_type_check %s',
    rewritten
  );
END $$;
