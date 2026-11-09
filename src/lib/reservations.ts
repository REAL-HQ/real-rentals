/** Pure helpers for soft vehicle reservations (rentals.status = reserved). */

import type { ReservationDepositStatus } from "@/lib/reservation-deposit-settings";

export const RESERVATION_STATUS = "reserved" as const;

export function isReservationStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "reserved" || s === "pending" || s === "upcoming";
}

/** YYYY-MM-DD calendar day, or null when the value is not a real date. */
export function reservationPickupDate(raw: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return match[0];
}

export function normalizeReservationNote(raw: string | null | undefined): string | null {
  const note = String(raw ?? "").trim().slice(0, 500);
  return note || null;
}

export type ReservationRow = {
  id: string;
  applicationId: string | null;
  driverUserId: string;
  driverName: string | null;
  vehicleId: string;
  vehicleLabel: string | null;
  unitNumber: string | null;
  pickupDate: string;
  note: string | null;
  createdAt: string;
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: ReservationDepositStatus;
  depositPaymentId: string | null;
};

/** Whether Start Rental should be blocked for a pending reservation deposit. */
export function reservationBlocksStart(input: {
  depositStatus: string | null | undefined;
  blockStartWhenPending: boolean;
}): boolean {
  return input.blockStartWhenPending === true && String(input.depositStatus) === "pending";
}
