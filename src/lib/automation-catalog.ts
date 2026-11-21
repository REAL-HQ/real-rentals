// Back Office → Settings → Automations: the catalog of every automated email
// and text the app can send on its own. Client-safe: names, copy and the one
// parse rule for the on/off setting. No secrets, no sending.
//
// How a switch works (see automation-controls.server.ts):
//   * Stored in public.app_settings under AUTOMATION_CONTROLS_KEY as
//     { off: { <key>: { at, by } } }. No row, or a key not listed, is ON —
//     today's behaviour, so installing this changes nothing until an Owner
//     turns something off.
//   * If the row cannot be read or is malformed, catalogued sends are HELD
//     (not sent, recorded as failed "Held: ..."), never sent as if on.
//   * The switch is checked at dispatch time inside sendEmail (by the
//     email's tracked workflow name) and again by the cron routes before they
//     record a reminder, so OFF means nothing is sent or logged as sent.
//   * Turning something back ON never replays what was skipped: the payment
//     reminders send only the stage owed today, recovery emails only reach
//     drafts still inside their 24h / 72h window (max 10 per hour), and the
//     applicant workflow only enrolls applications submitted after it is on.
//
// Some entries use an existing control instead of this setting, so there is
// one switch per thing: the New Applicant Follow-Up workflow uses
// automation_workflows.is_active, and the lead alerts use the
// notifications.alert_on_new / alert_on_complete fields Settings already had.

export const AUTOMATION_CONTROLS_KEY = "automation_controls";

export type AutomationAudience = "Applicants" | "Renters" | "Team";
export type AutomationChannel = "Email" | "SMS";

/** Where the on/off switch lives. "code" means it cannot be turned on from the back office. */
export type AutomationControl =
  | { kind: "setting" }
  | { kind: "workflow"; trigger: string }
  | { kind: "notifications"; field: "alert_on_new" | "alert_on_complete" }
  | { kind: "code"; reason: string };

export type AutomationDef = {
  key: string;
  title: string;
  audience: AutomationAudience;
  channels: AutomationChannel[];
  /** Plain-language trigger. */
  trigger: string;
  /** Plain-language cadence. */
  cadence: string;
  /** email_deliveries.workflow names this entry sends (and is gated by). */
  emailWorkflows: string[];
  /** cron.job name that drives it, when it is scheduled. */
  cronJob?: string;
  control: AutomationControl;
  /** Template previews rendered with sample data (see previewAutomationTemplate). */
  previews: string[];
  note?: string;
  /**
   * false = OFF until an Owner turns it on. Used for sends that have never
   * actually gone out (their daily job has always failed), so fixing that job
   * cannot start them by surprise.
   */
  defaultOn?: false;
};

export const AUTOMATIONS: AutomationDef[] = [
  {
    key: "new_applicant_followup",
    title: "New Applicant Follow-Up",
    audience: "Applicants",
    channels: ["SMS", "Email"],
    trigger: "Someone completes an application.",
    cadence: "Steps as set in the workflow below. Stops when they reply or are approved, rejected or active.",
    emailWorkflows: [],
    cronJob: "automations-every-5-min",
    control: { kind: "workflow", trigger: "application_submitted" },
    previews: [],
    note: "Only applications submitted after it is turned on are enrolled. Texts need SMS consent and respect STOP and quiet hours (9 PM–8 AM ET).",
  },
  {
    key: "step1_thank_you_email",
    title: "Step 1 Thank-You Email",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "Someone sends Step 1 of a new application (a new lead, not a returning one).",
    cadence: "Once per new application, right after Step 1, from team@drivereal.com.",
    emailWorkflows: ["application_step1_thank_you"],
    control: { kind: "setting" },
    previews: ["step1_thank_you"],
    defaultOn: false,
    note: "Off until turned on. Explains Step 2, what to have ready and why, with a Continue to Step 2 link. When it goes out, the follow-up's 5-minute welcome email is skipped for that applicant (within 24 hours) so nobody gets two; the follow-up texts and later emails are unchanged. Never names the insurance company.",
  },
  {
    key: "missing_items_outreach",
    title: "Missing Items Follow-Up",
    audience: "Applicants",
    channels: ["SMS", "Email"],
    trigger: "An applicant (New or In Review) is still missing something they can send us: a few quick answers about the car they want, license photo (front), gig profile screenshot, or proof of income (gig work or any other source).",
    cadence: "After 24 hours with no activity, then a reminder at 3 days and a last one at 7 days, then it stops. Starts over only if what's missing changes (at most 2 rounds). 9 AM–8 PM ET, at most 25 per run. Defaults in app_settings 'missing_items_outreach'.",
    emailWorkflows: ["application_missing_items"],
    cronJob: "automations-every-5-min",
    control: { kind: "setting" },
    previews: ["missing_items_1", "missing_items_2", "missing_items_3"],
    defaultOn: false,
    note: "Off until turned on. Lists only what that applicant is missing, with their private 14-day upload link. Skips anyone in the New Applicant Follow-Up, anyone messaged in the last 48 hours, declined, closed, duplicate, approved or active applicants, and applications older than 60 days. Texts need SMS consent, come from the 888 line and respect STOP. Never asks for anything only staff can do (background check, MVR).",
  },
  {
    key: "missing_items_backfill",
    title: "Missing Items Message (One-Time)",
    audience: "Applicants",
    channels: ["SMS", "Email"],
    trigger: "Run once from FLEET for existing applicants who are missing items.",
    cadence: "One message per applicant, ever. Sent in batches when FLEET runs it, 9 AM–8 PM ET.",
    emailWorkflows: ["application_missing_items_once"],
    control: { kind: "setting" },
    previews: ["missing_items_1"],
    defaultOn: false,
    note: "Off until turned on. Same message and rules as Missing Items Follow-Up step 1. Each applicant can get it at most once (enforced by the database), and anyone who got it is not messaged again by the follow-up for the same missing items. Turn it back off after the backfill.",
  },
  {
    key: "missing_items_autoclose",
    title: "Missing Items Auto-Close",
    audience: "Applicants",
    channels: ["SMS", "Email"],
    trigger: "No reply within 14 days of the last Missing Items message (the 7-day reminder, or the one-time message).",
    cadence: "Once per applicant: moves them to Closed (never Declined) and sends one come-back-anytime message with their link. Opening the link reopens the application where they left off. 9 AM–8 PM ET. Days in app_settings 'missing_items_outreach' (autoCloseDays).",
    emailWorkflows: ["application_missing_items_closed"],
    cronJob: "automations-every-5-min",
    control: { kind: "setting" },
    previews: ["missing_items_closed"],
    defaultOn: false,
    note: "Off until turned on. A reply means any sign of life after the last message: opening their link, an upload, or a text or call in. Skips anyone who is no longer New or In Review, has nothing missing, is in the follow-up, or is flagged. While on, the last Missing Items message says the application closes after 14 days with no reply.",
  },
  {
    key: "application_recovery",
    title: "Unfinished Application",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "An application draft is left unfinished.",
    cadence: "24 hours and 72 hours after the last activity, with the personal 14-day link. At most 10 per hour. The 3-hour Abandoned Quote email was dropped (D10, Nov 16 2026).",
    emailWorkflows: ["application_recovery"],
    cronJob: "wizard-recovery-hourly",
    control: { kind: "setting" },
    previews: ["recovery_24h", "recovery_72h", "recovery_abandoned"],
  },
  {
    key: "application_resume",
    title: "Resume Link",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "An applicant asks for their link, or applies again with the same email or phone.",
    cadence: "Once per request.",
    emailWorkflows: ["application_resume"],
    control: { kind: "setting" },
    previews: ["resume"],
    note: "Turning this off also stops links applicants ask for themselves.",
  },
  {
    key: "booking_login_email",
    title: "Pickup Booked Email",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "A car is Reserved for an approved applicant or renter (staff, FLEET, or the renter picking a pickup time).",
    cadence: "Once per reservation. Pickup details only; it never includes login details.",
    // Kept under its old key so the saved On/Off setting carries over.
    // Reserved checks gateFor("booking_login_email") before sendPickupBookedEmail.
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    note: "On by default. Sends the confirmed pickup details when Reserved is saved. Driver portal login details go out only once, in the Welcome To Your Driver Portal email after the rental is paid at pickup.",
  },
  {
    key: "portal_welcome_email",
    title: "Welcome To Your Driver Portal",
    audience: "Renters",
    channels: ["Email"],
    trigger: "The renter has picked up the car and the pickup rent is paid (at activation, or when that payment comes in).",
    cadence: "Once per renter, ever. Never for the $50 Reservation Fee.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    note: "On by default. The only email with driver portal login details (a set-password link). Turn off to hold it; nobody gets portal login details before pickup either way.",
  },
  {
    key: "approval_confirmation",
    title: "Approval Confirmation",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "A Manager, Owner or FLEET approves an applicant.",
    cadence: "Once when the applicant first becomes Approved. Re-approving to manage an agreement does not resend it.",
    emailWorkflows: ["approval_confirmation"],
    control: { kind: "setting" },
    previews: ["approval_confirmation"],
    note: "Confirms the vetting decision only. No vehicle is reserved; account login and pickup details still arrive at Reserved.",
  },
  {
    key: "lead_alert_new",
    title: "New Lead Alert",
    audience: "Team",
    channels: ["Email"],
    trigger: "Someone starts an application.",
    cadence: "Once per application, to the alert addresses in Notifications.",
    emailWorkflows: [],
    control: { kind: "notifications", field: "alert_on_new" },
    previews: ["lead_new"],
  },
  {
    key: "lead_alert_complete",
    title: "Completed Lead Alert",
    audience: "Team",
    channels: ["Email"],
    trigger: "Someone completes an application.",
    cadence: "Once per application, to the alert addresses in Notifications.",
    emailWorkflows: [],
    control: { kind: "notifications", field: "alert_on_complete" },
    previews: ["lead_complete"],
  },
  {
    key: "payment_team_alert",
    title: "Payment Alert",
    audience: "Team",
    channels: ["Email"],
    trigger: "A balance first goes past due, or a card charge fails.",
    cadence: "Once per due date or failed charge, to team@drivereal.com.",
    emailWorkflows: ["payment_team_alert"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: ["team_alert"],
  },
  {
    key: "collections_plan",
    title: "Collections Plan",
    audience: "Team",
    channels: ["Email"],
    trigger: "Payments are due today or tomorrow.",
    cadence: "Daily at 8:30 AM ET, to team@drivereal.com.",
    emailWorkflows: ["collections_plan"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: ["collections_plan"],
  },
  {
    key: "payment_failed",
    title: "Payment Failed",
    audience: "Renters",
    channels: ["Email"],
    trigger: "Stripe reports a declined charge.",
    cadence: "Once per failed charge.",
    emailWorkflows: ["payment_failed"],
    control: { kind: "setting" },
    previews: ["payment_failed"],
  },
  {
    key: "payment_failed_text",
    title: "Payment Failed Text",
    audience: "Renters",
    channels: ["SMS"],
    trigger: "Stripe reports a declined weekly invoice.",
    cadence: "Once per Stripe attempt, 8 AM to 9 PM ET. From the 888 line unless set to 813.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Texts only the failed invoice's own Stripe page, never a generic payment link. Skips renters who replied STOP.",
  },
  {
    key: "rent_reminder_due_tomorrow",
    title: "Rent Reminder: Due Tomorrow",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "The day before a rental's weekly due date.",
    cadence: "Once per week, from 10 AM ET. Autopay renters: card is charged tomorrow. Manual payers: amount and how to pay.",
    emailWorkflows: ["rent_reminder_due_tomorrow"],
    cronJob: "rent-reminders-hourly",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Autopay renters get a heads-up with no link. Manual payers get the amount and how to pay. Texts 8 AM to 9 PM ET; STOP is always honored.",
  },
  {
    key: "rent_reminder_due_today",
    title: "Rent Reminder: Due Today",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A manual payer's rent is due today and not yet recorded as paid.",
    cadence: "Once per week, from 8 AM ET. Not sent to autopay renters (their card is charged that day).",
    emailWorkflows: ["rent_reminder_due_today"],
    cronJob: "rent-reminders-hourly",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Manual payers only. Texts 8 AM to 9 PM ET; STOP is always honored.",
  },
  {
    key: "rent_reminder_overdue",
    title: "Rent Reminder: Overdue",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A Stripe charge failed, or rent is still unpaid at 6 PM ET on the due date.",
    cadence: "Once per failed week. States the $50/day late fee unless the week is waived. Shares one send with Payment Failed Text.",
    emailWorkflows: ["rent_reminder_overdue"],
    cronJob: "rent-reminders-hourly",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Autopay renters get only their failed invoice's own Stripe page. Only for failures after it is turned on; no catch-up. Left out of a waived week's late fee. Texts 8 AM to 9 PM ET; STOP is always honored.",
  },
  {
    key: "rent_reminder_daily",
    title: "Rent Reminder: Daily Past Due",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "Rent is still unpaid the day after the due date.",
    cadence: "Daily from 10 AM ET until paid. Autopay: invoice amount plus late fees owed separately. Manual: balance including late fees.",
    emailWorkflows: ["rent_reminder_daily"],
    cronJob: "rent-reminders-hourly",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Starts the day after the Overdue notice. Autopay renters get each unpaid invoice's own link and amount, with late fees stated separately; waived weeks add no fee. At most one rent text per renter per day. Texts 8 AM to 9 PM ET; STOP is always honored.",
  },
  {
    key: "stripe_link_reconciliation",
    title: "Stripe Link Check",
    audience: "Team",
    channels: ["Email"],
    trigger: "A paid Stripe invoice in the last 14 days has no payment row, or its customer is not linked to any rental.",
    cadence: "Daily at 8:30 AM ET, to team@drivereal.com, only when something needs linking.",
    emailWorkflows: ["stripe_link_reconciliation"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Read-only: it reports, and never changes Stripe or payments.",
  },
  {
    key: "stripe_subscription_link",
    title: "Subscription Matching",
    audience: "Team",
    channels: ["Email"],
    trigger: "A Stripe invoice arrives for a subscription no rental is linked to.",
    cadence: "Per invoice. Links it when exactly one active renter's email or phone matches; alerts team@ once per extra subscription.",
    emailWorkflows: ["duplicate_subscription_alert"],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Never changes or cancels anything in Stripe.",
  },
  {
    key: "payment_receipt",
    title: "Payment Receipt",
    audience: "Renters",
    channels: ["Email"],
    trigger: "Stripe reports a successful charge.",
    cadence: "Once per charge.",
    emailWorkflows: ["payment_receipt"],
    control: { kind: "setting" },
    previews: ["payment_receipt"],
  },
  {
    key: "card_expiring",
    title: "Card Expiring",
    audience: "Renters",
    channels: ["Email"],
    trigger: "Stripe reports the card on file is about to expire.",
    cadence: "Once per notice from Stripe.",
    emailWorkflows: ["card_expiring"],
    control: { kind: "setting" },
    previews: ["card_expiring"],
  },
  {
    key: "license_expiring",
    title: "License Expiring",
    audience: "Renters",
    channels: ["Email"],
    trigger: "A renter's license expires within 30 days.",
    cadence: "Daily check at 8:30 AM ET, at most once every 6 days.",
    emailWorkflows: ["license_expiring"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: ["license_expiring"],
  },
  {
    key: "held_retry",
    title: "Held Retry",
    audience: "Renters",
    channels: ["Email"],
    trigger: "A payment notice was held because these switches could not be read.",
    cadence: "Every 5 minutes, once per notice, within 7 days.",
    emailWorkflows: [],
    cronJob: "automations-every-5-min",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Needs the held-notices migration.",
  },
  {
    key: "agreement_reminder",
    title: "Agreement Reminder",
    audience: "Renters",
    channels: ["Email"],
    trigger: "A rental agreement sent more than 3 days ago is still unsigned.",
    cadence: "Daily at 8:30 AM ET, at most once every 6 days per renter.",
    emailWorkflows: ["agreement_reminder"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. It has never sent, because its daily job has always failed.",
  },
  {
    key: "pickup_reminders",
    title: "Pickup Reminders",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A pickup is booked: a text right after booking, the evening before, and 2 hours before.",
    cadence: "Every 5 minutes, once per step. Texts 8 AM to 9 PM ET only; email when the renter has no SMS consent (not for the booking text, the booking email covers it).",
    emailWorkflows: ["pickup_reminder"],
    cronJob: "renter-reminders-every-5-min",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Needs proposed/renter-reminders-v1.sql.",
  },
  {
    key: "late_pickup_release",
    title: "Late Pickup Release",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A renter is 30 minutes past their pickup time and no pickup checklist has been started: the reservation is released, the car goes back to Available, the Reservation Fee is kept, staff get a team alert and the renter gets one text.",
    cadence: "Every 5 minutes, once per reservation. Renter text 8 AM to 9 PM ET only, from the main line; email when the renter has no SMS consent.",
    emailWorkflows: ["late_pickup_release"],
    cronJob: "renter-reminders-every-5-min",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Renter wording needs Dolmar's OK. Needs proposed/renter-reminders-v1.sql.",
  },
  {
    key: "agreement_sign_texts",
    title: "Agreement Sign Texts",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A rental agreement is still unsigned 4 hours after it was sent, and again at 9 AM ET the next morning.",
    cadence: "Every 5 minutes, once per step. Texts 8 AM to 9 PM ET only; email when the renter has no SMS consent.",
    emailWorkflows: ["agreement_sign_reminder"],
    cronJob: "renter-reminders-every-5-min",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Needs proposed/renter-reminders-v1.sql.",
  },
  {
    key: "service_digest",
    title: "Service Digest",
    audience: "Team",
    channels: ["Email"],
    trigger: "Vehicles are due for service, or driver documents expire within 30 days.",
    cadence: "Daily at 8:30 AM ET, to team@drivereal.com.",
    emailWorkflows: ["service_digest"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. It has never sent, because its daily job has always failed.",
  },
  {
    key: "document_expiring",
    title: "Document Expiring",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A renter document is about to expire.",
    cadence: "Not running.",
    emailWorkflows: [],
    control: { kind: "code", reason: "Built but switched off in code. Needs a release to turn on." },
    previews: [],
  },
  {
    key: "rental_ended_notice",
    title: "Rental Ended Notice",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "Staff end a rental (car returned).",
    cadence: "Once per rental: an email, plus a text from the main line when the renter has SMS consent.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on (SOP D14; approved for go-live, card t310s1681). Needs proposed/renter-reminders-v1.sql (once-per-rental claim table).",
  },
  {
    key: "rental_lifecycle",
    title: "Rental Notices",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "A rental starts or ends, or an incident is logged.",
    cadence: "Not running.",
    emailWorkflows: [],
    control: { kind: "code", reason: "Built but switched off in the server environment. Needs a release to turn on." },
    previews: [],
  },
  {
    key: "fleet_link_resends",
    title: "FLEET Link Resends",
    audience: "Applicants",
    channels: ["SMS", "Email"],
    trigger: "FLEET asks the site to resend an applicant's upload link (files still missing) or a renter's agreement signing link (sent, not signed).",
    cadence: "Only when FLEET asks. Signing link: not within 4 hours of the last send, at most 3 FLEET resends a week. Upload link: not within 24 hours of any missing-items message. 8 AM–9 PM ET only.",
    emailWorkflows: ["fleet_upload_link_resend"],
    control: { kind: "setting" },
    previews: ["missing_items_1"],
    defaultOn: false,
    note: "Off until turned on. Same wording renters already get: the staff Resend signing email and text, and the Missing Items step-1 message. Texts come from the 888 line, need SMS consent and respect STOP. Refused while someone is handed off to staff.",
  },
  {
    key: "rental_agreement_amendments",
    title: "Updated Agreements (FLEET)",
    audience: "Renters",
    channels: ["SMS", "Email"],
    trigger: "FLEET asks the site to send an updated rental agreement to an active rental, for example a new weekly rate the renter agreed to.",
    cadence: "Only when FLEET asks. 8 AM–9 PM ET only. One open updated agreement per rental. FLEET may propose $200–$1,000/week; anything else is for staff.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Needs proposed/rental-rate-amendments-v1.sql. Sends the same agreement and signing link staff send, with the new rate and an amendment notice. The new rate starts only after the renter signs, from the effective date or the next rent week, never back-dated; Stripe is never changed automatically. A rate increase needs the renter's logged consent (a real text on our lines, or a call). Refused while someone is handed off to staff. Staff can always send one from the rental page (Send Updated Agreement).",
  },
  {
    key: "fleet_document_uploads",
    title: "Document Uploads (FLEET)",
    audience: "Team",
    channels: [],
    trigger: "FLEET files a document onto a driver's profile, for example a license photo or an old paper agreement sent to the team inbox.",
    cadence: "Only when FLEET asks. PDF, JPEG, PNG, WebP or HEIC, up to 20 MB. A repeat of the same file is not saved twice.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Files are team only and saved as not reviewed; nothing is verified or approved and the driver is not told. Signed agreements and rental applications are never filed this way (eSign and staff only); an old agreement goes under Other and never counts as the current one. A file staff already verified is never replaced. Every upload is in the audit log.",
  },
  {
    key: "rentid_report_imports",
    title: "RentID Reports (FLEET)",
    audience: "Team",
    channels: [],
    trigger: "FLEET files a RentID order (from the receipt emailed to team@) or its result and report file onto the driver's Screening tab.",
    cadence: "Only when FLEET asks. One record per driver per RentID order; a repeat updates it. The report file follows the Document Uploads (FLEET) switch.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Needs migration 20261121193000_rentid_reports.sql. A record, never a decision: nobody is approved, verified or declined, and the background check and license status stay with staff. Matched by the driver's id, or by the receipt's renter name only when exactly one applicant has that name. Team only; the driver is not told. Staff can always attach a report by hand (Screening tab, Attach RentID Report).",
  },
  {
    key: "renter_insurance_cards",
    title: "Insurance ID Cards To Portal",
    audience: "Renters",
    channels: [],
    trigger: "An emailed insurance ID card (the intake inbox, or a team inbox card FLEET hands over, Spam included) is read in Fleet Inbox and its VIN and name match exactly one renter on an active or reserved rental.",
    cadence: "Each time a card arrives. The same file is never saved twice.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    note: "Storing only: the card is saved to the renter's Documents as \"Insurance ID Card\" and on the driver profile, not reviewed, and nobody is marked insured or verified. Nothing is sent to the renter. Older cards stay as history; a card staff already verified stays current until staff review the new one. No match, two matches, a different name or an expired card goes to Fleet Inbox (Needs Attention) with one bell notice instead.",
  },
  {
    key: "auto_refund_reservation_on_insurance_decline",
    title: "Auto-Refund Reservation On Insurance Decline",
    audience: "Renters",
    channels: [],
    trigger: "A manager or owner marks the Renter Policy as declined after the Reservation Fee was paid.",
    cadence: "Once, immediately, through the same refund path as Refund Reservation. One refund per reservation.",
    emailWorkflows: [],
    control: { kind: "setting" },
    previews: [],
    defaultOn: false,
    note: "Off until turned on. Refunds the paid Reservation Fee in full (insurance declined) and tells FLEET. Needs proposed/reservation-fee-refunds-v1.sql. Never names the insurance company. A fee kept for a missed pickup is not refunded.",
  },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key);

/** Which catalog entry a tracked email workflow belongs to, for setting-controlled entries only. */
export function settingKeyForEmailWorkflow(workflow: string | undefined | null): string | null {
  if (!workflow) return null;
  const hit = AUTOMATIONS.find((a) => a.control.kind === "setting" && a.emailWorkflows.includes(workflow));
  return hit ? hit.key : null;
}

type SwitchMark = { at: string; by: string | null };
/** off: default-on entries turned off. on: default-off entries turned on. */
export type AutomationControlsValue = { off: Record<string, SwitchMark>; on?: Record<string, SwitchMark> };

const DEFAULT_OFF = new Set(AUTOMATIONS.filter((a) => a.defaultOn === false).map((a) => a.key));
export function isDefaultOff(key: string): boolean { return DEFAULT_OFF.has(key); }

/**
 * Parse the stored value. Returns null when a row exists but is malformed —
 * that is a failure, not "nothing turned off", so callers must hold sends.
 * Unknown keys inside a well-formed value are ignored.
 */
export function readAutomationControls(value: unknown): AutomationControlsValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: AutomationControlsValue = { off: {}, on: {} };
  for (const field of ["off", "on"] as const) {
    const m = (value as Record<string, unknown>)[field];
    if (m === undefined) continue;
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (!AUTOMATION_KEYS.includes(k)) continue;
      const rec = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      out[field]![k] = { at: String(rec.at ?? ""), by: rec.by == null ? null : String(rec.by) };
    }
  }
  return out;
}

/** "absent" = no row yet (legacy default: everything on). "error" = could not read or parse: hold. */
export type AutomationControlsState =
  | { status: "ok" | "absent"; value: AutomationControlsValue }
  | { status: "error"; value: null };

export function isAutomationOn(controls: AutomationControlsValue, key: string): boolean {
  if (DEFAULT_OFF.has(key)) return Boolean(controls.on?.[key]);
  return !controls.off[key];
}

/** Build the next stored value for a switch change. */
export function nextAutomationControls(
  current: AutomationControlsValue,
  key: string,
  on: boolean,
  at: string,
  by: string | null,
): AutomationControlsValue {
  const off = { ...current.off };
  const onMap = { ...(current.on ?? {}) };
  if (DEFAULT_OFF.has(key)) {
    if (on) onMap[key] = { at, by }; else delete onMap[key];
  } else if (on) delete off[key];
  else off[key] = { at, by };
  return { off, on: onMap };
}

/** Status words shown on each card. Kept separate so "on" never hides "not running". */
export type AutomationHealth =
  | "Running"
  | "Job Failing"
  | "No Schedule"
  | "Health Unknown"
  | "On Demand";

export function automationHealth(def: AutomationDef, cron: Record<string, { active: boolean; lastStatus: string | null }> | null): AutomationHealth {
  if (!def.cronJob) return "On Demand";
  if (!cron) return "Health Unknown";
  const job = cron[def.cronJob];
  if (!job || !job.active) return "No Schedule";
  if (job.lastStatus === "failed") return "Job Failing";
  if (job.lastStatus === "succeeded") return "Running";
  return "Health Unknown";
}
