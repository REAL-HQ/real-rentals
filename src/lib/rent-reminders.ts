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
//   daily         every day after that, from 10 AM, with the running balance
//                 including late fees, until paid or staff stops it.
//
// One send per rental + due date + stage (+ day for daily) + channel. The
// ledger (rent_reminder_log) is the claim, shared with the Stripe webhook's
// failed-payment text, so a renter never gets two texts for the same thing.
//
// Stripe renters only ever get their own invoice page (invoice.stripe.com) or
// a card-update link for their own subscription. Never another way to pay.
import { isGenericPaymentLink, isHostedInvoiceUrl } from "@/lib/failed-payment-link";

export const LATE_FEE_PER_DAY = 50;

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
  /** Stripe: a card-update link for this subscription, when one could be made. */
  cardUpdateUrl?: string | null;
  waivers?: LateFeeWaiver[];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type StageDecision =
  | { send: true; stage: RentReminderStage; ledgerStage: string; dueDate: string }
  | { send: false; reason: string };

/**
 * Which stage is owed right now. `sent` holds ledger stages already claimed for
 * this rental + due date (e.g. "overdue", "daily:2026-11-10"). A missed hour or
 * day sends the latest stage owed, never a burst of old ones.
 */
export function decideStage(s: RentalBillingState, now: Date, sent: Set<string>): StageDecision {
  if (!s.dueDate) return { send: false, reason: "no_due_date" };
  const { date: today, hour } = easternParts(now);
  const days = dayDiff(s.dueDate, today); // -1 = due tomorrow, 0 = due today, 1+ = late

  if (days === -1) {
    if (s.owing) return { send: false, reason: "not_owing_yet" };
    if (hour < 10) return { send: false, reason: "too_early" };
    return pick("due_tomorrow", "due_tomorrow", s.dueDate, sent);
  }
  if (days < -1) return { send: false, reason: "not_due_yet" };
  if (!s.owing) return { send: false, reason: "paid_or_pending" };

  if (days === 0) {
    const failedStripe = s.mode === "stripe"; // Stripe is only "owing" once its charge failed
    if (failedStripe || hour >= 18) return pick("overdue", "overdue", s.dueDate, sent);
    if (s.mode === "manual" && hour >= 8) return pick("due_today", "due_today", s.dueDate, sent);
    return { send: false, reason: "too_early" };
  }

  // Late: the overdue notice first (catch-up), then one a day.
  if (!sent.has("overdue")) return pick("overdue", "overdue", s.dueDate, sent);
  if (hour < 10) return { send: false, reason: "too_early" };
  return pick("daily", `daily:${today}`, s.dueDate, sent);
}

function pick(stage: RentReminderStage, ledgerStage: string, dueDate: string, sent: Set<string>): StageDecision {
  if (sent.has(ledgerStage)) return { send: false, reason: "already_sent" };
  return { send: true, stage, ledgerStage, dueDate };
}

/** The ledger stage a Stripe failed-payment text should claim today. */
export function webhookLedgerStage(sent: Set<string>, now: Date): string | null {
  if (!sent.has("overdue")) return "overdue";
  const key = `daily:${easternParts(now).date}`;
  return sent.has(key) ? null : key;
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
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your card on file will be charged {{amount}} tomorrow ({{due_date}}) for your weekly rental.{{card_line}}" + STOP,
      subject: "Your Weekly Rental Payment Is Tomorrow",
      email: "Hi {{first_name}}, your card on file will be charged {{amount}} tomorrow, {{due_date}}, for your weekly rental. Please make sure it has funds available.{{card_line}}",
    },
    due_today: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly payment of {{amount}} did not go through. Pay this week's invoice here: {{link}}" + STOP,
      subject: "Your Weekly Rental Payment Is Due Today",
      email: "Hi {{first_name}}, your weekly payment of {{amount}} did not go through. Please pay this week's invoice using the button below. You can use a different card on that page.",
    },
    overdue: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly payment of {{amount}} due {{due_date}} did not go through. Pay this week's invoice here: {{link}} Per your rental agreement, a ${{late_fee_per_day}}/day late fee applies for each day it stays unpaid. Please use only this link so you are not charged twice." + STOP,
      subject: "Payment Past Due: Late Fees Apply",
      email: "Hi {{first_name}}, your weekly payment of {{amount}} due {{due_date}} did not go through. Please pay this week's invoice using the button below (you can use a different card on that page). Per your rental agreement, a ${{late_fee_per_day}} late fee applies for each day it stays unpaid. Please use only this button so you are not charged twice.",
    },
    daily: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your rent is {{days_late}} day(s) late. You owe {{balance}}: {{amount}} rent plus {{late_fee}} in late fees. Pay this week's invoice here: {{link}}" + STOP,
      subject: "Past Due Balance: {{balance}}",
      email: "Hi {{first_name}}, your rent is {{days_late}} day(s) late. Your balance is {{balance}}: {{amount}} rent plus {{late_fee}} in late fees (${{late_fee_per_day}} per day, per your rental agreement). Please pay this week's invoice using the button below.",
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
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your weekly rent of {{amount}} due {{due_date}} has not been paid. Per your rental agreement, a ${{late_fee_per_day}}/day late fee applies for each day it stays unpaid. {{payment_instructions}}" + STOP,
      subject: "Rent Past Due: Late Fees Apply",
      email: "Hi {{first_name}}, your weekly rent of {{amount}} due {{due_date}} has not been paid. Per your rental agreement, a ${{late_fee_per_day}} late fee applies for each day it stays unpaid. {{payment_instructions}}",
    },
    daily: {
      sms: "Hi {{first_name}}, this is REAL RENTALS. Your rent is {{days_late}} day(s) late. You owe {{balance}}: {{amount}} rent plus {{late_fee}} in late fees. {{payment_instructions}}" + STOP,
      subject: "Past Due Balance: {{balance}}",
      email: "Hi {{first_name}}, your rent is {{days_late}} day(s) late. Your balance is {{balance}}: {{amount}} rent plus {{late_fee}} in late fees (${{late_fee_per_day}} per day, per your rental agreement). {{payment_instructions}}",
    },
  },
  manualInstructions: "Reply to this message and we will send you how to pay.",
};

const PAYMENT_HANDLES = /(cash\s*app|cashapp|venmo|zelle|paypal|apple\s*pay|buy\.stripe\.com|checkout\.stripe\.com|(^|\s)\$[a-z][a-z0-9_-]{1,})/i;

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
  if (mode === "stripe") {
    const all = `${t.sms}\n${t.subject}\n${t.email}`;
    if (all.includes("{{payment_instructions}}")) return "Stripe Renters Only Get Their Own Invoice Link";
    if (PAYMENT_HANDLES.test(all.replace(/\$\{\{[a-z_]+\}\}/g, ""))) return "Stripe Renters Only Get Their Own Invoice Link";
    if (stage !== "due_tomorrow" && !t.sms.includes("{{link}}")) return "Text Must Include {{link}}";
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
  const amount = s.mode === "stripe" && s.rentOwed > 0 ? s.rentOwed : s.weeklyRate;
  let link: string | null = null;
  let linkLabel: string | null = null;
  let cardLine = "";
  if (s.mode === "stripe") {
    if (stage === "due_tomorrow") {
      const card = s.cardUpdateUrl && !isGenericPaymentLink(s.cardUpdateUrl) && /^https:\/\//.test(s.cardUpdateUrl) ? s.cardUpdateUrl : null;
      if (card) { link = card; linkLabel = "Update Card"; cardLine = ` To use a different card: ${card}`; }
    } else {
      if (!isHostedInvoiceUrl(s.invoiceUrl)) return null;
      link = s.invoiceUrl!.trim();
      linkLabel = "Pay This Week's Invoice";
    }
  }
  const vars: Record<string, string> = {
    first_name: (s.firstName ?? "").trim().split(/\s+/)[0] || "there",
    amount: money(amount),
    due_date: fmtDue(s.dueDate!),
    days_late: String(fee.daysLate),
    late_fee: money(fee.fee),
    late_fee_per_day: String(LATE_FEE_PER_DAY),
    balance: money(round2(s.rentOwed + fee.fee)),
    link: link ?? "",
    card_line: cardLine,
    payment_instructions: s.mode === "manual" ? templates.manualInstructions : "",
  };
  const t = templates[s.mode][stage];
  const fill = (x: string) => x.replace(/\{\{([a-z_]+)\}\}/g, (_, k) => vars[k] ?? "").replace(/\s{2,}/g, " ").trim();
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
