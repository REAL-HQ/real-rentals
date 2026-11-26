// Staff policy for a Reservation Fee that was kept (missed pickup, released,
// cancelled). Internal only: nothing here is renter-facing copy.
//
// mode
//   auto          the late-pickup job saves a credit after it marks the fee kept
//   case_by_case  the fee stays kept; staff decide on each cancelled row
//   off           no automatic credit; staff can still save one from the row menu
// days is how long that credit lasts, counted from the moment it is created.

import { isKeptFeeNote } from "@/lib/rental-hold";

export const FORFEITED_FEE_CREDIT_KEY = "forfeited_fee_credit";
export const FORFEITED_FEE_CREDIT_DEFAULT_DAYS = 90;
export const FORFEITED_FEE_CREDIT_MODES = ["auto", "case_by_case", "off"] as const;
export type ForfeitedFeeCreditMode = (typeof FORFEITED_FEE_CREDIT_MODES)[number];

export type ForfeitedFeeCreditSettings = {
  mode: ForfeitedFeeCreditMode;
  days: number;
};

export const DEFAULT_FORFEITED_FEE_CREDIT: ForfeitedFeeCreditSettings = {
  mode: "case_by_case",
  days: FORFEITED_FEE_CREDIT_DEFAULT_DAYS,
};

const DAY_MS = 86_400_000;
const KEPT_RENTAL = /\bkept:(?:[a-z0-9_]+:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

export function readForfeitedFeeCreditSettings(value: unknown): ForfeitedFeeCreditSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const mode = FORFEITED_FEE_CREDIT_MODES.includes(raw.mode as ForfeitedFeeCreditMode)
    ? (raw.mode as ForfeitedFeeCreditMode)
    : DEFAULT_FORFEITED_FEE_CREDIT.mode;
  const days = Number(raw.days);
  const whole = Number.isFinite(days) ? Math.round(days) : DEFAULT_FORFEITED_FEE_CREDIT.days;
  return {
    mode,
    days: whole >= 1 && whole <= 3650 ? whole : DEFAULT_FORFEITED_FEE_CREDIT.days,
  };
}

/** created_at plus the configured number of days. */
export function creditExpiresAt(createdAt: Date, days: number): string {
  const span = readForfeitedFeeCreditSettings({ mode: "case_by_case", days }).days;
  return new Date(createdAt.getTime() + span * DAY_MS).toISOString();
}

/** A missing expiry is still usable (a credit saved before the column existed). */
export function creditExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now.getTime();
}

const ET = "America/New_York";

function etYmd(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/** Calendar days from today in America/New_York until expires_at. Null when there is no expiry. */
export function creditDaysLeft(expiresAt: string | null | undefined, now = new Date()): number | null {
  if (expiresAt == null || String(expiresAt).trim() === "") return null;
  const endMs = Date.parse(expiresAt);
  if (!Number.isFinite(endMs)) return null;
  const start = etYmd(now);
  const end = etYmd(new Date(endMs));
  if (!start || !end) return null;
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!a || !b) return null;
  const ms = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / DAY_MS);
}

/** Staff label for an Available credit. A past timestamp stays Expired on the card. */
export function creditCountdownLabel(expiresAt: string | null | undefined, now = new Date()): string {
  const days = creditDaysLeft(expiresAt, now);
  if (days == null) return "No expiry";
  if (days <= 0) return "Expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/** The rental a kept-fee note names, or the payment's rental when the note only says kept. */
export function keptFeeRentalId(notes: string | null | undefined, paymentRentalId: string | null | undefined): string | null {
  if (!isKeptFeeNote(notes)) return null;
  const named = KEPT_RENTAL.exec(String(notes ?? ""));
  if (named) return named[1].toLowerCase();
  const fallback = String(paymentRentalId ?? "").trim().toLowerCase();
  return fallback || null;
}

export type KeptFeePayment = {
  id: string;
  reason: string | null;
  status: string | null;
  notes: string | null;
  rentalId: string | null;
};

export type KeptFeeOffer = { rentalId: string; paymentId: string };

/** A renter credit that can be shown on a Cancelled booking row. */
export type CancelledRentalCredit = {
  id: string;
  applicationId: string;
  sourceRentalId: string | null;
  amount: number;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
};

function creditId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function creditRank(credit: CancelledRentalCredit, now: Date): number {
  if (credit.status === "available" && !creditExpired(credit.expiresAt, now)) return 0;
  if (credit.status === "available") return 1;
  if (credit.status === "applied") return 2;
  return 3;
}

/**
 * The credit for one Cancelled row. A source_rental_id match wins. When none
 * exists, a credit for the same driver with no source rental is the fallback.
 * A credit tied to a different rental stays on that rental. Void credits are
 * ignored. One driver can still match more than one row.
 */
export function creditForCancelledRental(
  rental: { id: string; applicationId?: string | null },
  credits: readonly CancelledRentalCredit[],
  now = new Date(),
): CancelledRentalCredit | null {
  const rentalId = creditId(rental.id);
  const applicationId = creditId(rental.applicationId);
  const live = credits.filter((credit) => credit.status !== "void");
  const byRental = rentalId ? live.filter((credit) => creditId(credit.sourceRentalId) === rentalId) : [];
  const pool = byRental.length
    ? byRental
    : applicationId
      ? live.filter((credit) => creditId(credit.applicationId) === applicationId && !creditId(credit.sourceRentalId))
      : [];
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const rank = creditRank(a, now) - creditRank(b, now);
    if (rank !== 0) return rank;
    return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
  })[0];
}

/**
 * Cancelled rows whose kept Reservation Fee has no live credit.
 * `liveCreditPaymentIds` is every non-void credit's source payment.
 */
export function keptFeeOffers(
  rentalIds: readonly string[],
  payments: readonly KeptFeePayment[],
  liveCreditPaymentIds: ReadonlySet<string>,
): KeptFeeOffer[] {
  const wanted = new Set(rentalIds.map((id) => id.toLowerCase()));
  const out: KeptFeeOffer[] = [];
  const seen = new Set<string>();
  for (const payment of payments) {
    if (String(payment.reason ?? "") !== "reservation_fee") continue;
    if (String(payment.status ?? "") !== "paid") continue;
    if (liveCreditPaymentIds.has(payment.id)) continue;
    const rentalId = keptFeeRentalId(payment.notes, payment.rentalId);
    if (!rentalId || !wanted.has(rentalId) || seen.has(rentalId)) continue;
    seen.add(rentalId);
    out.push({ rentalId, paymentId: payment.id });
  }
  return out;
}
