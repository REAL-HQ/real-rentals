-- LOCAL PROPOSAL. Not a migration. Do not run against a hosted database.
-- NOT EXECUTED.
--
-- incidents already stores the car, the driver (application_id), the type,
-- occurred_at, and status. status has no CHECK constraint. The allowed values
-- are the column comment: open | in_claim | repairing | closed | written_off.
-- This file does not add a constraint and does not change those values.
--
-- Roadside reports live in public.issues. issues has no incident_id, and
-- incidents has no issue_id, so the board cannot show a stored link.
-- Until this column exists the board shows Unknown and does not match an
-- issue by vehicle, driver, or time.

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS incidents_issue_idx
  ON public.incidents (issue_id) WHERE issue_id IS NOT NULL;
