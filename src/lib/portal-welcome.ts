/**
 * Pure rules for the one Driver Portal welcome (t463u / t466u). Client-safe.
 */

/** Audit action that marks the welcome as sent. One per application, ever. */
export const PORTAL_WELCOME_AUDIT_ACTION = "portal.welcome_sent";

/**
 * Written at activation when the pickup payment is not paid yet. The payment
 * path only sends for an application that carries this marker, so renters
 * activated before this change (who already got the old activation welcome)
 * are never emailed again by a weekly rent payment.
 */
export const PORTAL_WELCOME_PENDING_ACTION = "portal.welcome_pending";

export type PickupPaymentRow = {
  id?: string | null;
  type?: string | null;
  reason?: string | null;
  status?: string | null;
  rental_id?: string | null;
  driver_id?: string | null;
};

function lower(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** The $50 Reservation Fee never opens the portal. */
export function isReservationFeePayment(row: PickupPaymentRow): boolean {
  return lower(row.reason) === "reservation_fee";
}

/**
 * A paid charge that pays for the rental itself at pickup:
 *  - anything paid on this rental (rent, a 1-day rental charge, a deposit), or
 *  - rent paid on the application before activation (linked later).
 * Never the Reservation Fee.
 */
export function isPickupPayment(row: PickupPaymentRow, ids: { rentalId: string | null; applicationId: string }): boolean {
  if (lower(row.status) !== "paid") return false;
  if (isReservationFeePayment(row)) return false;
  if (ids.rentalId && row.rental_id === ids.rentalId) return true;
  return row.driver_id === ids.applicationId && lower(row.type) === "rent";
}

export type WelcomeOutcome =
  | "sent"
  | "already"
  | "off"
  | "held"
  | "not_picked_up"
  | "not_paid"
  | "no_email"
  | "conflict"
  | "failed";
