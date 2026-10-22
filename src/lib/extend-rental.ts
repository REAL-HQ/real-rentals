// Extend Rental stays dark until the proposed SQL is installed and an owner
// accepts a live Stripe subscription change. Nothing in this module calls Stripe.

export const EXTEND_RENTAL_ENABLED = false;

export const BILLING_EFFECTS = [
  "no_next_charge_recorded",
  "next_charge_after_new_end",
  "next_charge_now_inside_term",
  "next_charge_unchanged",
] as const;

export type BillingEffect = (typeof BILLING_EFFECTS)[number];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function utcDay(value: string): number {
  const match = DATE_ONLY.exec(value);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return Number.NaN;
  }
  return date.getTime();
}

export function addCalendarDays(value: string, days: number): string {
  const next = new Date(utcDay(value) + days * 86_400_000);
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${month}-${day}`;
}

/** Whole calendar days from start to end. Matches PostgreSQL date subtraction. */
export function calendarDaysBetween(start: string, end: string): number {
  return Math.round((utcDay(end) - utcDay(start)) / 86_400_000);
}

/** Same rounding as extend_rental_tx: round(weekly_rate * extra_days / 7, 2). */
export function extensionCost(weeklyRate: number, extraDays: number): number {
  return Math.round((weeklyRate * extraDays * 100) / 7) / 100;
}

export function formatExtraWeeks(extraDays: number): string {
  const weeks = Math.floor(extraDays / 7);
  const days = extraDays % 7;
  const weekLabel = weeks === 1 ? "1 week" : `${weeks} weeks`;
  const dayLabel = days === 1 ? "1 day" : `${days} days`;
  if (weeks <= 0) return dayLabel;
  if (days === 0) return weekLabel;
  return `${weekLabel} ${dayLabel}`;
}

export function billingEffect(
  nextPaymentDue: string | null,
  currentEnd: string,
  newEnd: string,
): BillingEffect {
  if (!nextPaymentDue) return "no_next_charge_recorded";
  if (nextPaymentDue > newEnd) return "next_charge_after_new_end";
  if (nextPaymentDue > currentEnd) return "next_charge_now_inside_term";
  return "next_charge_unchanged";
}

export function includedExtensionCharges(
  nextPaymentDue: string | null,
  currentEnd: string,
  newEnd: string,
): string[] {
  if (!nextPaymentDue) return [];
  const charges: string[] = [];
  let cursor = nextPaymentDue;
  let steps = 0;
  while (cursor <= newEnd && steps < 400) {
    if (cursor > currentEnd) charges.push(cursor);
    cursor = addCalendarDays(cursor, 7);
    steps += 1;
  }
  return charges;
}

export type ExtensionPreview =
  | {
      ok: true;
      extraDays: number;
      extraWeeksLabel: string;
      extensionCost: number;
      effect: BillingEffect;
      includedCharges: string[];
      nextPaymentDue: string | null;
    }
  | { ok: false; error: string };

export function extensionPreview(input: {
  currentEnd: string | null;
  newEnd: string;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  today?: string;
}): ExtensionPreview {
  if (!input.currentEnd) {
    return { ok: false, error: "An end date is required before this rental can be extended." };
  }
  if (!DATE_ONLY.test(input.currentEnd) || !DATE_ONLY.test(input.newEnd)) {
    return { ok: false, error: "Enter a New End Date." };
  }
  if (Number.isNaN(utcDay(input.currentEnd)) || Number.isNaN(utcDay(input.newEnd))) {
    return { ok: false, error: "Enter a New End Date." };
  }
  const today = input.today ?? easternToday();
  if (input.newEnd < today) {
    return { ok: false, error: "The new end date must be today or later, Eastern Time." };
  }
  if (input.newEnd <= input.currentEnd) {
    return { ok: false, error: "The new end date must be after the current end date." };
  }
  if (input.weeklyRate == null || !(input.weeklyRate > 0)) {
    return { ok: false, error: "This rental has no weekly rate." };
  }
  const extraDays = calendarDaysBetween(input.currentEnd, input.newEnd);
  return {
    ok: true,
    extraDays,
    extraWeeksLabel: formatExtraWeeks(extraDays),
    extensionCost: extensionCost(input.weeklyRate, extraDays),
    effect: billingEffect(input.nextPaymentDue, input.currentEnd, input.newEnd),
    includedCharges: includedExtensionCharges(input.nextPaymentDue, input.currentEnd, input.newEnd),
    nextPaymentDue: input.nextPaymentDue,
  };
}

export const BILLING_EFFECT_LABEL: Record<BillingEffect, string> = {
  no_next_charge_recorded: "No Next Charge Recorded",
  next_charge_after_new_end: "Next Billing Date Falls After The New End",
  next_charge_now_inside_term: "Next Billing Date Is Now Inside The Term",
  next_charge_unchanged: "Next Billing Date Unchanged",
};
