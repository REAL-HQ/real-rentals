/**
 * Read-only next-payment line for a driver who is renting.
 *
 * The amount is rentals.weekly_rate and the day is rentals.next_payment_due.
 * A missing rate, a missing date, or no active rental shows nothing.
 * This module does not read or write.
 */

import { fmtDate } from "@/lib/date-format";

export const RENTER_PAYMENT_BANNER_ENABLED: boolean = false;

export function assertRenterPaymentBannerEnabled(): void {
  if (RENTER_PAYMENT_BANNER_ENABLED !== true) {
    throw new Error("The renter payment banner is not enabled.");
  }
}

export type RenterPaymentBannerInput = {
  hasActiveRental: boolean;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
};

export type RenterPaymentBannerModel = {
  tone: "due" | "past_due";
  text: string;
  dueLabel: string;
  amountLabel: string;
  /** Set on a past-due banner so the phone can be a call link. */
  phoneDisplay: string | null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function easternCalendarDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The due day as a calendar date. A date-only value is that day. A timestamp is read in Eastern Time. */
export function dueCalendarDay(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = easternCalendarDay(parsed);
  return DATE_ONLY.test(day) ? day : null;
}

function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The banner, or null when there is nothing honest to say.
 * Past due means the due day is before today in Eastern Time. The due day itself is still "due".
 */
export function renterPaymentBanner(
  input: RenterPaymentBannerInput,
  today: Date,
  phoneDisplay: string,
): RenterPaymentBannerModel | null {
  if (!input.hasActiveRental) return null;
  const rate = input.weeklyRate;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  const dueOn = dueCalendarDay(input.nextPaymentDue);
  if (!dueOn) return null;
  const dueLabel = fmtDate(dueOn);
  if (!dueLabel) return null;
  const amountLabel = money(rate);
  const todayOn = easternCalendarDay(today);
  if (dueOn < todayOn) {
    const phone = phoneDisplay.trim();
    if (!phone) return null;
    return {
      tone: "past_due",
      dueLabel,
      amountLabel,
      phoneDisplay: phone,
      text: `Payment past due since ${dueLabel} — call ${phone}`,
    };
  }
  return {
    tone: "due",
    dueLabel,
    amountLabel,
    phoneDisplay: null,
    text: `Next payment: ${amountLabel} due ${dueLabel}`,
  };
}
