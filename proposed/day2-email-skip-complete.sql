-- PROPOSED, NOT APPLIED. Approved by Dolmar for go-live (card t310s1681); run only at the go-live he signs off on (SOP D11, decided Nov 16 2026).
-- The day-2 "Checking In on Your REAL RENTALS Application" email (M12) is
-- skipped for applicants whose documents are complete, the same way the
-- 5-minute email already is. Uses the existing skip_when_profile_complete flag.
-- Checked read-only Nov 16 2026: this step is currently false; step 1 is true.
UPDATE public.automation_steps
SET skip_when_profile_complete = true, updated_at = now()
WHERE id = 'd6dfc65c-2c5f-41ae-a242-f27277c55ffd';
-- Undo: same statement with false.
