/**
 * The $50 Reservation Fee (Dolmar, t299s1618 and t309u; SOP D6, D31). Client-safe.
 *
 * A Reservation Fee is NOT a deposit, and is never called one anywhere (t309u).
 * It is applied to rent (week 1). A deposit is a different thing: the per-car
 * security deposit, refundable at the end of the rental (when one is
 * collected) and used to deduct fees during it.
 *
 *   - Collected right after the renter signs, never before (t309u). With no card
 *     on file the renter pays the $50 through Stripe Checkout, which saves that
 *     card on file for the rental balance. A card already on file is charged.
 *   - Applied in full to week 1 (a Stripe balance credit at activation).
 *   - The car is held only once the fee is paid: FLEET cannot book the pickup
 *     before that, and a staff reservation shows the fee as pending.
 *   - Kept if the renter is 30+ minutes late and the car is released (D25; 30
 *     minutes per t309u).
 *
 * Storage note: the reservation row keeps the fee in the existing
 * rentals.reservation_deposit_* columns (a column rename needs a migration);
 * those columns hold the Reservation Fee, never the security deposit
 * (rentals.deposit_*).
 *
 * Switch: app_settings.reservation_fee_auto = { enabled, amount }. OFF with no
 * row (proposed/reservation-fee-auto-on.sql turns it on).
 */

export const RESERVATION_FEE_SETTINGS_KEY = "reservation_fee_auto";
export const RESERVATION_FEE_DEFAULT_AMOUNT = 50;
/** payments.reason and the notes prefix that identify a Reservation Fee charge. */
export const RESERVATION_FEE_REASON = "reservation_fee";
export const reservationFeeNote = (agreementId: string) => `reservation_fee:${agreementId}`;

export type ReservationFeeSettings = { enabled: boolean; amount: number };

export function readReservationFeeSettings(value: unknown): ReservationFeeSettings {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const amount = Number(v.amount);
  return {
    enabled: v.enabled === true,
    amount: Number.isFinite(amount) && amount >= 1 && amount <= 500 ? Math.round(amount * 100) / 100 : RESERVATION_FEE_DEFAULT_AMOUNT,
  };
}

/**
 * The Reservation Fee the SIGNED agreement printed, or null. The fee is only
 * ever charged when the signed text carries it: the agreement recorded a
 * Required Reservation Fee (merge_data._prep) and its body names it.
 */
export function signedReservationFee(ag: { body?: string | null; merge_data?: Record<string, unknown> | null }): number | null {
  const merge = (ag.merge_data ?? {}) as Record<string, unknown>;
  let amount = 0;
  try {
    const prep = JSON.parse(String(merge._prep ?? "")) as { reservation?: { mode?: string; amount?: number | null } };
    if (prep.reservation?.mode === "required") amount = Number(prep.reservation.amount ?? 0);
  } catch {
    return null;
  }
  if (!(amount > 0)) return null;
  if (!/reservation fee/i.test(String(ag.body ?? ""))) return null;
  return Math.round(amount * 100) / 100;
}

export type ReservationFeeOutcome =
  | { status: "off" | "no_fee_on_agreement" | "not_found" }
  | { status: "already_paid"; amount: number; paymentId: string }
  | { status: "no_card"; amount: number; paymentId: string | null }
  | { status: "checkout"; amount: number; paymentId: string; url: string }
  | { status: "paid" | "pending"; amount: number; paymentId: string; last4: string | null }
  | { status: "failed"; amount: number; paymentId: string | null; error: string };

/** Renter-facing line in the Agreement Signed email. */
export function reservationFeeEmailLine(o: ReservationFeeOutcome): string | null {
  if (o.status === "paid" || o.status === "already_paid") {
    const last4 = o.status === "paid" && o.last4 ? ` ending in ${o.last4}` : "";
    return `Your $${o.amount.toFixed(2)} Reservation Fee was charged to your card${last4} and is applied in full to your first week. Your car is now held for your pickup.`;
  }
  if (o.status === "checkout") return `Next step: pay your $${o.amount.toFixed(2)} Reservation Fee by card with the button below. It is applied in full to your first week, and the card you use is saved on file for your rental balance. Your car is held as soon as it is paid. This link is for your rental and expires within 24 hours.`;
  if (o.status === "pending") return `Your $${o.amount.toFixed(2)} Reservation Fee is processing on your card. It is applied in full to your first week, and your car is held as soon as it goes through.`;
  return null;
}

/** The Reservation Fee pay button for the Agreement Signed email (card collected after signing). */
export function reservationFeePayLink(o: ReservationFeeOutcome): { url: string; amount: number } | null {
  return o.status === "checkout" ? { url: o.url, amount: o.amount } : null;
}
