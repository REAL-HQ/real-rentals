/**
 * New Applicant Follow-Up copy (the 5-minute and day 1/2/3 messages).
 *
 * The live copy is stored in the database (public.automation_steps, workflow
 * 10abc873-e486-41d5-87ae-ab495460a847), not in code. This file is the
 * reviewed source for it: proposed/applicant-followup-gig-screenshot-copy-2026-11-14.sql
 * writes exactly these bodies, and only after Dolmar approves it.
 *
 * Asks for the gig app profile screenshot (number of trips or deliveries and
 * the rating) as the main document, earnings screenshots optional. Never
 * names the insurance broker or carrier. Every text keeps the STOP line.
 */
export const APPLICANT_FOLLOWUP_WORKFLOW_ID = "10abc873-e486-41d5-87ae-ab495460a847";

export type FollowupStepCopy = {
  id: string;
  stepOrder: number;
  channel: "email" | "sms";
  delayMinutes: number;
  subject: string | null;
  body: string;
};

export const APPLICANT_FOLLOWUP_COPY: FollowupStepCopy[] = [
  {
    id: "76c4268c-5af4-4eea-9951-e9dcac9f4dbe",
    stepOrder: 1,
    channel: "email",
    delayMinutes: 5,
    subject: "We Got Your Application, {{first_name}}",
    body: `Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? Finish Step 2 here: {{resume_link}}

The main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. The link is private to you and works for 14 days. If you've already done it, you're all set.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}`,
  },
  {
    id: "0a5d1ff8-c244-4baa-8404-f3ee7a4f1e9b",
    stepOrder: 2,
    channel: "sms",
    delayMinutes: 5,
    subject: null,
    body: "Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! To qualify faster, upload a screenshot of your gig app profile showing your trips/deliveries and rating (earnings optional): {{resume_link}} Reply STOP to opt out.",
  },
  {
    id: "5b74cbc3-f4ab-4de3-b570-c6027f238eff",
    stepOrder: 3,
    channel: "sms",
    delayMinutes: 1440,
    subject: null,
    body: "Hi {{first_name}}, REAL RENTALS here. Your application is open. The main thing we need is your gig app profile screenshot with trips/deliveries and rating: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.",
  },
  {
    id: "d6dfc65c-2c5f-41ae-a242-f27277c55ffd",
    stepOrder: 4,
    channel: "email",
    delayMinutes: 2880,
    subject: "Checking In on Your REAL RENTALS Application",
    body: `Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you haven't sent it yet, the main thing we need is a screenshot of your gig app profile showing your number of trips or deliveries and your rating. Earnings screenshots are optional. You can reply to this email with it.

Questions? Reply here or call us at {{company_phone}}. If your plans have changed, let us know and we'll close it out.

REAL RENTALS`,
  },
  {
    id: "3db206a9-aaee-4308-ae27-980ae5be19bb",
    stepOrder: 5,
    channel: "sms",
    delayMinutes: 4320,
    subject: null,
    body: "Hi {{first_name}}, REAL RENTALS here. Still want a car? Send your gig app profile screenshot (trips/deliveries and rating) here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.",
  },
];

/** Live copy read from production on 2026-11-14 (read-only), kept for the before/after review. */
export const APPLICANT_FOLLOWUP_COPY_BEFORE: Record<string, { subject: string | null; body: string }> = {
  "76c4268c-5af4-4eea-9951-e9dcac9f4dbe": {
    subject: "We Got Your Application, {{first_name}}",
    body: `Hi {{first_name}},

Thanks for applying to rent with REAL RENTALS. Your application is in, and our team is reviewing it now.

Want to get on the road faster? If you haven't already, consider finishing the rest of your profile here: {{resume_link}}

Adding your driver's license, insurance and address now helps us qualify you sooner. The link is private to you and works for 14 days. If you've already done it, you're all set.

What happens next: a member of our team will reach out to confirm a few details and match you with a vehicle.

Questions? Just reply to this email. It comes straight to us.

REAL RENTALS
{{company_phone}}`,
  },
  "0a5d1ff8-c244-4baa-8404-f3ee7a4f1e9b": {
    subject: null,
    body: "Hi {{first_name}}, it's REAL RENTALS. Thanks for applying! If you haven't yet, finish your profile (license, insurance, address) here so we can qualify you sooner: {{resume_link}} Already done? You're all set. Reply STOP to opt out.",
  },
  "5b74cbc3-f4ab-4de3-b570-c6027f238eff": {
    subject: null,
    body: "Hi {{first_name}}, REAL RENTALS here. Your application is open and we're on it. If you haven't added your license and insurance yet, consider finishing here: {{resume_link}} Questions? Call {{company_phone}}. Reply STOP to opt out.",
  },
  "d6dfc65c-2c5f-41ae-a242-f27277c55ffd": {
    subject: "Checking In on Your REAL RENTALS Application",
    body: `Hi {{first_name}},

Just checking in. Your application with REAL RENTALS is still open, and we'd love to help you get on the road.

If you have any questions, reply to this email or call us at {{company_phone}} and we'll help you wrap things up.

If your plans have changed, let us know and we'll close it out. No hard feelings.

REAL RENTALS`,
  },
  "3db206a9-aaee-4308-ae27-980ae5be19bb": {
    subject: null,
    body: "Hi {{first_name}}, REAL RENTALS here. Your rental application is still open. If you'd still like a car, you can finish your profile here: {{resume_link}} or call {{company_phone}}. Plans changed? Just let us know. Reply STOP to opt out.",
  },
};
