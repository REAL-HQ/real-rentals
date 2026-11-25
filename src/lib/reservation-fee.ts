/**
 * The $50 Reservation Fee (Dolmar, t299s1618 and t309u; SOP D6, D31). Client-safe.
 *
 * A Reservation Fee is NOT a deposit, and is never called one anywhere (t309u).
 * It is applied to rent (week 1). A deposit is a different thing: the per-car
 * security deposit, refundable at the end of the rental (when one is
 * collected) and used to deduct fees during it.
 *
 *   - Collected right after the renter signs, never before (t309u). Every
 *     renter pays the $50 through Stripe Checkout, which saves that card on
 *     file for the rental balance. A card already saved from an earlier rental
 *     is never charged automatically for the fee (card t315s1710).
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

const FEE_NOTE_AGREEMENT = /^reservation_fee:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

/** The agreement id a Reservation Fee payment's notes name, or null. */
export function agreementIdFromReservationFeeNotes(notes: unknown): string | null {
  const match = FEE_NOTE_AGREEMENT.exec(String(notes ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

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
  | { status: "covered"; amount: number; paymentId: string }
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

/**
 * The agreement prints a Reservation Fee but signing produced no way to pay
 * it (no Checkout link, nothing paid or processing). Staff must send a link.
 * null for off / no fee / amendment / checkout / paid / pending.
 */
export function reservationFeeLinkProblem(o: ReservationFeeOutcome): { amount: number; reason: string } | null {
  if (o.status === "no_card") return { amount: o.amount, reason: "card checkout could not be created" };
  if (o.status === "failed") return { amount: o.amount > 0 ? o.amount : 50, reason: o.error || "unexpected error" };
  return null;
}

/** What the staff "Copy Reservation Fee Link" action returns for an outcome. Client-safe. */
export function staffReservationFeeLinkResult(o: ReservationFeeOutcome): { ok: true; url: string; amount: number } | { ok: false; message: string } {
  if (o.status === "checkout") return { ok: true, url: o.url, amount: o.amount };
  if (o.status === "already_paid" || o.status === "paid" || o.status === "covered") return { ok: false, message: "The Reservation Fee Is Already Paid." };
  if (o.status === "pending") return { ok: false, message: "The Reservation Fee Payment Is Still Processing." };
  if (o.status === "off") return { ok: false, message: "The Reservation Fee Is Turned Off." };
  if (o.status === "no_fee_on_agreement" || o.status === "not_found") return { ok: false, message: "No Signed Agreement With A Reservation Fee." };
  return { ok: false, message: "Card Checkout Could Not Be Created. Try Again, Or Record A Manual Payment." };
}

/** The Reservation Fee pay button for the Agreement Signed email (card collected after signing). */
export function reservationFeePayLink(o: ReservationFeeOutcome): { url: string; amount: number } | null {
  return o.status === "checkout" ? { url: o.url, amount: o.amount } : null;
}

/**
 * What the signing page shows right after a successful signature (Dolmar,
 * t413u follow-up): the applicant goes straight to the SAME $50 Stripe
 * Checkout the Agreement Signed email links to. Never a second session; the
 * email button stays as the backup. Client-safe.
 *
 *   - "pay": an open Checkout exists; the page sends them there (with a
 *     prominent button in case the redirect is blocked or they come back).
 *   - "paid": the fee was already collected; nothing to pay.
 *   - "processing": the card payment is going through.
 *   - null: fee switch off, no fee on the agreement, an amendment, or a
 *     checkout that could not be created (staff follow up). The page shows the
 *     plain "Agreement Signed" screen as before.
 */
export type ReservationFeeSigningStep =
  | { state: "pay"; amount: number; url: string }
  | { state: "paid"; amount: number }
  | { state: "processing"; amount: number };

/** Only an https Checkout link is ever handed to the browser. */
export function safeCheckoutUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function reservationFeeSigningStep(o: ReservationFeeOutcome | null | undefined): ReservationFeeSigningStep | null {
  if (!o) return null;
  if (o.status === "checkout") {
    const url = safeCheckoutUrl(o.url);
    return url ? { state: "pay", amount: o.amount, url } : null;
  }
  if (o.status === "paid" || o.status === "already_paid" || o.status === "covered") return { state: "paid", amount: o.amount };
  if (o.status === "pending") return { state: "processing", amount: o.amount };
  return null;
}

/** Checkout lives 23 hours (reservation-fee.server.ts); an older link is not offered. */
export const RESERVATION_FEE_CHECKOUT_TTL_MS = 23 * 3600 * 1000;

/** Where Stripe Checkout returns the renter after paying or backing out. */
export const RESERVATION_FEE_RETURN_PATH = "/reservation-fee";
/**
 * Stripe replaces this literal with the Checkout Session id on success and on
 * cancel, so the Payment Received page can look up its receipt and the
 * Payment Not Completed page can look up the car, photos and availability
 * (payment-received.server.ts, payment-not-completed.server.ts). Only sessions
 * created after this shipped carry it; older cancel links fall back to the
 * page without live numbers.
 */
export const CHECKOUT_SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";
export function reservationFeeReturnUrls(site: string): { success: string; cancel: string } {
  const base = `${site.replace(/\/+$/, "")}${RESERVATION_FEE_RETURN_PATH}`;
  return {
    success: `${base}?status=paid&session_id=${CHECKOUT_SESSION_ID_TEMPLATE}`,
    cancel: `${base}?status=canceled&session_id=${CHECKOUT_SESSION_ID_TEMPLATE}`,
  };
}

/**
 * Benefits recap on the Stripe-hosted Reservation Fee checkout (line item
 * description, left side). Every item comes from the renter-facing agreement
 * ("What's Included in Your Rental", agreement-v114.ts). No refund wording, no
 * carrier or broker name.
 */
export const RESERVATION_FEE_BENEFITS = [
  "Car For Gig Work",
  "Any Gig Platform",
  "Insurance Included",
  "Unlimited Miles",
  "Maintenance Included",
  "Repair Swaps",
] as const;
export const RESERVATION_FEE_CHECKOUT_DESCRIPTION = RESERVATION_FEE_BENEFITS.join(" · ");
export function reservationFeeSubmitMessage(amount: number): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `Your $${n} Reservation Fee holds your car and is applied to your first week's rent. You get: ${RESERVATION_FEE_BENEFITS.slice(0, -1).join(", ")}, and ${RESERVATION_FEE_BENEFITS[RESERVATION_FEE_BENEFITS.length - 1]}.`;
}

/** Auto-redirect delay on the signing page: long enough to read "Agreement Signed". */
export const RESERVATION_FEE_REDIRECT_SECONDS = 4;
