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
    key: "application_recovery",
    title: "Unfinished Application",
    audience: "Applicants",
    channels: ["Email"],
    trigger: "An application draft is left unfinished.",
    cadence: "24 hours and 72 hours after the last activity. At most 10 per hour.",
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
    key: "payment_due_tomorrow",
    title: "Due Tomorrow",
    audience: "Renters",
    channels: ["Email"],
    trigger: "A payment is due tomorrow.",
    cadence: "Daily at 8:30 AM ET, once per due date.",
    emailWorkflows: ["payment_due_tomorrow"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: ["due_tomorrow"],
  },
  {
    key: "payment_past_due",
    title: "Past Due",
    audience: "Renters",
    channels: ["Email"],
    trigger: "A payment is still unpaid after its due date.",
    cadence: "1, 3 and 7 days late, then weekly. Stops once paid, waived or void.",
    emailWorkflows: ["payment_past_due"],
    cronJob: "ops-reminders-daily",
    control: { kind: "setting" },
    previews: ["past_due"],
    note: "Pay Now opens the renter's Payments tab. They sign in and pay their current balance with the card on file. The link carries no amount or token.",
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
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key);

/** Which catalog entry a tracked email workflow belongs to, for setting-controlled entries only. */
export function settingKeyForEmailWorkflow(workflow: string | undefined | null): string | null {
  if (!workflow) return null;
  const hit = AUTOMATIONS.find((a) => a.control.kind === "setting" && a.emailWorkflows.includes(workflow));
  return hit ? hit.key : null;
}

export type AutomationControlsValue = { off: Record<string, { at: string; by: string | null }> };

/**
 * Parse the stored value. Returns null when a row exists but is malformed —
 * that is a failure, not "nothing turned off", so callers must hold sends.
 * Unknown keys inside a well-formed value are ignored.
 */
export function readAutomationControls(value: unknown): AutomationControlsValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const off = (value as Record<string, unknown>).off;
  if (off === undefined) return { off: {} };
  if (!off || typeof off !== "object" || Array.isArray(off)) return null;
  const out: AutomationControlsValue = { off: {} };
  for (const [k, v] of Object.entries(off as Record<string, unknown>)) {
    if (!AUTOMATION_KEYS.includes(k)) continue;
    const rec = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    out.off[k] = { at: String(rec.at ?? ""), by: rec.by == null ? null : String(rec.by) };
  }
  return out;
}

/** "absent" = no row yet (legacy default: everything on). "error" = could not read or parse: hold. */
export type AutomationControlsState =
  | { status: "ok" | "absent"; value: AutomationControlsValue }
  | { status: "error"; value: null };

export function isAutomationOn(controls: AutomationControlsValue, key: string): boolean {
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
  if (on) delete off[key];
  else off[key] = { at, by };
  return { off };
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
