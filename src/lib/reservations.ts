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

/** 24-hour HH:mm from the appointment picker. */
export function reservationPickupTime(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}


/**
 * The existing reservation_note column carries a small versioned appointment
 * record. Plain historical notes still read as notes; no schema change or
 * second reservation store is introduced.
 */
export function writeReservationDetails(input: {
  pickupTime: string;
  pickupLocation: string;
  note?: string | null;
}): string {
  const pickupTime = reservationPickupTime(input.pickupTime);
  const pickupLocation = String(input.pickupLocation ?? "").trim().slice(0, 180);
  if (!pickupTime) throw new Error("Pick A Real Pickup Time.");
  if (pickupLocation.length < 3) throw new Error("Enter A Pickup Location.");
  return JSON.stringify({
    reservation_details: 1,
    pickup_time: pickupTime,
    pickup_location: pickupLocation,
    note: normalizeReservationNote(input.note)?.slice(0, 140) ?? null,
  });
}

export function readReservationDetails(raw: string | null | undefined): {
  pickupTime: string | null;
  pickupLocation: string | null;
  note: string | null;
} {
  const fallback = { pickupTime: null, pickupLocation: null, note: normalizeReservationNote(raw) };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value?.reservation_details !== 1) return fallback;
    return {
      pickupTime: reservationPickupTime(typeof value.pickup_time === "string" ? value.pickup_time : null),
      pickupLocation: typeof value.pickup_location === "string" ? value.pickup_location : null,
      note: normalizeReservationNote(typeof value.note === "string" ? value.note : null),
    };
  } catch {
    return fallback;
  }
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
  pickupTime: string | null;
  pickupLocation: string | null;
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
