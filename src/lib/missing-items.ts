/**
 * Missing-Items Outreach (client-safe, pure).
 *
 * When a submitted applicant is missing something only they can give us, we
 * tell them exactly what is missing, hand them their own 14-day upload link,
 * and ask if they are still interested. Staff-only checks (background, MVR,
 * interview) are never asked of the applicant.
 *
 * The items mirror what FLEET's review treats as missing (fleet-review.ts):
 *   license_front  hard document (blocks FLEET approval)
 *   gig_profile    hard document (blocks FLEET approval)
 *   income         advisory document (sends the applicant to staff)
 *   dob            "no_dob" escalation
 *   license_expiration  "no_license_expiry" escalation
 * The back of the license is optional and never asked for. Insurance is
 * included with the rental, so no insurance proof is ever asked for.
 *
 * Settings live in app_settings under MISSING_ITEMS_SETTINGS_KEY. The on/off
 * switches are two Automations list entries, both Off until an Owner turns
 * them on: "missing_items_outreach" (ongoing) and "missing_items_backfill"
 * (the one-time message to existing applicants; it can never send twice).
 */

export const MISSING_ITEMS_SETTINGS_KEY = "missing_items_outreach";
export const MISSING_ITEMS_AUTOMATION_KEY = "missing_items_outreach";
export const MISSING_ITEMS_EMAIL_WORKFLOW = "application_missing_items";
export const MISSING_ITEMS_BACKFILL_KEY = "missing_items_backfill";
export const MISSING_ITEMS_BACKFILL_WORKFLOW = "application_missing_items_once";
export const MISSING_ITEMS_KIND = "missing_items";
export const MISSING_ITEMS_AUTOCLOSE_KEY = "missing_items_autoclose";
export const MISSING_ITEMS_AUTOCLOSE_WORKFLOW = "application_missing_items_closed";
export const MISSING_ITEMS_AUTOCLOSE_KIND = "missing_items_closed";

export const MISSING_ITEM_KEYS = ["application_details", "license_front", "gig_profile", "income"] as const;
export type MissingItemKey = (typeof MISSING_ITEM_KEYS)[number];

/** Renter-facing wording. Long form for email, short form for texts. */
export const MISSING_ITEM_COPY: Record<MissingItemKey, { email: string; sms: string }> = {
  // Leads that never got past the first page (waitlist, landing pages): the
  // wizard needs these answers before the upload step, and to quote.
  application_details: {
    email: "A few quick answers about the car you want and how you drive (about 2 minutes)",
    sms: "answers about the car you want",
  },
  license_front: { email: "A photo of the front of your driver's license", sms: "license photo (front)" },
  gig_profile: {
    email: "A screenshot of your gig app profile showing your rating and your number of trips or deliveries",
    sms: "gig profile screenshot (rating + trips)",
  },
  income: {
    email: "Proof of income, like a recent weekly earnings summary from your gig app or a pay stub",
    sms: "proof of income",
  },
};

export type OutreachSettings = {
  /** Hours since the applicant's last activity before the first message. */
  waitHours: number;
  /** Days after the first message for the reminder and the final message. */
  reminderDays: [number, number];
  /** Never message an applicant who got any message from us within this many hours. */
  minGapHours: number;
  /** Ongoing messages only start for applications at most this many days old. */
  maxAgeDays: number;
  /** A changed missing set restarts the sequence at most this many times. */
  maxSequences: number;
  statuses: string[];
  email: boolean;
  sms: boolean;
  /** At most this many applicants per run (runs every 5 minutes). */
  batchLimit: number;
  /** Texts only between these Eastern hours (start inclusive, end exclusive). */
  smsHours: [number, number];
  /** Backfill skips applications older than this many days (null = no limit). */
  backfillMaxAgeDays: number | null;
  /** Auto-close: days with no response after the LAST message before we close. */
  autoCloseDays: number;
};

export const DEFAULT_OUTREACH_SETTINGS: OutreachSettings = {
  waitHours: 24,
  reminderDays: [3, 7],
  minGapHours: 48,
  maxAgeDays: 60,
  maxSequences: 2,
  statuses: ["new", "reviewing"],
  email: true,
  sms: true,
  batchLimit: 25,
  smsHours: [9, 20],
  backfillMaxAgeDays: null,
  autoCloseDays: 14,
};

/** Statuses that are never messaged, whatever the setting says. */
export const NEVER_STATUSES = ["partial", "declined", "closed", "duplicate", "active", "approved", "suspended", "complete", "completed"];

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
};

export function readOutreachSettings(value: unknown): OutreachSettings {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, any>;
  const D = DEFAULT_OUTREACH_SETTINGS;
  const rd = Array.isArray(v.reminderDays) ? v.reminderDays : D.reminderDays;
  const r1 = int(rd[0], 1, 30, D.reminderDays[0]);
  const r2 = int(rd[1], r1 + 1, 60, Math.max(D.reminderDays[1], r1 + 1));
  const sh = Array.isArray(v.smsHours) ? v.smsHours : D.smsHours;
  const h1 = int(sh[0], 8, 20, D.smsHours[0]);
  const h2 = int(sh[1], h1 + 1, 21, Math.max(D.smsHours[1], h1 + 1));
  const statuses = (Array.isArray(v.statuses) ? v.statuses : D.statuses)
    .map((s: unknown) => String(s).toLowerCase())
    .filter((s: string) => !NEVER_STATUSES.includes(s) && /^[a-z_]+$/.test(s));
  return {
    waitHours: int(v.waitHours, 1, 24 * 14, D.waitHours),
    reminderDays: [r1, r2],
    minGapHours: int(v.minGapHours, 12, 24 * 14, D.minGapHours),
    maxAgeDays: int(v.maxAgeDays, 1, 365, D.maxAgeDays),
    maxSequences: int(v.maxSequences, 1, 5, D.maxSequences),
    statuses: statuses.length ? statuses : [...D.statuses],
    email: v.email !== false,
    sms: v.sms !== false,
    batchLimit: int(v.batchLimit, 1, 200, D.batchLimit),
    smsHours: [h1, h2],
    backfillMaxAgeDays: v.backfillMaxAgeDays == null ? null : int(v.backfillMaxAgeDays, 1, 3650, 365),
    autoCloseDays: int(v.autoCloseDays, 3, 90, D.autoCloseDays),
  };
}

// ------------------------------------------------------------- missing set

export type OutreachApp = {
  id: string;
  full_name?: string | null;
  status?: string | null;
  email?: string | null;
  phone?: string | null;
  sms_consent?: boolean | null;
  sms_opt_out_at?: string | null;
  dob?: string | null;
  license_expiration?: string | null;
  license_photo_url?: string | null;
  profile_screenshot_url?: string | null;
  income_proof_url?: string | null;
  vehicle_size?: string | null;
  pickup_date?: string | null;
  expected_duration?: string | null;
  gig_status?: string | null;
  drive_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  primary_application_id?: string | null;
  legal_hold?: boolean | null;
};
export type OutreachDoc = { category?: string | null; review_status?: string | null; is_current?: boolean | null };

const ownFile = (v: unknown) => typeof v === "string" && v.trim() !== "" && !v.startsWith("http");

/** What this applicant still owes us, in a fixed order. */
export function missingItems(app: OutreachApp, docs: readonly OutreachDoc[]): MissingItemKey[] {
  const have = new Set<string>();
  for (const d of docs) {
    if (d.is_current === false || d.review_status === "rejected") continue;
    if (d.category) have.add(String(d.category));
  }
  const out: MissingItemKey[] = [];
  const answered = (v: unknown) => typeof v === "string" && v.trim() !== "";
  // Same rule as the wizard's resume step (application-resume.ts): Rental and Driving answered.
  const detailsDone =
    answered(app.vehicle_size) && answered(app.pickup_date) && answered(app.expected_duration) &&
    answered(app.gig_status) && answered(app.drive_type);
  if (!detailsDone) out.push("application_details");
  if (!have.has("license_front") && !ownFile(app.license_photo_url)) out.push("license_front");
  if (!have.has("gig_profile") && !ownFile(app.profile_screenshot_url)) out.push("gig_profile");
  if (!have.has("income") && !ownFile(app.income_proof_url)) out.push("income");
  // Date of birth and licence expiry are never asked for: FLEET reads them
  // from the licence photo.
  return out;
}

/** Stable key for a missing set: a changed set starts a new sequence. */
export function missingKey(items: readonly MissingItemKey[]): string {
  return [...items].sort().join(",");
}

// ------------------------------------------------------------ reachability

export function toUsE164(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}
export function canEmail(app: OutreachApp): boolean {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(String(app.email ?? "").trim());
}
export function canText(app: OutreachApp, optedOut: ReadonlySet<string> = new Set()): boolean {
  const e = toUsE164(app.phone);
  return !!e && app.sms_consent === true && !app.sms_opt_out_at && !optedOut.has(e);
}

// ---------------------------------------------------------------- decision

export type OutreachLogRow = { missing_key: string; step: number; source: "backfill" | "ongoing"; created_at: string };

export type DecisionInput = {
  app: OutreachApp;
  items: MissingItemKey[];
  log: readonly OutreachLogRow[];
  /** Another automation (the New Applicant Follow-Up) is still running for them. */
  activeEnrollment: boolean;
  /** Last message of any kind we sent this application. */
  lastOutboundAt: string | null;
  disqualified: boolean;
  optedOut?: ReadonlySet<string>;
  now: Date;
  settings: OutreachSettings;
  mode: "ongoing" | "backfill";
};

export type Decision =
  | { send: true; step: 1 | 2 | 3; key: string; email: boolean; sms: boolean }
  | { send: false; reason: string };

const hoursSince = (iso: string | null | undefined, now: Date) => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : Infinity;
};

/** Eligibility shared by the ongoing sweep and the one-time backfill. */
function baseRefusal(i: DecisionInput): string | null {
  const a = i.app;
  const status = String(a.status ?? "").toLowerCase();
  if (a.deleted_at) return "deleted";
  if (a.primary_application_id) return "duplicate";
  if (a.legal_hold === true) return "legal_hold";
  if (i.disqualified) return "disqualified";
  if (NEVER_STATUSES.includes(status) || !i.settings.statuses.includes(status)) return `status_${status || "blank"}`;
  if (!i.items.length) return "nothing_missing";
  if (i.activeEnrollment) return "followup_running";
  if (hoursSince(i.lastOutboundAt, i.now) < i.settings.minGapHours) return "messaged_recently";
  return null;
}

export function decideOutreach(i: DecisionInput): Decision {
  const refused = baseRefusal(i);
  if (refused) return { send: false, reason: refused };
  const email = i.settings.email && canEmail(i.app);
  const sms = i.settings.sms && canText(i.app, i.optedOut);
  if (!email && !sms) return { send: false, reason: "unreachable" };
  const key = missingKey(i.items);
  const age = hoursSince(i.app.created_at, i.now) / 24;

  if (i.mode === "backfill") {
    if (i.log.length) return { send: false, reason: "already_contacted" };
    if (i.settings.backfillMaxAgeDays != null && age > i.settings.backfillMaxAgeDays) return { send: false, reason: "too_old" };
    // Someone mid-application right now is left to the ongoing rule.
    if (hoursSince(i.app.updated_at ?? i.app.created_at, i.now) < i.settings.waitHours) return { send: false, reason: "waiting_after_activity" };
    return { send: true, step: 1, key, email, sms };
  }

  // Ongoing.
  const mine = i.log.filter((r) => r.missing_key === key);
  if (mine.some((r) => r.source === "backfill")) return { send: false, reason: "backfill_sent_once" };
  const sent = mine.map((r) => r.step);
  if (!sent.length) {
    const sequences = new Set(i.log.filter((r) => r.source === "ongoing").map((r) => r.missing_key)).size;
    if (sequences >= i.settings.maxSequences) return { send: false, reason: "max_sequences" };
    if (age > i.settings.maxAgeDays) return { send: false, reason: "too_old" };
    if (hoursSince(i.app.updated_at ?? i.app.created_at, i.now) < i.settings.waitHours) return { send: false, reason: "waiting_after_activity" };
    return { send: true, step: 1, key, email, sms };
  }
  const next = (Math.max(...sent) + 1) as 2 | 3 | 4;
  if (next > 3) return { send: false, reason: "sequence_done" };
  const first = mine.find((r) => r.step === 1);
  const days = (hoursSince(first?.created_at, i.now) / 24);
  const due = i.settings.reminderDays[next - 2];
  if (!(days >= due)) return { send: false, reason: `step${next}_not_due` };
  return { send: true, step: next as 2 | 3, key, email, sms };
}

// -------------------------------------------------------------------- copy

export type CopyVars = {
  firstName: string;
  items: MissingItemKey[];
  link: string;
  companyPhone: string;
  /**
   * Set when this is the last message before auto-close (step 3, or the
   * one-time message) and the Auto-Close switch is on: the copy says when.
   */
  closeInDays?: number | null;
};

export function firstNameOf(full: string | null | undefined): string {
  const f = String(full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!f) return "there";
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}

function smsList(items: readonly MissingItemKey[]): string {
  const parts = items.map((k) => MISSING_ITEM_COPY[k].sms);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const OUTREACH_SUBJECTS: Record<1 | 2 | 3, string> = {
  1: "What We Still Need For Your REAL RENTALS Application",
  2: "Still Interested In A REAL RENTALS Car?",
  3: "Last Reminder: Your REAL RENTALS Application",
};

export function outreachEmail(step: 1 | 2 | 3, v: CopyVars): { subject: string; body: string } {
  const list = v.items.map((k) => `• ${MISSING_ITEM_COPY[k].email}`).join("\n");
  const opener =
    step === 1
      ? "Thanks for applying to rent a car with REAL RENTALS. Are you still interested? You're close. To finish qualifying you and get you a quote to rent the car, we still need:"
      : step === 2
        ? "Just checking in. Are you still interested in renting a car with REAL RENTALS? Your application is still open. To finish qualifying you and get you a quote, we still need:"
        : "This is our last reminder about your REAL RENTALS application. If you still want a car, we just need these to finish qualifying you and get you a quote:";
  const closer = v.closeInDays
    ? `If we don't hear from you in the next ${v.closeInDays} days, we'll close your application. You can come back anytime and pick up where you left off.`
    : step === 3
      ? "If your plans have changed, no problem. Just reply and let us know."
      : "Not interested anymore? Just reply and let us know.";
  const body = `Hi ${v.firstName},

${opener}

${list}

${v.items.length === 1 ? "Add it here" : "Add them here"}: ${v.link}

The link is private to you and works for 14 days. It only takes a few minutes on your phone.

${closer}

Questions? Reply to this email or call us at ${v.companyPhone}.

REAL RENTALS`;
  return { subject: OUTREACH_SUBJECTS[step], body };
}

export function outreachSms(step: 1 | 2 | 3, v: CopyVars): string {
  const need = smsList(v.items);
  if (step === 1) {
    return `Hi ${v.firstName}, it's REAL RENTALS. Still interested in renting a car? To finish qualifying you and get your quote, we still need your ${need}. ${v.items.length === 1 ? "Add it here" : "Add them here"}: ${v.link} Reply STOP to opt out.`;
  }
  if (step === 2) {
    return `Hi ${v.firstName}, REAL RENTALS here. Still want a car? We still need your ${need} to finish your application and quote: ${v.link} Not interested? Just reply. Reply STOP to opt out.`;
  }
  return `Hi ${v.firstName}, last reminder from REAL RENTALS: send your ${need} here to get your rental quote: ${v.link} ${v.closeInDays ? `No reply in ${v.closeInDays} days and we'll close your application.` : "Plans changed? Just reply."} Reply STOP to opt out.`;
}

// --------------------------------------------------------------- auto-close

export const COME_BACK_SUBJECT = "We've Closed Your REAL RENTALS Application For Now";

/** The one message sent when an application is auto-closed. */
export function comeBackEmail(v: Pick<CopyVars, "firstName" | "link" | "companyPhone">): { subject: string; body: string } {
  const body = `Hi ${v.firstName},

We haven't heard back from you, so we've closed your REAL RENTALS application for now. No problem at all.

Whenever you're ready to rent a car, come back anytime and pick up right where you left off: ${v.link}

Your answers and uploads are saved. The link is private to you and works for 14 days. After that, just reply to this email and we'll send you a new one.

Questions? Reply to this email or call us at ${v.companyPhone}.

REAL RENTALS`;
  return { subject: COME_BACK_SUBJECT, body };
}

export function comeBackSms(v: Pick<CopyVars, "firstName" | "link">): string {
  return `Hi ${v.firstName}, it's REAL RENTALS. We haven't heard back, so we've closed your application for now. Come back anytime and pick up where you left off: ${v.link} Reply STOP to opt out.`;
}

export type AutoCloseInput = {
  app: OutreachApp;
  items: MissingItemKey[];
  log: readonly OutreachLogRow[];
  /** Latest sign of life from the applicant: link opened, upload, text or call in. */
  lastResponseAt: string | null;
  activeEnrollment: boolean;
  disqualified: boolean;
  optedOut?: ReadonlySet<string>;
  now: Date;
  settings: OutreachSettings;
};
export type AutoCloseDecision =
  | { close: true; lastMessageAt: string; email: boolean; sms: boolean }
  | { close: false; reason: string };

/**
 * Close (never decline) an applicant who did not respond within autoCloseDays
 * of the LAST missing-items message: step 3 of a sequence, or the one-time
 * message (which is the only one for that missing set).
 */
export function decideAutoClose(i: AutoCloseInput): AutoCloseDecision {
  const a = i.app;
  const status = String(a.status ?? "").toLowerCase();
  if (a.deleted_at) return { close: false, reason: "deleted" };
  if (a.primary_application_id) return { close: false, reason: "duplicate" };
  if (a.legal_hold === true) return { close: false, reason: "legal_hold" };
  if (NEVER_STATUSES.includes(status) || !i.settings.statuses.includes(status)) return { close: false, reason: `status_${status || "blank"}` };
  if (!i.items.length) return { close: false, reason: "nothing_missing" };
  if (i.disqualified) return { close: false, reason: "disqualified" };
  if (i.activeEnrollment) return { close: false, reason: "followup_running" };
  if (!i.log.length) return { close: false, reason: "never_messaged" };
  const last = [...i.log].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0];
  const terminal = last.step === 3 || last.source === "backfill";
  if (!terminal) return { close: false, reason: "sequence_not_finished" };
  if (Date.parse(String(i.lastResponseAt ?? "")) > Date.parse(last.created_at)) return { close: false, reason: "responded" };
  if (hoursSince(last.created_at, i.now) < i.settings.autoCloseDays * 24) return { close: false, reason: "waiting" };
  return { close: true, lastMessageAt: last.created_at, email: canEmail(a), sms: canText(a, i.optedOut) };
}

/** Mask a name, email and phone for previews and dry runs. */
export function redactContact(app: OutreachApp): { name: string; email: string | null; phone: string | null } {
  const n = firstNameOf(app.full_name);
  const e = String(app.email ?? "");
  const p = toUsE164(app.phone);
  return {
    name: n === "there" ? "(no name)" : `${n.charAt(0)}•••`,
    email: e.includes("@") ? `${e.charAt(0)}•••@${e.split("@")[1]?.replace(/^[^.]+/, "•••")}` : null,
    phone: p ? `+1•••••••${p.slice(-2)}` : null,
  };
}
