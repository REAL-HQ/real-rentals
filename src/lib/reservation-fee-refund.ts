/**
 * Refundable $50 Reservation Fee policy (Dolmar, t405u / t406u, Nov 17 2026).
 * Client-safe: reason codes, labels and the renter-facing policy text.
 *
 * The fee is refunded in full only for the six reasons below. It is not
 * refunded for a no-show, a change of mind, a missed pickup without notice,
 * or information the driver provided that was false or did not match.
 * Copy never names the insurance broker or carrier.
 */
export const RESERVATION_FEE_REFUND_REASONS = [
  "insurance_declined",
  "no_vehicle",
  "failed_inspection",
  "terms_changed",
  "post_payment_denial",
  "duplicate_or_mistaken_charge",
] as const;

export type ReservationFeeRefundReason = (typeof RESERVATION_FEE_REFUND_REASONS)[number];

export const RESERVATION_FEE_REFUND_REASON_LABEL: Record<ReservationFeeRefundReason, string> = {
  insurance_declined: "Insurance Declined",
  no_vehicle: "No Car On The Start Date",
  failed_inspection: "Failed Pickup Inspection",
  terms_changed: "We Changed The Confirmed Terms",
  post_payment_denial: "Denied By A Check After Payment",
  duplicate_or_mistaken_charge: "Duplicate Or Mistaken Charge",
};

/** Automations switch. OFF until an Owner turns it on. */
export const AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY = "auto_refund_reservation_on_insurance_decline";

export const RESERVATION_FEE_REFUND_NOTE_RE = /\brefunded:([a-z_]+)\b/;

export function isReservationFeeRefundReason(v: unknown): v is ReservationFeeRefundReason {
  return (RESERVATION_FEE_REFUND_REASONS as readonly string[]).includes(String(v ?? ""));
}

export function parseReservationFeeRefundReason(v: unknown): ReservationFeeRefundReason | null {
  return isReservationFeeRefundReason(v) ? v : null;
}

/** Pull a refund reason out of payment notes (`refunded:insurance_declined`). */
export function refundReasonFromNotes(notes: string | null | undefined): ReservationFeeRefundReason | null {
  const m = String(notes ?? "").match(RESERVATION_FEE_REFUND_NOTE_RE);
  return m ? parseReservationFeeRefundReason(m[1]) : null;
}

export function reservationFeeRefundedDetail(reason?: string | null): string {
  const parsed = parseReservationFeeRefundReason(reason);
  return parsed ? `Refunded - ${RESERVATION_FEE_REFUND_REASON_LABEL[parsed]}` : "Refunded";
}

/**
 * Encode the reason on the Next Step status string without changing the Next
 * Step card: "refunded:insurance_declined" displays as "Refunded - …".
 */
export function reservationFeeDisplayStatus(status: string | null | undefined, reason?: string | null): string | null {
  if (status == null || status === "") return null;
  if (String(status) === "refunded" || String(status).startsWith("refunded:")) {
    const r = parseReservationFeeRefundReason(reason) ?? parseReservationFeeRefundReason(String(status).split(":")[1]);
    return r ? `refunded:${r}` : "refunded";
  }
  return String(status);
}

/** Plain-language policy shown when a refund is blocked or no reason is chosen. */
export const RESERVATION_FEE_REFUND_POLICY =
  "The $50 Reservation Fee is refunded in full only when: (1) we cannot set up the Renter Policy for you; " +
  "(2) we cannot provide the car, or a similar one, within one to two days of the start date; " +
  "(3) the car fails its pickup inspection and we cannot swap it; " +
  "(4) we change the confirmed weekly rate, start date, or car, and you decline the change; " +
  "(5) a check we run after you pay (including a background check or income review) means we cannot rent to you; or " +
  "(6) the fee was charged in error or more than once. " +
  "It is not refunded if you do not show for pickup, change your mind, miss pickup without notice, or provided information that was false or did not match.";

/** Shorter staff-facing policy (same rules). */
export const RESERVATION_FEE_REFUND_POLICY_STAFF =
  "Refund the Reservation Fee in full only for: insurance declined; no car on the start date (and no similar car offered within 1–2 days); the car fails pickup inspection and cannot be swapped; we change the confirmed terms (rate, start date, or car) and the driver declines; the driver is denied by a check we run after payment; or a duplicate or mistaken charge. " +
  "Do not refund for a no-show, a change of mind, a missed pickup without notice, or false or mismatched information from the driver.";
