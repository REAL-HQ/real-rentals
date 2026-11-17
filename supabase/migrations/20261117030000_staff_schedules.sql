-- =============================================================================
-- Staff coverage hours for bot/FLEET handoffs (Dolmar, t365u)
--
-- staff_schedules: who can take a handoff, their weekly hours, and how to
-- reach them (the other company Quo line, or the field-rep SMS list in the
-- Pickup Schedule settings). No staff or renter phone numbers are stored here.
--
-- staff_schedule_exceptions: holiday or extra on/off dates (YYYY-MM-DD in
-- America/New_York). An "off" row wins over the weekly window; an "on" row
-- covers that date (optional start_time/end_time, else the whole day).
--
-- This migration is not applied by this PR; it ships as a file only.
-- Rollback: proposed/staff-schedules-rollback.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  staff_key text NOT NULL,
  display_name text NOT NULL,
  roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  timezone text NOT NULL DEFAULT 'America/New_York',
  weekly_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  reach_via text NOT NULL DEFAULT 'field_rep_sms',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_schedules_key_ok CHECK (staff_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT staff_schedules_name_ok CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT staff_schedules_roles_ok CHECK (
    roles <@ ARRAY['coverage','after_hours','field_rep']::text[]
    AND cardinality(roles) >= 1
  ),
  CONSTRAINT staff_schedules_reach_ok CHECK (reach_via IN ('other_quo_line', 'field_rep_sms')),
  CONSTRAINT staff_schedules_windows_ok CHECK (jsonb_typeof(weekly_windows) = 'array'),
  CONSTRAINT staff_schedules_staff_key_unique UNIQUE (staff_key)
);

COMMENT ON TABLE public.staff_schedules IS
  'Editable staff coverage for bot handoffs. Weekly hours in timezone; reach_via is other_quo_line or field_rep_sms. No phone numbers.';

COMMENT ON COLUMN public.staff_schedules.weekly_windows IS
  'Array of {dow: 0-6, start: "HH:mm", end: "HH:mm"} in timezone. Start inclusive, end exclusive.';

COMMENT ON COLUMN public.staff_schedules.reach_via IS
  'other_quo_line: text the company Quo line the renter is not already on. field_rep_sms: Pickup Schedule notify.sms numbers.';

CREATE TABLE IF NOT EXISTS public.staff_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  staff_key text NOT NULL REFERENCES public.staff_schedules(staff_key) ON DELETE CASCADE,
  exception_date date NOT NULL,
  kind text NOT NULL,
  start_time time,
  end_time time,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_schedule_exceptions_kind_ok CHECK (kind IN ('off', 'on')),
  CONSTRAINT staff_schedule_exceptions_note_ok CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT staff_schedule_exceptions_window_ok CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  ),
  CONSTRAINT staff_schedule_exceptions_unique UNIQUE (staff_key, exception_date)
);

COMMENT ON TABLE public.staff_schedule_exceptions IS
  'Holiday or extra on/off dates for staff_schedules. exception_date is a calendar date in the staff timezone.';

CREATE INDEX IF NOT EXISTS staff_schedule_exceptions_date_idx
  ON public.staff_schedule_exceptions (exception_date);

INSERT INTO public.staff_schedules (staff_key, display_name, roles, timezone, weekly_windows, reach_via, is_active)
VALUES
  (
    'rosa',
    'Rosa DeJesus',
    ARRAY['coverage']::text[],
    'America/New_York',
    '[
      {"dow": 1, "start": "14:00", "end": "18:00"},
      {"dow": 2, "start": "09:00", "end": "15:00"},
      {"dow": 3, "start": "09:00", "end": "15:00"},
      {"dow": 5, "start": "09:00", "end": "13:00"}
    ]'::jsonb,
    'other_quo_line',
    true
  ),
  (
    'dolmar',
    'Dolmar Cross',
    ARRAY['after_hours','field_rep']::text[],
    'America/New_York',
    '[]'::jsonb,
    'field_rep_sms',
    true
  )
ON CONFLICT (staff_key) DO NOTHING;

ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedule_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read staff schedules" ON public.staff_schedules;
CREATE POLICY "Staff read staff schedules" ON public.staff_schedules
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS "Owners manage staff schedules" ON public.staff_schedules;
CREATE POLICY "Owners manage staff schedules" ON public.staff_schedules
  FOR ALL TO authenticated
  USING (private.is_owner())
  WITH CHECK (private.is_owner());

DROP POLICY IF EXISTS "Staff read staff schedule exceptions" ON public.staff_schedule_exceptions;
CREATE POLICY "Staff read staff schedule exceptions" ON public.staff_schedule_exceptions
  FOR SELECT TO authenticated
  USING (private.is_staff());

DROP POLICY IF EXISTS "Owners manage staff schedule exceptions" ON public.staff_schedule_exceptions;
CREATE POLICY "Owners manage staff schedule exceptions" ON public.staff_schedule_exceptions
  FOR ALL TO authenticated
  USING (private.is_owner())
  WITH CHECK (private.is_owner());

REVOKE ALL ON public.staff_schedules FROM anon;
REVOKE ALL ON public.staff_schedule_exceptions FROM anon;
GRANT SELECT ON public.staff_schedules TO authenticated;
GRANT SELECT ON public.staff_schedule_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedule_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedule_exceptions TO service_role;
