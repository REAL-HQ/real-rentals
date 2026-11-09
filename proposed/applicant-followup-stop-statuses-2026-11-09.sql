-- PREPARED, NOT RUN. Needs Dolmar's approval. Independent of the code PR.
-- New Applicant Follow-Up stops nudging applicants whose status is any of
-- these. Today's list (approved, rejected, active) misses the statuses the
-- app actually uses for "done with this applicant": declined, closed,
-- duplicate ("rejected" is never set in prod; kept for safety).
-- Also corrects the description (step 1 is an email; there is a 2-day email).
-- Does not change is_active, steps, quiet hours or stop_on_reply.
BEGIN;
UPDATE public.automation_workflows SET
  stop_on_statuses = ARRAY['approved','rejected','declined','closed','duplicate','active']::text[],
  description = 'Emails and texts a new applicant within minutes, then follows up at 1, 2 and 3 days until they finish or are approved.'
WHERE id = '10abc873-e486-41d5-87ae-ab495460a847';
SELECT id, is_active, stop_on_statuses, description FROM public.automation_workflows
 WHERE id = '10abc873-e486-41d5-87ae-ab495460a847';
COMMIT;
