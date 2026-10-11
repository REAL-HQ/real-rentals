-- =============================================================================
-- Contact Status (Phase 1A)
--
-- Where the CONVERSATION with a person stands: did we reach them, are they
-- interested, when are we calling back. This is NOT applications.status, which
-- is the lifecycle of the paperwork and is read by approval, activation and
-- agreements. The two are deliberately separate, and this migration does not
-- touch the other one: no status value is renamed, no row's status is changed,
-- no trigger or policy on the lifecycle is altered.
--
-- Additive and reversible. Five columns, one CHECK, one index. Every column is
-- nullable or defaulted, so existing rows need no back-fill:
--
--   contact_status        defaults to 'new', so all 'N' applicants already on
--                         file — and every applicant created from now on —
--                         read as New without anybody touching them.
--   contact_status_note   what was said / what is outstanding / why not.
--   contact_follow_up_on  a DATE, not a timestamp: "call her Tuesday" is a
--                         calendar day, and storing it as an instant is how a
--                         follow-up ends up a day early in another timezone.
--   contact_status_at     when it was last set.
--   contact_status_by     who set it (auth user id), left unconstrained by a
--                         foreign key so removing a staff account never
--                         deletes or blocks the record of what they did.
--
-- No new RLS policy is needed or wanted. applications already carries
--   "Staff view applications"   SELECT  private.is_staff()
--   "Staff update applications" UPDATE  private.is_staff()
-- which is exactly the intended audience (Owner, Manager, Coordinator), and a
-- driver has only "Users can view their own application" — SELECT, never
-- UPDATE — so no applicant can set their own contact status, and anon has
-- neither. The server function checks the tier again on its own account,
-- because it writes through the service role, which bypasses RLS.
--
-- History is audit_log, under action 'contact_status.set'. audit_log has no
-- INSERT policy or grant for `authenticated`, so the record of who changed
-- what cannot be forged or erased from a browser session.
-- =============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS contact_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS contact_status_note text,
  ADD COLUMN IF NOT EXISTS contact_follow_up_on date,
  ADD COLUMN IF NOT EXISTS contact_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_status_by uuid;

-- The nine Phase 1A statuses, and nothing else. A typo in a hand-written
-- UPDATE is refused here rather than appearing in the list as a blank badge.
-- Adding a status later is one ALTER ... DROP CONSTRAINT / ADD CONSTRAINT.
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_contact_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_contact_status_check
  CHECK (contact_status IN (
    'new', 'attempted', 'voicemail', 'contacted', 'interested',
    'follow_up', 'documents', 'unqualified', 'unresponsive'
  ));

COMMENT ON COLUMN public.applications.contact_status IS
  'Contact Status: where the conversation stands. Separate from applications.status (the application lifecycle); nothing in approval, activation or agreements reads this.';
COMMENT ON COLUMN public.applications.contact_follow_up_on IS
  'Calendar day staff said they would come back to this person. Date, not timestamp.';

-- The Drivers list filters on it and Rosa sorts her day by the follow-up date.
-- Partial on the dates, because most rows have none.
CREATE INDEX IF NOT EXISTS applications_contact_status_idx
  ON public.applications (contact_status);
CREATE INDEX IF NOT EXISTS applications_contact_follow_up_idx
  ON public.applications (contact_follow_up_on)
  WHERE contact_follow_up_on IS NOT NULL;
