/**
 * The unpaid Reservation Fee holds the assigned car for a limited time
 * (default 24 hours from signing). Staff can release it at any time inside
 * that window. The hours live in app_settings under RESERVATION_FEE_HOLD_HOURS_KEY
 * when someone sets them; this module never inserts that row.
 */

export const RESERVATION_FEE_HOLD_HOURS_KEY = "reservation_fee_hold_hours";
export const DEFAULT_RESERVATION_FEE_HOLD_HOURS = 24;
export const EXPIRED_FEE_STATUS = "expired";
/** Notes marker on a fee that was paid after the car was already released. */
export const NO_HOLD_NOTE = "reservation_fee_no_hold";

const UNPAID_BLOCK = new Set(["paid", "refunded", "void", "waived", "expired"]);

/** A positive whole number of hours, otherwise the 24-hour default. */
export function reservationFeeHoldHours(value: unknown): number {
  const raw = typeof value === "number" || typeof value === "string"
    ? value
    : value && typeof value === "object" && "hours" in value
      ? (value as { hours?: unknown }).hours
      : null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 168) return DEFAULT_RESERVATION_FEE_HOLD_HOURS;
  return Math.round(n);
}

export function holdDeadline(signedAt: string | Date, hours: number): Date | null {
  const t = signedAt instanceof Date ? signedAt.getTime() : Date.parse(String(signedAt));
  if (!Number.isFinite(t)) return null;
  return new Date(t + reservationFeeHoldHours(hours) * 3_600_000);
}

/** True while now is still before the deadline. Equal to the deadline means the window is closed. */
export function holdWindowOpen(signedAt: string | Date | null | undefined, now: Date, hours: number): boolean {
  if (!signedAt) return false;
  const end = holdDeadline(signedAt, hours);
  return !!end && now.getTime() < end.getTime();
}

export function reservationFeeHoldSentence(hours: number): string {
  const n = reservationFeeHoldHours(hours);
  return `If the Reservation Fee is not paid within ${n} ${n === 1 ? "hour" : "hours"}, the car is released.`;
}

/** Confirm copy. Staff must see that the original signer's payment link is turned off. */
export function releaseConfirmMessage(driverName: string | null | undefined): string {
  const who = (driverName ?? "").trim() || "This signer";
  return `Release ${who}'s car now? Their payment link will be turned off, and the car can be assigned to someone else right away.`;
}

export function unpaidFeeBlockMessage(driverName: string | null | undefined): string {
  const who = (driverName ?? "").trim() || "Another signer";
  return `${who} has this car on an unpaid Reservation Fee. Release it on Bookings > Reserved first. That turns off their payment link.`;
}

/**
 * An approved applicant who still has this car assigned keeps it busy, except
 * when their Reservation Fee was released (status expired) and nothing unpaid
 * remains. A missing fee row still blocks: the car was assigned before signing.
 */
export function assignmentStillBlocks(fees: readonly { status?: unknown; type?: unknown; reason?: unknown; notes?: unknown }[]): boolean {
  const rows = fees.filter((row) => isReservationFeeLike(row));
  if (rows.some((row) => !UNPAID_BLOCK.has(String(row.status ?? "").trim().toLowerCase()))) return true;
  if (rows.some((row) => String(row.status ?? "").trim().toLowerCase() === EXPIRED_FEE_STATUS)) return false;
  return true;
}

function isReservationFeeLike(row: { type?: unknown; reason?: unknown; notes?: unknown }): boolean {
  const type = String(row.type ?? "").trim().toLowerCase();
  const reason = String(row.reason ?? "").trim().toLowerCase();
  const notes = String(row.notes ?? "");
  return type === "reservation" || reason === "reservation_fee" || notes.startsWith("reservation_fee:");
}
