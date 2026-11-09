// Uniform rent reminders: one schedule for every active rental, Stripe autopay
// and manual payers alike. Pure and client-safe: stage choice, late-fee math,
// templates and their validation. Nothing here sends or reads a database.
//
// Schedule (Eastern time; texts only 8 AM to 9 PM):
//   due_tomorrow  the day before the due date, from 10 AM
//   due_today     the due date, from 8 AM, only if still unpaid
//                 (manual payers; an autopay card is charged later that day)
//   overdue       a failed Stripe charge, or still unpaid at 6 PM on the due date.
//                 Says the $50/day late fee applies (firm from the first week).
//   daily         from the day AFTER the overdue notice (never the same day as it
//                 or as a Payment Failed Text), from 10 AM, until paid or stopped.
//                 Stripe renters: this week's invoice amount with its own link,
//                 and any late fee stated as owed separately (the link cannot
//                 collect it). Manual payers: rent plus late fees.
//
// No catch-up blast: an overdue notice is only sent for a failure (Stripe
// invoice created, or manual 6 PM due-day cutoff) that happened after the
// Overdue switch was turned on and within CATCHUP_MAX_DAYS. Older ones, and
// ones a renter was already texted about (Payment Failed Text, or any outbound
// text naming that invoice in the last few days), count as already notified,
// so only the next day's daily notice follows.
//
// A whole-week late-fee waiver removes every late-fee line and amount.
//
// One send per rental + due date + stage (+ day for daily) + channel. The
// ledger (rent_reminder_log) is the claim, shared with the Stripe webhook's
// failed-payment text, so a renter never gets two texts for the same thing.
//
// Stripe renters only ever get their own invoice page (invoice.stripe.com).
// The day-before autopay heads-up has no link at all. Never another way to pay.
import { isHostedInvoiceUrl } from "@/lib/failed-payment-link";

export const LATE_FEE_PER_DAY = 50;
/** Overdue notices are only sent for failures this recent (days), and never for ones before the switch went on. */
export const CATCHUP_MAX_DAYS = 3;
/** An outbound text about the same invoice / week within this many days counts as the overdue notice. */
export const PRIOR_NOTICE_DAYS = 3;

export const RENT_REMINDER_STAGES = ["due_tomorrow", "due_today", "overdue", "daily"] as const;
export type RentReminderStage = (typeof RENT_REMINDER_STAGES)[number];
export type PayerMode = "stripe" | "manual";

/** Back Office → Automations switch per stage. All default OFF. */
export const STAGE_SWITCH: Record<RentReminderStage, string> = {
  due_tomorrow: "rent_reminder_due_tomorrow",
  due_today: "rent_reminder_due_today",
  overdue: "rent_reminder_overdue",
  daily: "rent_reminder_daily",
};
export const RENT_REMINDER_SWITCHES = Object.values(STAGE_SWITCH);
/** email_deliveries.workflow per stage, so sendEmail's own gate applies too. */
export const STAGE_WORKFLOW: Record<RentReminderStage, string> = {
  due_tomorrow: "rent_reminder_due_tomorrow",
  due_today: "rent_reminder_due_today",
  overdue: "rent_reminder_overdue",
  daily: "rent_reminder_daily",
};

// ------------------------------------------------------------------ dates (ET)

export function easternParts(now: Date): { date: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Eastern calendar date of a Unix timestamp (seconds). */
export function easternDateOf(unixSeconds: number): string {
  return easternParts(new Date(unixSeconds * 1000)).date;
}

export function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function withinQuietHoursAllowed(hour: number): boolean {
  return hour >= 8 && hour < 21;
}

// ------------------------------------------------------------------ late fees

export type LateFeeWaiver = { dueDate: string; waivedThrough: string | null };

/**
 * Late fees owed for one unpaid due date: $50 for each day after the due date
 * (the day after it is day one), less any days staff waived. A waiver with no
 * end date waives the whole week. Never charged automatically.
 */
export function lateFeeFor(args: { dueDate: string; today: string; waivers?: LateFeeWaiver[]; perDay?: number }): {
  daysLate: number; feeDays: number; waivedDays: number; fee: number; waived: boolean;
} {
  const perDay = args.perDay ?? LATE_FEE_PER_DAY;
  const daysLate = Math.max(0, dayDiff(args.dueDate, args.today));
  let waivedDays = 0;
  let waived = false;
  for (const w of args.waivers ?? []) {
    if (w.dueDate !== args.dueDate) continue;
    waived = true;
    waivedDays = w.waivedThrough == null ? daysLate : Math.max(waivedDays, Math.min(daysLate, Math.max(0, dayDiff(args.dueDate, w.waivedThrough))));
  }
  const feeDays = Math.max(0, daysLate - waivedDays);
  return { daysLate, feeDays, waivedDays, fee: round2(feeDays * perDay), waived };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------------ state + stage

export type RentalBillingState = {
  rentalId: string;
  applicationId: string | null;
  firstName: string | null;
  phone: string | null;
  email: string | null;
  weeklyRate: number;
  mode: PayerMode;
  /** Earliest unpaid due date (manual), or the failed invoice's date / next charge date (Stripe). */
  dueDate: string | null;
  /** True when the rent for dueDate is unpaid and owed now (manual: due today or earlier; Stripe: a failed open invoice). */
  owing: boolean;
  /** Rent still owed in dollars (Stripe: open invoices' amount due; manual: weeks owed × rate − partial payments). */
  rentOwed: number;
  /** Stripe: the failed invoice's own page. */
  invoiceUrl?: string | null;
  /** Stripe: the failed invoice's id and creation time (Unix seconds). */
  invoiceId?: string | null;
  invoiceCreatedAt?: number | null;
  /** Stripe: other open failed invoices (newer), each listed with its own amount and link. */
  otherInvoices?: { url: string | null; amount: number; createdOn: string }[];
  waivers?: LateFeeWaiver[];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type StageDecision =
  | { send: true; stage: RentReminderStage; ledgerStage: string; dueDate: string }
  | { send: false; reason: string };

/** Ledger claims for one rental + due date + channel: stage -> ET date it was claimed. */
export type ClaimMap = Map<string, string>;

/** Older callers pass a Set (dates unknown): treat those claims as made on an earlier day. */
export function toClaimMap(sent: Set<string> | ClaimMap): ClaimMap {
  if (sent instanceof Map) return sent;
  return new Map([...sent].map((k) => [k, "0000-01-01"]));
}

export type StageContext = {
  /** When the Overdue switch was turned on (ISO). Failures before this are never caught up. Null = on but unknown: no catch-up. Undefined = switch off. */
  overdueEnabledAt?: string | null;
  /** ET date of the latest outbound text about this invoice / week within PRIOR_NOTICE_DAYS, if any. */
  priorNoticeOn?: string | null;
};

/** Parse a stored timestamp ("2026-11-09 19:26:29.81+00" or ISO) to ms, or null. */
export function parseTs(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let t = v.trim().replace(" ", "T");
  if (/T.*[+-]\d{2}$/.test(t)) t += ":00";
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** When the failure that owes an overdue notice happened (ms): Stripe invoice creation, or 6 PM ET on a manual due date. */
function failureMoment(s: RentalBillingState): number | null {
  if (s.mode === "stripe") return s.invoiceCreatedAt ? s.invoiceCreatedAt * 1000 : (s.dueDate ? Date.parse(`${s.dueDate}T23:00:00Z`) : null);
  return s.dueDate ? Date.parse(`${s.dueDate}T23:00:00Z`) : null; // 6 PM EST
}

/**
 * Which stage is owed right now. `sent` holds the ledger claims for this rental
 * + due date + channel with the ET date of each claim. A missed hour or day
 * sends the latest stage owed, never a burst of old ones.
 */
export function decideStage(s: RentalBillingState, now: Date, sent: Set<string> | ClaimMap, ctx: StageContext = {}): StageDecision {
  if (!s.dueDate) return { send: false, reason: "no_due_date" };
  const claims = toClaimMap(sent);
  const { date: today, hour } = easternParts(now);
  const days = dayDiff(s.dueDate, today); // -1 = due tomorrow, 0 = due today, 1+ = late

  if (days === -1) {
    if (s.owing) return { send: false, reason: "not_owing_yet" };
    if (hour < 10) return { send: false, reason: "too_early" };
    return pick("due_tomorrow", "due_tomorrow", s.dueDate, claims);
  }
  if (days < -1) return { send: false, reason: "not_due_yet" };
  if (!s.owing) return { send: false, reason: "paid_or_pending" };

  // Manual payer on the due day before the 6 PM cutoff: the due-today notice.
  if (s.mode === "manual" && days === 0 && hour < 18) {
    if (hour >= 8) return pick("due_today", "due_today", s.dueDate, claims);
    return { send: false, reason: "too_early" };
  }

  // When was this week's overdue notice given? A ledger claim, or a recent text
  // about the same invoice (Payment Failed Text / a staff text).
  let overdueOn: string | null = claims.get("overdue") ?? null;
  if (!overdueOn && ctx.priorNoticeOn) overdueOn = ctx.priorNoticeOn;
  if (!overdueOn) {
    const failedAt = failureMoment(s);
    const enabledAt = parseTs(ctx.overdueEnabledAt ?? null);
    const failedOn = failedAt != null ? easternParts(new Date(failedAt)).date : s.dueDate;
    const recent = dayDiff(failedOn, today) <= CATCHUP_MAX_DAYS;
    // undefined = Overdue is off (the runner then skips it as stage_off); null = on but its time is unreadable: no catch-up.
    const afterEnable = ctx.overdueEnabledAt === undefined || (enabledAt != null && failedAt != null && failedAt >= enabledAt);
    if (recent && afterEnable) return pick("overdue", "overdue", s.dueDate, claims);
    // Before the switch went on, or too old: no catch-up notice. It counts as
    // given on the later of the failure day and the day the switch went on, so
    // the first notice is the next day's daily one (going forward only).
    const enabledOn = enabledAt != null ? easternParts(new Date(enabledAt)).date : today;
    overdueOn = failedOn > enabledOn ? failedOn : enabledOn;
  }

  // Daily: never the same day as the overdue notice, from 10 AM, once a day.
  if (overdueOn >= today) return { send: false, reason: "overdue_given_today" };
  if (claims.has(`daily:${today}`)) return { send: false, reason: "already_sent" };
  if (hour < 10) return { send: false, reason: "too_early" };
  return pick("daily", `daily:${today}`, s.dueDate, claims);
}

function pick(stage: RentReminderStage, ledgerStage: string, dueDate: string, sent: ClaimMap): StageDecision {
  if (sent.has(ledgerStage)) return { send: false, reason: "already_sent" };
  return { send: true, stage, ledgerStage, dueDate };
}

/**
 * The ledger stage a Stripe failed-payment text should claim now, or null to
 * stay quiet. Never a second text on a day that already had one (an overdue
 * notice, a daily notice, or a recent text about the same invoice).
 */
/**
 * Texts: at most one past-due text per day, so a same-day retry after the
 * Overdue text (or after a staff text with this invoice) sends nothing.
 * Emails (`onePerDay: false`): each genuinely new Stripe attempt still gets one
 * failure email, but never two on the same ledger slot.
 */
export function webhookLedgerStage(
  sent: Set<string> | ClaimMap,
  now: Date,
  priorNoticeOn: string | null = null,
  opts: { onePerDay?: boolean } = {},
): string | null {
  const onePerDay = opts.onePerDay ?? true;
  const claims = toClaimMap(sent);
  const today = easternParts(now).date;
  if (priorNoticeOn && priorNoticeOn >= today) return null;
  for (const [stage, on] of claims) {
    if (stage === `daily:${today}`) return null;
    if (onePerDay && stage === "overdue" && on >= today) return null;
  }
  if (!claims.has("overdue")) return "overdue";
  return `daily:${today}`;
}

// ------------------------------------------------------------------ templates

export type StageTemplate = { sms: string; subject: string; email: string };
export type RentReminderTemplates = {
  stripe: Record<RentReminderStage, StageTemplate>;
  manual: Record<RentReminderStage, StageTemplate>;
  /** How manual payers pay (Cash App, Zelle, …). Only ever shown to manual payers. */
  manualInstructions: string;
};

const STOP = " Reply STOP to opt out.";

export const DEFAULT_TEMPLATES: RentReminderTemplates = {
  stripe: {
    due_tomorrow: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Heads up: your card on file will be charged {{amount}} tomorrow ({{due_date}}) for your weekly rental. Nothing else to do." + STOP,
      subject: "Your Weekly Rental Payment Is Tomorrow",
      email: "Hi {{first_name}}, a quick heads up: your card on file will be charged {{amount}} tomorrow, {{due_date}}, for your weekly rental. Please make sure it has funds available. There is nothing else to do.",
    },
    due_today: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly payment of {{amount}} did not go through. Pay this week's invoice here: {{link}}" + STOP,
      subject: "Your Weekly Rental Payment Is Due Today",
      email: "Hi {{first_name}}, your weekly payment of {{amount}} did not go through. Please pay this week's invoice using the button below. You can use a different card on that page.",
    },
    overdue: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly payment of {{amount}} due {{due_date}} did not go through. Pay this week's invoice here: {{link}}{{other_invoices_line}}{{late_fee_line}} Please use only this link so you are not charged twice." + STOP,
      subject: "Payment Past Due",
      email: "Hi {{first_name}}, your weekly payment of {{amount}} due {{due_date}} did not go through. Please pay this week's invoice using the button below (you can use a different card on that page).{{other_invoices_line}}{{late_fee_line}} Please use only this button so you are not charged twice.",
    },
    daily: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly payment of {{amount}} is {{days_late}} day(s) late. Pay this week's {{amount}} invoice here: {{link}}{{other_invoices_line}}{{late_fee_line}}" + STOP,
      subject: "Rent Past Due: {{amount}} Invoice",
      email: "Hi {{first_name}}, your weekly payment of {{amount}} is {{days_late}} day(s) late. Please pay this week's {{amount}} invoice using the button below.{{other_invoices_line}}{{late_fee_line}}",
    },
  },
  manual: {
    due_tomorrow: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly rent of {{amount}} is due tomorrow ({{due_date}}). {{payment_instructions}}" + STOP,
      subject: "Your Weekly Rent Is Due Tomorrow",
      email: "Hi {{first_name}}, your weekly rent of {{amount}} is due tomorrow, {{due_date}}. {{payment_instructions}}",
    },
    due_today: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly rent of {{amount}} is due today. {{payment_instructions}}" + STOP,
      subject: "Your Weekly Rent Is Due Today",
      email: "Hi {{first_name}}, your weekly rent of {{amount}} is due today, {{due_date}}. {{payment_instructions}}",
    },
    overdue: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly rent of {{amount}} due {{due_date}} has not been paid.{{late_fee_line}} {{payment_instructions}}" + STOP,
      subject: "Rent Past Due",
      email: "Hi {{first_name}}, your weekly rent of {{amount}} due {{due_date}} has not been paid.{{late_fee_line}} {{payment_instructions}}",
    },
    daily: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your rent is {{days_late}} day(s) late. You owe {{balance}}.{{late_fee_line}} {{payment_instructions}}" + STOP,
      subject: "Past Due Balance: {{balance}}",
      email: "Hi {{first_name}}, your rent is {{days_late}} day(s) late. Your balance is {{balance}}.{{late_fee_line}} {{payment_instructions}}",
    },
  },
  manualInstructions: "Reply to this message and we will send you how to pay.",
};

const PAYMENT_HANDLES = /(cash\s*app|cashapp|venmo|zelle|paypal|apple\s*pay|buy\.stripe\.com|checkout\.stripe\.com|billing\.stripe\.com|(^|\s)\$[a-z][a-z0-9_-]{1,})/i;

/**
 * Why a template cannot be saved, or null. Stripe templates may not mention any
 * other way to pay, and the ones that ask for payment must carry {{link}}.
 */
export function templateProblem(mode: PayerMode, stage: RentReminderStage, t: StageTemplate): string | null {
  for (const [field, text] of [["Text", t.sms], ["Subject", t.subject], ["Email", t.email]] as const) {
    if (!text || !text.trim()) return `${field} Is Required`;
    if (text.length > (field === "Text" ? 640 : field === "Subject" ? 140 : 4000)) return `${field} Is Too Long`;
  }
  if (!/reply stop/i.test(t.sms)) return "Text Must Say Reply STOP To Opt Out";
  // Late fees only through {{late_fee_line}}, so a waived week never mentions one.
  const literal = `${t.sms}\n${t.subject}\n${t.email}`.replace(/\{\{[a-z_]+\}\}/g, "");
  if (/late\s*fee/i.test(literal)) return "Use {{late_fee_line}} For Late Fees";
  if (/\{\{(late_fee|late_fee_per_day)\}\}/.test(`${t.sms}${t.subject}${t.email}`)) return "Use {{late_fee_line}} For Late Fees";
  if (mode === "stripe") {
    const all = `${t.sms}\n${t.subject}\n${t.email}`;
    if (all.includes("{{payment_instructions}}")) return "Stripe Renters Only Get Their Own Invoice Link";
    if (PAYMENT_HANDLES.test(all.replace(/\$\{\{[a-z_]+\}\}/g, ""))) return "Stripe Renters Only Get Their Own Invoice Link";
    if (stage !== "due_tomorrow" && !t.sms.includes("{{link}}")) return "Text Must Include {{link}}";
    if (stage === "due_tomorrow" && /\{\{link\}\}/.test(`${t.sms}${t.email}`)) return "Autopay Heads-Up Has No Link";
    // The invoice link collects the invoice only; a total with late fees would not match it.
    if (/\{\{balance\}\}/.test(`${t.sms}${t.subject}${t.email}`)) return "Stripe Renters See The Invoice Amount; Late Fees Are Stated Separately";
  }
  return null;
}

export function mergeTemplates(stored: unknown): RentReminderTemplates {
  const out: RentReminderTemplates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  if (!stored || typeof stored !== "object") return out;
  const s = stored as any;
  for (const mode of ["stripe", "manual"] as const) {
    for (const stage of RENT_REMINDER_STAGES) {
      const t = s?.[mode]?.[stage];
      if (t && typeof t.sms === "string" && typeof t.subject === "string" && typeof t.email === "string") {
        const cand = { sms: t.sms, subject: t.subject, email: t.email };
        if (!templateProblem(mode, stage, cand)) out[mode][stage] = cand;
      }
    }
  }
  if (typeof s.manualInstructions === "string" && s.manualInstructions.trim() && s.manualInstructions.length <= 500) {
    out.manualInstructions = s.manualInstructions.trim();
  }
  return out;
}

export function money(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

function fmtDue(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export type RenderedReminder = { sms: string; subject: string; email: string; link: string | null; linkLabel: string | null };

/**
 * Fill a stage's template. Returns null when a Stripe renter has no safe link
 * for a stage that asks for payment: then nothing is sent (never a generic link).
 */
export function renderReminder(
  templates: RentReminderTemplates,
  stage: RentReminderStage,
  s: RentalBillingState,
  now: Date,
): RenderedReminder | null {
  const today = easternParts(now).date;
  const fee = lateFeeFor({ dueDate: s.dueDate!, today, waivers: s.waivers });
  const wholeWeekWaived = (s.waivers ?? []).some((w) => w.dueDate === s.dueDate && w.waivedThrough == null);
  const amount = s.mode === "stripe" && s.rentOwed > 0 ? s.rentOwed : s.weeklyRate;
  let link: string | null = null;
  let linkLabel: string | null = null;
  if (s.mode === "stripe" && stage !== "due_tomorrow") {
    // Autopay heads-up carries no link at all. Every other Stripe notice: own invoice page only.
    if (!isHostedInvoiceUrl(s.invoiceUrl)) return null;
    link = s.invoiceUrl!.trim();
    linkLabel = "Pay This Week's Invoice";
  }
  let lateFeeLine = "";
  if (stage === "overdue") {
    if (!wholeWeekWaived) lateFeeLine = ` Per your rental agreement, a $${LATE_FEE_PER_DAY}/day late fee applies for each day it stays unpaid.`;
  } else if (stage === "daily") {
    // Each unpaid week's own fee, honoring that week's waiver: a waived week adds
    // nothing, a newer unwaived week still counts.
    const primaryFee = wholeWeekWaived ? 0 : fee.fee;
    const otherFees = s.mode === "stripe"
      ? (s.otherInvoices ?? []).reduce((t, o) => t + lateFeeFor({ dueDate: o.createdOn, today, waivers: s.waivers }).fee, 0)
      : 0;
    const totalFee = round2(primaryFee + otherFees);
    if (totalFee > 0) {
      lateFeeLine = s.mode === "stripe"
        ? ` Late fees of ${money(totalFee)} ($${LATE_FEE_PER_DAY}/day per your rental agreement) are owed separately and are not part of ${s.otherInvoices?.length ? "these invoices" : "this invoice"}.`
        : ` That includes ${money(totalFee)} in late fees ($${LATE_FEE_PER_DAY}/day per your rental agreement).`;
    }
  }
  // Each other open invoice with its own amount and its own page; never a combined total.
  let otherInvoicesLine = "";
  if (s.mode === "stripe" && stage !== "due_tomorrow") {
    for (const o of s.otherInvoices ?? []) {
      if (!isHostedInvoiceUrl(o.url)) continue;
      otherInvoicesLine += ` Your ${money(o.amount)} invoice from ${fmtDue(o.createdOn)} is also unpaid: ${o.url!.trim()}`;
    }
  }
  const vars: Record<string, string> = {
    first_name: (s.firstName ?? "").trim().split(/\s+/)[0] || "there",
    amount: money(amount),
    due_date: fmtDue(s.dueDate!),
    days_late: String(fee.daysLate),
    // A waived week shows rent only.
    balance: money(round2(s.rentOwed + (wholeWeekWaived ? 0 : fee.fee))),
    link: link ?? "",
    late_fee_line: lateFeeLine,
    other_invoices_line: otherInvoicesLine,
    payment_instructions: s.mode === "manual" ? templates.manualInstructions : "",
  };
  const t = templates[s.mode][stage];
  const fill = (x: string) => x.replace(/\{\{([a-z_]+)\}\}/g, (_, k) => vars[k] ?? "").replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
  return { sms: fill(t.sms), subject: fill(t.subject), email: fill(t.email), link, linkLabel };
}

// ------------------------------------------------------------------ manual payments

export const MANUAL_METHODS = [
  { value: "Cash App", label: "Cash App" },
  { value: "Venmo", label: "Venmo" },
  { value: "Zelle", label: "Zelle" },
  { value: "Cash", label: "Cash" },
  { value: "Other", label: "Other" },
] as const;

/** Manual payer state from the rental and its payment rows for the due date. */
export function manualOwed(args: { dueDate: string | null; today: string; weeklyRate: number; paidTowardDue: number }): { owing: boolean; rentOwed: number; weeksOwed: number } {
  if (!args.dueDate) return { owing: false, rentOwed: 0, weeksOwed: 0 };
  const days = dayDiff(args.dueDate, args.today);
  if (days < 0) return { owing: false, rentOwed: 0, weeksOwed: 0 };
  const weeksOwed = Math.floor(days / 7) + 1;
  const rentOwed = round2(Math.max(0, weeksOwed * args.weeklyRate - args.paidTowardDue));
  return { owing: rentOwed > 0, rentOwed, weeksOwed };
}

/** Whether a recorded payment covers the week, so the due date moves on and reminders stop. */
export function paymentCoversWeek(paidTowardDue: number, weeklyRate: number): boolean {
  return weeklyRate > 0 && paidTowardDue + 0.005 >= weeklyRate;
}
