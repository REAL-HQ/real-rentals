-- =============================================================================
-- Email steps in the post-application follow-up
--
-- The seeded follow-up is SMS-only, and SMS cannot send until Twilio
-- credentials and A2P 10DLC registration are in place — days away. Email works
-- today (Resend is already configured), so this interleaves two email steps so
-- the sequence is useful immediately and gets better, not different, when SMS
-- comes online.
--
-- Resulting order, by delay:
--   1. email   5 min   — acknowledge, set expectations
--   2. sms     5 min   — same beat, dormant until Twilio
--   3. sms     1 day
--   4. email   2 days  — nudge, carries the day-1/day-3 gap while SMS is dark
--   5. sms     3 days
--
-- Guarded and idempotent: it does nothing if the workflow already has an email
-- step, so a re-run — or an operator who has already edited the sequence by
-- hand — is left alone.
-- =============================================================================

DO $$
DECLARE
  wf_id uuid;
BEGIN
  SELECT id INTO wf_id
  FROM public.automation_workflows
  WHERE trigger_event = 'application_submitted'
  ORDER BY created_at
  LIMIT 1;

  IF wf_id IS NULL THEN
    RAISE NOTICE 'No application_submitted workflow found; nothing to do.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.automation_steps WHERE workflow_id = wf_id AND channel = 'email') THEN
    RAISE NOTICE 'Workflow already has an email step; leaving the sequence alone.';
    RETURN;
  END IF;

  -- Renumber through a temporary offset. step_order is uniquely indexed per
  -- workflow, so shifting in place would collide mid-update.
  UPDATE public.automation_steps SET step_order = step_order + 100 WHERE workflow_id = wf_id;

  UPDATE public.automation_steps SET step_order = 2 WHERE workflow_id = wf_id AND step_order = 101;
  UPDATE public.automation_steps SET step_order = 3 WHERE workflow_id = wf_id AND step_order = 102;
  UPDATE public.automation_steps SET step_order = 5 WHERE workflow_id = wf_id AND step_order = 103;

  -- Anything beyond the three seeded steps keeps its relative order after 5.
  UPDATE public.automation_steps
     SET step_order = step_order - 95
   WHERE workflow_id = wf_id AND step_order > 103;

  INSERT INTO public.automation_steps (workflow_id, step_order, delay_minutes, channel, subject, body)
  VALUES (
    wf_id, 1, 5, 'email',
    'We got your application, {{first_name}}',
    'Hi {{first_name}},' || chr(10) || chr(10) ||
    'Thanks for applying to rent with REAL RENTALS. Your application is in and we are reviewing it now.' || chr(10) || chr(10) ||
    'What happens next: a member of our team will reach out to confirm a few details and match you with a vehicle. Most drivers are on the road within a few days.' || chr(10) || chr(10) ||
    'If anything changes or you have a question in the meantime, just reply to this email — it comes straight to us.' || chr(10) || chr(10) ||
    'REAL RENTALS' || chr(10) ||
    '(813) 699-9118'
  );

  INSERT INTO public.automation_steps (workflow_id, step_order, delay_minutes, channel, subject, body)
  VALUES (
    wf_id, 4, 2880, 'email',
    'Still holding a spot for you in {{city}}',
    'Hi {{first_name}},' || chr(10) || chr(10) ||
    'Your application with REAL RENTALS is still open. We have vehicles available in {{city}} and we would rather not give your spot away.' || chr(10) || chr(10) ||
    'If you are still interested, reply to this email or call us at (813) 699-9118 and we will finish this off in a few minutes.' || chr(10) || chr(10) ||
    'If your plans have changed, let us know and we will close it out — no hard feelings.' || chr(10) || chr(10) ||
    'REAL RENTALS'
  );

  RAISE NOTICE 'Added two email steps and renumbered the SMS steps around them.';
END $$;
