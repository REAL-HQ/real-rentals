-- =============================================================================
-- Automation steps: "Skip If Profile Is Complete"
--
-- New Applicant Follow-Up messages now nudge applicants to finish Part 2 of
-- their application (license, insurance, address) with their own resume link.
-- Someone who already finished Part 2 (applications.current_step =
-- 'profile_complete') should not be asked to do it again. A step with this
-- flag is not sent to them; the sequence still moves on to the next step.
--
-- Additive only. Defaults to false, so every existing step behaves exactly as
-- before until a step is edited to opt in. No data is rewritten, nothing sends.
-- The engine reads steps with select("*"), so code shipped before or after
-- this migration works either way.
-- =============================================================================

ALTER TABLE public.automation_steps
  ADD COLUMN IF NOT EXISTS skip_when_profile_complete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.automation_steps.skip_when_profile_complete IS
  'When true, this step is not sent to applicants whose current_step is profile_complete; the enrollment still advances to the next step.';
