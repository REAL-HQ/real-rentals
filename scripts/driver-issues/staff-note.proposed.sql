-- NOT APPLIED. Do not run this against a hosted database from the app.
--
-- public.issues already has status (text, default 'open'). It has no staff note.
-- A column on public.issues would be readable by the reporting driver: the
-- "Drivers read own issues" policy is row-level, and authenticated already has
-- table SELECT, so a column grant cannot hide it.
--
-- Notes live in their own table. Drivers have no policy on it. Managers are
-- the same admin/team roles that already manage public.issues. The inbox
-- keeps DRIVER_ISSUE_NOTES_ENABLED false until this is installed and the
-- server is changed to write it.

CREATE TABLE IF NOT EXISTS public.issue_staff_notes (
  issue_id uuid PRIMARY KEY REFERENCES public.issues(id) ON DELETE CASCADE,
  note text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.issue_staff_notes TO authenticated;
GRANT ALL ON public.issue_staff_notes TO service_role;

ALTER TABLE public.issue_staff_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage issue staff notes"
  ON public.issue_staff_notes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'team'));
