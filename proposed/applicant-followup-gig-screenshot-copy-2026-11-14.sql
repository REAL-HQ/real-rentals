-- PREPARED, NOT RUN. Needs Dolmar's approval. Do not copy into supabase/migrations.
--
-- New Applicant Follow-Up (workflow 10abc873-e486-41d5-87ae-ab495460a847), the 5-minute and day 1/2/3
-- messages: ask for the gig app profile screenshot (number of trips or
-- deliveries and the rating) instead of "license, insurance, address".
-- Earnings screenshots optional. No insurance broker or carrier named.
-- Every text keeps "Reply STOP to opt out."
--
-- Copy only: order, delays, channels, is_active, skip_when_profile_complete
-- and the workflow's on/off are unchanged. The follow-up texts stay ON.
-- Each UPDATE is pinned to step id, workflow id AND the current body, so it
-- changes nothing if anyone has edited a step since 2026-11-14.
-- Source of truth: src/lib/applicant-followup-copy.ts (tests keep them equal).
BEGIN;

-- Step 1 · Email · 5 min
-- BEFORE (subject: We Got Your Application, {{first_name}}):
--   Hi {{first_name}},
--
--   Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.
--
--   Want to get on the road faster? If you haven't already, consider finishing the rest of your profile here: {{resume_link}}
--
--   Adding your driver's license, insurance and address now helps us qualify you sooner. The link is private to you and works for 14 days. If you've already done it, you're all set.
--
--   What happens next: a member of our team will reach out to confirm a few details and match you with a vehicle.
--
--   Questions? Just reply to this email. It comes straight to us.
--
--   REAL RENTALS
--   {{company_phone}}
-- AFTER (subject: We Got Your Application, {{first_name}}):
--   Hi {{first_name}},
--
--   Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.
--
--   Want to get on the road faster? Finish Step 2 here: {{resume_link}}
--
--   The main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. The link is private to you and works for 14 days. If you've already done it, you're all set.
--
--   Questions? Just reply to this email. It comes straight to us.
--
--   REAL RENTALS
--   {{company_phone}}
UPDATE public.automation_steps SET
  subject = 'We Got Your Application, {{first_name}}',
  body = $b$Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? Finish Step 2 here: {{resume_link}}

The main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. The link is private to you and works for 14 days. If you've already done it, you're all set.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}$b$
WHERE id = '76c4268c-5af4-4eea-9951-e9dcac9f4dbe' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
  AND body = $old$Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? If you haven't already, consider finishing the rest of your profile here: {{resume_link}}

Adding your driver's license, insurance and address now helps us qualify you sooner. The link is private to you and works for 14 days. If you've already done it, you're all set.

What happens next: a member of our team will reach out to confirm a few details and match you with a vehicle.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}$old$;

-- Step 2 · SMS · 5 min
-- BEFORE:
--   Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! If you haven't yet, finish your profile (license, insurance, address) here so we can qualify you sooner: {{resume_link}} Already done? You're all set. Reply STOP to opt out.
-- AFTER:
--   Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! To qualify faster, upload a screenshot of your gig app profile showing your trips/deliveries and rating (earnings optional): {{resume_link}} Reply STOP to opt out.
UPDATE public.automation_steps SET
  subject = NULL,
  body = $b$Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! To qualify faster, upload a screenshot of your gig app profile showing your trips/deliveries and rating (earnings optional): {{resume_link}} Reply STOP to opt out.$b$
WHERE id = '0a5d1ff8-c244-4baa-8404-f3ee7a4f1e9b' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
  AND body = $old$Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! If you haven't yet, finish your profile (license, insurance, address) here so we can qualify you sooner: {{resume_link}} Already done? You're all set. Reply STOP to opt out.$old$;

-- Step 3 · SMS · 1440 min
-- BEFORE:
--   Hi {{first_name}}, REAL RENTALS here. Your application is open and we're on it. If you haven't added your license and insurance yet, consider finishing here: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.
-- AFTER:
--   Hi {{first_name}}, REAL RENTALS here. Your application is open. The main thing we need is your gig app profile screenshot with trips/deliveries and rating: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.
UPDATE public.automation_steps SET
  subject = NULL,
  body = $b$Hi {{first_name}}, REAL RENTALS here. Your application is open. The main thing we need is your gig app profile screenshot with trips/deliveries and rating: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.$b$
WHERE id = '5b74cbc3-f4ab-4de3-b570-c6027f238eff' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
  AND body = $old$Hi {{first_name}}, REAL RENTALS here. Your application is open and we're on it. If you haven't added your license and insurance yet, consider finishing here: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.$old$;

-- Step 4 · Email · 2880 min
-- BEFORE (subject: Checking In on Your REAL RENTALS Application):
--   Hi {{first_name}},
--
--   Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.
--
--   If you have any questions, reply to this email or call us at {{company_phone}} and we'll help you wrap things up.
--
--   If your plans have changed, let us know and we'll close it out. No hard feelings.
--
--   REAL RENTALS
-- AFTER (subject: Checking In on Your REAL RENTALS Application):
--   Hi {{first_name}},
--
--   Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.
--
--   If you haven't sent it yet, the main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. You can reply to this email with it.
--
--   Questions? Reply here or call us at {{company_phone}}. If your plans have changed, let us know and we'll close it out.
--
--   REAL RENTALS
UPDATE public.automation_steps SET
  subject = 'Checking In on Your REAL RENTALS Application',
  body = $b$Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you haven't sent it yet, the main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. You can reply to this email with it.

Questions? Reply here or call us at {{company_phone}}. If your plans have changed, let us know and we'll close it out.

REAL RENTALS$b$
WHERE id = 'd6dfc65c-2c5f-41ae-a242-f27277c55ffd' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
  AND body = $old$Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you have any questions, reply to this email or call us at {{company_phone}} and we'll help you wrap things up.

If your plans have changed, let us know and we'll close it out. No hard feelings.

REAL RENTALS$old$;

-- Step 5 · SMS · 4320 min
-- BEFORE:
--   Hi {{first_name}}, REAL RENTALS here. Your rental application is still open. If you'd still like a car, you can finish your profile here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.
-- AFTER:
--   Hi {{first_name}}, REAL RENTALS here. Still want a car? Send your gig app profile screenshot (trips/deliveries and rating) here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.
UPDATE public.automation_steps SET
  subject = NULL,
  body = $b$Hi {{first_name}}, REAL RENTALS here. Still want a car? Send your gig app profile screenshot (trips/deliveries and rating) here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.$b$
WHERE id = '3db206a9-aaee-4308-ae27-980ae5be19bb' AND workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
  AND body = $old$Hi {{first_name}}, REAL RENTALS here. Your rental application is still open. If you'd still like a car, you can finish your profile here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.$old$;

-- Expect 5 rows; none should still mention license/insurance/address.
SELECT step_order, channel, delay_minutes, is_active, skip_when_profile_complete, subject, length(body) AS body_len,
       body ILIKE '%gig app profile%' AS asks_gig_profile
  FROM public.automation_steps
 WHERE workflow_id = '10abc873-e486-41d5-87ae-ab495460a847'
 ORDER BY step_order;
COMMIT;
