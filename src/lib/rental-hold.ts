/**
 * On Hold rentals and Reservation Fee credits: pure rules (no I/O).
 *
 * On Hold (rentals.status = on_hold) is what staff set instead of releasing a
 * reservation or calling it a no-show. The vehicle stays held for the renter.
 * Every cron that works on Reserved rentals (late-pickup release, pickup
 * reminders, no-show and forfeiture texts) filters on status = reserved, so an
 * On Hold rental is skipped by them without any extra flag. The late-fee sweep
 * only touches active rentals. Resume puts it back to Reserved with a new pickup date.
 *
 * A Reservation Fee kept for a missed pickup can be turned into a renter credit
 * (renter_credits). A credit is never a refund and never a deposit; applying it
 * to a new rental counts it toward week 1 the same way an attached fee is.
 */

export const ON_HOLD_STATUS = "on_hold" as const;
export const ON_HOLD_LABEL = "On Hold";

export function isOnHoldStatus(status: string | null | undefined): boolean {
  return String(status ?? "").toLowerCase() === ON_HOLD_STATUS;
}

export const HOLD_REASON_MIN = 5;
export const HOLD_REASON_MAX = 300;

/** Staff must say why. Returns the trimmed reason, or an error message. */
export function checkHoldReason(raw: string | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < HOLD_REASON_MIN) return { ok: false, error: "Enter A Reason For The Hold (At Least 5 Characters)." };
  if (reason.length > HOLD_REASON_MAX) return { ok: false, error: "Keep The Reason Under 300 Characters." };
  return { ok: true, reason };
}

export type CreditStatus = "available" | "applied" | "void";
export const CREDIT_STATUSES: readonly CreditStatus[] = ["available", "applied", "void"];

/** A fee kept for a missed pickup carries `kept:late_pickup:<rental>` in its notes. */
export function isKeptFeeNote(notes: string | null | undefined): boolean {
  return /\bkept:/.test(String(notes ?? ""));
}
export function hasCreditNote(notes: string | null | undefined): boolean {
  return /\bcredit:next_rental\b/.test(String(notes ?? ""));
}
export function isCreditedToWeek1(notes: string | null | undefined): boolean {
  return /credited_week1/.test(String(notes ?? ""));
}

/** Note after turning a kept fee into a credit: kept:late_pickup:X becomes credit:next_rental:X. */
export function creditNoteFor(notes: string | null | undefined, sourceRentalId: string | null): string {
  const n = String(notes ?? "").trim();
  if (hasCreditNote(n)) return n;
  if (/\bkept:late_pickup:/.test(n)) return n.replace(/\bkept:late_pickup:/, "credit:next_rental:");
  return `${n} credit:next_rental${sourceRentalId ? `:${sourceRentalId}` : ""}`.trim();
}

/** Note after a credit is applied to a rental: credit:next_rental[:X] becomes credit_applied:<rental>. */
export function appliedNoteFor(notes: string | null | undefined, rentalId: string): string {
  const n = String(notes ?? "").replace(/\bcredit:next_rental(:[0-9a-f-]+)?/, "").replace(/\s+/g, " ").trim();
  return `${n} credit_applied:${rentalId}`.trim();
}

export type CreditSourceFee = {
  id: string;
  status: string | null;
  reason: string | null;
  type?: string | null;
  amount: number | string | null;
  refunded_amount?: number | string | null;
  notes?: string | null;
};

/** Can this payment row become a credit? Returns the credit amount or why not. */
export function creditableAmount(p: CreditSourceFee): { ok: true; amount: number } | { ok: false; error: string } {
  if (String(p.reason ?? "") !== "reservation_fee") return { ok: false, error: "Only A Reservation Fee Can Become A Credit." };
  if (String(p.status ?? "") !== "paid") return { ok: false, error: "That Reservation Fee Is Not Paid." };
  if (isCreditedToWeek1(p.notes)) return { ok: false, error: "That Reservation Fee Was Already Counted Toward A Week 1 Payment." };
  const amount = Math.round((Number(p.amount ?? 0) - Number(p.refunded_amount ?? 0)) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: "Nothing Is Left On That Reservation Fee To Credit." };
  return { ok: true, amount };
}

/** Only Reserved or On Hold rentals can take a credit (activation counts it toward week 1). */
export function canApplyCreditTo(rental: { status: string | null; application_id: string | null }, credit: { application_id: string | null; status: string }): { ok: true } | { ok: false; error: string } {
  if (credit.status !== "available") return { ok: false, error: "That Credit Is Not Available." };
  if (!rental.application_id || rental.application_id !== credit.application_id) return { ok: false, error: "That Credit Belongs To A Different Renter." };
  if (!["reserved", "on_hold"].includes(String(rental.status ?? ""))) return { ok: false, error: "Credits Apply To A Reserved Or On Hold Rental." };
  return { ok: true };
}
