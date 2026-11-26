// What a payments row IS, for the Payments Type column, its Type filter and every
// rent-standing read. One place, so a Reservation Fee is never filtered as a
// generic Fee and a $50/day rent payment is never left out of rent.
//
// payments.type is the stored value. Until the payments_type_check migration in
// proposed/payments-type-reservation-v1.sql is applied, the database refuses
// type = 'reservation', so Reservation Fee rows are still stored as type 'fee'
// with reason 'reservation_fee' (or notes 'reservation_fee:<agreement>'). This
// reads both shapes as Reservation, before and after the migration.
import { RESERVATION_FEE_REASON } from "@/lib/reservation-fee";

export const PAYMENT_CATEGORIES = ["reservation", "rent", "deposit", "late_fee", "toll", "damage", "fee", "other"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export const PAYMENT_CATEGORY_LABEL: Record<PaymentCategory, string> = {
  reservation: "Reservation",
  rent: "Rent",
  deposit: "Deposit",
  late_fee: "Late Fee",
  toll: "Toll",
  damage: "Damage",
  fee: "Fee",
  other: "Other",
};

/**
 * payments.type the app writes for a Reservation Fee. The payments_type_check
 * migration (proposed/payments-type-reservation-v1.sql) was applied on
 * production Nov 19 2026 (Dolmar t518s2906), so new Reservation Fees are stored
 * as 'reservation'. Older 'fee' + reason 'reservation_fee' rows still read as
 * Reservation through isReservationRow.
 */
export const RESERVATION_ROW_TYPE: "fee" | "reservation" = "reservation";

export type CategorizableRow = { type?: unknown; reason?: unknown; notes?: unknown };

function text(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function isReservationRow(row: CategorizableRow): boolean {
  const type = text(row.type);
  if (type === "reservation") return true;
  if (type && type !== "fee") return false;
  return text(row.reason) === RESERVATION_FEE_REASON || text(row.notes).startsWith(`${RESERVATION_FEE_REASON}:`);
}

export function paymentCategory(row: CategorizableRow): PaymentCategory {
  if (isReservationRow(row)) return "reservation";
  const type = text(row.type) || "rent";
  return (PAYMENT_CATEGORIES as readonly string[]).includes(type) ? (type as PaymentCategory) : "other";
}

export function paymentCategoryLabel(row: CategorizableRow): string {
  return PAYMENT_CATEGORY_LABEL[paymentCategory(row)];
}

export function isRentRow(row: CategorizableRow): boolean {
  return paymentCategory(row) === "rent";
}
