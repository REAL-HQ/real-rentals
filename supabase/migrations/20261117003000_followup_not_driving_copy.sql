-- New Applicant Follow-Up: proof-of-income wording for not-yet / No / Pending
-- gig drivers (Dolmar, t352u). Gig drivers keep the existing body, word for word.
-- automations.server.ts sends body_not_driving / subject_not_driving to an
-- applicant whose gig_status is set and does not start with "Yes"; a step with
-- no alternate wording sends its ordinary body to everyone.
ALTER TABLE public.automation_steps
  ADD COLUMN IF NOT EXISTS body_not_driving text,
  ADD COLUMN IF NOT EXISTS subject_not_driving text;

COMMENT ON COLUMN public.automation_steps.body_not_driving IS
  'Alternate body for applicants not driving for a gig app yet (gig_status set, not "Yes..."). Null = same body for everyone.';

-- Step 1 (email, 5 min). Normally replaced by the Step 1 thank-you email when that automation is on.
UPDATE public.automation_steps SET body_not_driving = $b$Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? Finish Step 2 here: {{resume_link}}

The main thing we need is your proof of income (an income document or an earnings screenshot). The link is private to you and works for 14 days. If you've already done it, you're all set.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}$b$
WHERE id = '76c4268c-5af4-4eea-9951-e9dcac9f4dbe' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 2 (text, 5 min)
UPDATE public.automation_steps SET body_not_driving = $b$Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! To qualify faster, upload your proof of income (an income document or an earnings screenshot): {{resume_link}} Reply STOP to opt out.$b$
WHERE id = '0a5d1ff8-c244-4baa-8404-f3ee7a4f1e9b' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 3 (text, day 1)
UPDATE public.automation_steps SET body_not_driving = $b$Hi {{first_name}}, REAL RENTALS here. Your application is open. The main thing we need is your proof of income (an income document or an earnings screenshot): {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.$b$
WHERE id = '5b74cbc3-f4ab-4de3-b570-c6027f238eff' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 4 (email, day 2)
UPDATE public.automation_steps SET body_not_driving = $b$Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you haven't sent it yet, the main thing we need is your proof of income (an income document or an earnings screenshot). You can reply to this email with it.

Questions? Reply here or call us at {{company_phone}}. If your plans have changed, let us know and we'll close it out.

REAL RENTALS$b$
WHERE id = 'd6dfc65c-2c5f-41ae-a242-f27277c55ffd' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';

-- Step 5 (text, day 3)
UPDATE public.automation_steps SET body_not_driving = $b$Hi {{first_name}}, REAL RENTALS here. Still want a car? Send your proof of income (an income document or an earnings screenshot) here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.$b$
WHERE id = '3db206a9-aaee-4308-ae27-980ae5be19bb' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847';
