/**
 * Your Next Steps, for an approved applicant who is not on an active rental.
 *
 * Read-only. Each step is Done, Needed, or Unknown. A missing expiry date is
 * Unknown, never Done: we will not tell someone their licence is fine when we
 * have no date.
 *
 * Documents Expiring is not on this branch, so the Eastern calendar check
 * below is a minimal copy of that date rule: a date-only value stays on that
 * calendar day, and an instant is the Eastern day it falls on. Today is not
 * expired.
 *
 * NEXT_STEPS_CARD_ENABLED is false until an owner turns the card on. While it
 * is false the portal does not render the card and the read does not run.
 */

export const NEXT_STEPS_CARD_ENABLED: boolean = false;

export const NEXT_STEPS_TIME_ZONE = "America/New_York";

export const PICKUP_LINE = "Call us to pick up your car: (888) 833-8280";

export type NextStepState = "done" | "needed" | "unknown";

export type NextStep = {
  key: "license" | "insurance" | "agreement" | "payment";
  label: string;
  state: NextStepState;
};

export type NextStepsView = {
  show: boolean;
  steps: NextStep[];
  pickupLine: string;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(iso: string): boolean {
  const m = DATE_ONLY.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's calendar day in Eastern Time, YYYY-MM-DD. */
export function etCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEXT_STEPS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}`;
}

/** A date-only value, or null when it is missing or not a real calendar day. */
export function calendarDay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const prefix = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!prefix || !isRealDate(prefix[1])) return null;
  return prefix[1];
}

function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * On file, and not expired.
 * No file is Needed. A file with no readable date is Unknown. A past date is Needed.
 */
export function credentialStep(onFile: boolean, dates: (string | null | undefined)[], todayEt: string): NextStepState {
  const parsed = dates.map((d) => calendarDay(d)).filter((d): d is string => d != null);
  if (!parsed.length) return onFile ? "unknown" : "needed";
  const soonest = parsed.slice().sort()[0];
  if (daysBetween(todayEt, soonest) < 0) return "needed";
  return onFile ? "done" : "needed";
}

export function agreementStep(
  agreements: { status: string | null; signedAt: string | null }[] | null,
): NextStepState {
  if (agreements == null) return "unknown";
  const signed = agreements.some((a) => a.status === "signed" || Boolean(a.signedAt));
  return signed ? "done" : "needed";
}

export function paymentStep(payment: { cardOnFile: boolean; subscription: boolean } | null): NextStepState {
  if (payment == null) return "unknown";
  return payment.cardOnFile || payment.subscription ? "done" : "needed";
}

export type PaymentRow = {
  card_last4?: string | null;
  stripe_payment_method_id?: string | null;
  card_on_file_at?: string | null;
  stripe_subscription_id?: string | null;
  autopay_active?: boolean | null;
};

function filled(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** Card or subscription evidence already stored on our rows. A customer id is not a card. */
export function paymentFromRows(app: PaymentRow, rentals: PaymentRow[]): { cardOnFile: boolean; subscription: boolean } {
  const rows = [app, ...rentals];
  return {
    cardOnFile: rows.some((r) => filled(r.card_last4) || filled(r.stripe_payment_method_id) || filled(r.card_on_file_at)),
    subscription: rentals.some((r) => filled(r.stripe_subscription_id) || r.autopay_active === true),
  };
}

export type NextStepsApplication = {
  status: string | null;
  deletedAt: string | null;
  createdAt: string | null;
};

/** The newest application that has not been deleted. Matches the portal's newest-row read. */
export function pickNextStepsApplication<T extends NextStepsApplication>(rows: T[]): T | null {
  const live = rows.filter((r) => !r.deletedAt);
  live.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return live[0] ?? null;
}

export function buildNextSteps(input: {
  status: string | null;
  hasActiveRental: boolean;
  licenseOnFile: boolean;
  licenseDates: (string | null)[];
  insuranceOnFile: boolean;
  insuranceDates: (string | null)[];
  agreements: { status: string | null; signedAt: string | null }[] | null;
  payment: { cardOnFile: boolean; subscription: boolean } | null;
  now: Date;
}): NextStepsView {
  const todayEt = etCalendarDate(input.now);
  if (input.status !== "approved" || input.hasActiveRental) {
    return { show: false, steps: [], pickupLine: PICKUP_LINE };
  }
  return {
    show: true,
    pickupLine: PICKUP_LINE,
    steps: [
      {
        key: "license",
        label: "Driver License",
        state: credentialStep(input.licenseOnFile, input.licenseDates, todayEt),
      },
      {
        key: "insurance",
        label: "Insurance",
        state: credentialStep(input.insuranceOnFile, input.insuranceDates, todayEt),
      },
      { key: "agreement", label: "Agreement", state: agreementStep(input.agreements) },
      { key: "payment", label: "Payment Method", state: paymentStep(input.payment) },
    ],
  };
}
