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
  /** "renter": booked by the renter on the Payment Received page (payment-received.server.ts). */
  bookedBy?: "renter" | null;
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
    // Only written for renter bookings, so staff and FLEET records stay byte-identical.
    ...(input.bookedBy === "renter" ? { booked_by: "renter" } : {}),
  });
}

export function readReservationDetails(raw: string | null | undefined): {
  pickupTime: string | null;
  pickupLocation: string | null;
  note: string | null;
  bookedBy: "renter" | null;
} {
  const fallback = { pickupTime: null, pickupLocation: null, note: normalizeReservationNote(raw), bookedBy: null };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value?.reservation_details !== 1) return fallback;
    return {
      pickupTime: reservationPickupTime(typeof value.pickup_time === "string" ? value.pickup_time : null),
      pickupLocation: typeof value.pickup_location === "string" ? value.pickup_location : null,
      note: normalizeReservationNote(typeof value.note === "string" ? value.note : null),
      bookedBy: value.booked_by === "renter" ? "renter" : null,
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
  /** "renter" when the renter picked the slot on the Payment Received page. */
  bookedBy: "renter" | null;
  createdAt: string;
  /** "reserved" or "on_hold" (On Hold keeps the car held; crons skip it). */
  status?: string;
  holdReason?: string | null;
  holdStartedAt?: string | null;
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: ReservationDepositStatus;
  depositPaymentId: string | null;
  /** Vehicle details for the Reserved list (same facts the Active list shows). */
  plate?: string | null;
  vinLast6?: string | null;
  thumbnailPath?: string | null;
  /** Manager+ only; the server leaves it out for a Coordinator. */
  weeklyRate?: number | null;
};

export type ReservationFeeLabel = "Paid" | "Unpaid" | "Waived" | "Refunded" | "Not Required";

/** Unpaid reservation fee is the balance due on the Reserved list. */
export function reservationOwes(status: string | null | undefined, feeOn: boolean): boolean {
  return reservationFeeLabel(status, feeOn) === "Unpaid";
}

/**
 * The $50 Reservation Fee as staff read it on the Reserved list.
 * paid / applied (already counted toward week 1) read Paid; pending reads
 * Unpaid; a fee that is switched off for this reservation reads Not Required
 * rather than claiming anything is owed.
 */
export function reservationFeeLabel(status: string | null | undefined, feeOn: boolean): ReservationFeeLabel {
  const s = String(status ?? "").toLowerCase();
  if (s === "paid" || s === "applied") return "Paid";
  if (s === "waived") return "Waived";
  if (s === "refunded") return "Refunded";
  if (s === "pending") return "Unpaid";
  return feeOn ? "Unpaid" : "Not Required";
}

export function vinLast6(vin: string | null | undefined): string | null {
  const v = String(vin ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v ? v.slice(-6) : null;
}

/** Whether Start Rental should be blocked for a pending reservation deposit. */
export function reservationBlocksStart(input: {
  depositStatus: string | null | undefined;
  blockStartWhenPending: boolean;
}): boolean {
  return input.blockStartWhenPending === true && String(input.depositStatus) === "pending";
}
