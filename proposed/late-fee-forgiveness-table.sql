-- PROPOSED, NOT APPLIED. Needs Dolmar's approval before it is run.
-- Manage Late Fees: one row per forgiven late fee (a late day, or part of one).
--
-- The app works before this is applied: forgiving whole days from the oldest
-- open day of a week (and Forgive All) is saved as a staff waiver in
-- rent_late_fee_waivers, which the daily sweep and the texts already honor.
-- This table adds forgiving part of a day's fee, a later day while an earlier
-- one stays, and Owner Undo. Creates one new table; changes no existing row,
-- sends nothing, schedules nothing. Re-running changes nothing.
CREATE TABLE IF NOT EXISTS public.late_fee_forgiveness (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  -- The rent week the fee belongs to (same due date the waivers and texts use).
  due_date date NOT NULL,
  -- The late day forgiven; NULL = oldest open fees of that week first.
  fee_date date,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 80),
  note text CHECK (note IS NULL OR length(note) <= 500),
  -- The open rent row lowered, and by how much (Undo puts exactly this back).
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  payment_late_fee_reduced numeric(10,2) NOT NULL DEFAULT 0 CHECK (payment_late_fee_reduced >= 0),
  forgiven_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  forgiven_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  undone_by_email text,
  undo_note text CHECK (undo_note IS NULL OR length(undo_note) <= 500),
  CONSTRAINT late_fee_forgiveness_day CHECK (fee_date IS NULL OR fee_date > due_date)
);
CREATE INDEX IF NOT EXISTS late_fee_forgiveness_rental_idx ON public.late_fee_forgiveness (rental_id, due_date) WHERE undone_at IS NULL;

ALTER TABLE public.late_fee_forgiveness ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read late fee forgiveness" ON public.late_fee_forgiveness;
CREATE POLICY "Managers read late fee forgiveness" ON public.late_fee_forgiveness
  FOR SELECT TO authenticated USING (private.is_manager());
-- Writes go through the server (service role) only, which checks Manager / Owner and writes the audit log.
REVOKE ALL ON public.late_fee_forgiveness FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.late_fee_forgiveness FROM authenticated;
GRANT SELECT ON public.late_fee_forgiveness TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.late_fee_forgiveness TO service_role;

-- Check:
SELECT count(*) AS rows FROM public.late_fee_forgiveness;
