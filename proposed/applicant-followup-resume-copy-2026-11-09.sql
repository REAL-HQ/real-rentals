-- PREPARED, NOT RUN. Needs Dolmar's approval.
-- New Applicant Follow-Up (workflow 10abc873-e486-41d5-87ae-ab495460a847):
-- new copy that softly invites applicants to finish Part 2 with their own
-- {{resume_link}}, plus "Skip If Profile Is Complete" on the steps that carry
-- the link.
--
-- Run ONLY AFTER both:
--   1. supabase/migrations/20261109200000_automation_step_skip_when_profile_complete.sql
--      is applied (this file sets that column), and
--   2. the {{resume_link}} code is published. Before that, the token renders
--      as an empty string and applicants would read "here: ." with no link.
-- Does not turn the workflow on. Steps' order, delays, channels, is_active
-- are unchanged. Each UPDATE is pinned to step id AND workflow id.
BEGIN;

-- Step 1 · Email · 5 min · skip if complete
UPDATE public.automation_steps SET
  subject = 'We Got Your Application, {{first_name}}',
  body = $b$Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? If you haven't already, consider finishing the rest of your profile here: {{resume_link}}

Adding your driver's license, insurance and address now helps us qualify you sooner. The link is private to you and works for 14 days. If you've already done it, you're all set.

What happens next: a member of our team will reach out to confirm a few details and match you with a vehicle.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}$b$,
  skip_when_profile_complete = true
WHERE id = '76c4268c-5af4-4eea-9951-e9dcac9f4dbe' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 2 · SMS · 5 min · skip if complete (~286 chars rendered)
UPDATE public.automation_steps SET
  body = $b$Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! If you haven't yet, finish your profile (license, insurance, address) here so we can qualify you sooner: {{resume_link}} Already done? You're all set. Reply STOP to opt out.$b$,
  skip_when_profile_complete = true
WHERE id = '0a5d1ff8-c244-4baa-8404-f3ee7a4f1e9b' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 3 · SMS · 1 day · skip if complete (~282 chars rendered)
UPDATE public.automation_steps SET
  body = $b$Hi {{first_name}}, REAL RENTALS here. Your application is open and we're on it. If you haven't added your license and insurance yet, consider finishing here: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.$b$,
  skip_when_profile_complete = true
WHERE id = '5b74cbc3-f4ab-4de3-b570-c6027f238eff' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 4 · Email · 2 days · NOT skipped (general check-in, no link)
UPDATE public.automation_steps SET
  subject = 'Checking In on Your REAL RENTALS Application',
  body = $b$Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you have any questions, reply to this email or call us at {{company_phone}} and we'll help you wrap things up.

If your plans have changed, let us know and we'll close it out. No hard feelings.

REAL RENTALS$b$,
  skip_when_profile_complete = false
WHERE id = 'd6dfc65c-2c5f-41ae-a242-f27277c55ffd' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 5 · SMS · 3 days · skip if complete (~287 chars rendered)
UPDATE public.automation_steps SET
  body = $b$Hi {{first_name}}, REAL RENTALS here. Your rental application is still open. If you'd still like a car, you can finish your profile here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.$b$,
  skip_when_profile_complete = true
WHERE id = '3db206a9-aaee-4308-ae27-980ae5be19bb' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Expect 5 rows, delays 5/5/1440/2880/4320, skip t/t/t/f/t.
SELECT step_order, channel, delay_minutes, skip_when_profile_complete, subject, length(body) AS body_len
  FROM public.automation_steps
 WHERE workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
 ORDER BY step_order;
COMMIT;
