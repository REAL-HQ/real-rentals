/**
 * Past-tab reading of a rental that ended because the car was swapped.
 *
 * complete_rental_vehicle_swap_tx does not cancel a rental and does not write
 * end_date. It keeps the same row active and points vehicle_id at the new car.
 * The end of the old car is rental_vehicle_swaps.completed_at, and the reason
 * is already reason_code + reason on that row.
 *
 * What shows up as Cancelled with no end date is a different rental row that
 * still names the outgoing car (a leftover reservation cancelled without an
 * end date, or a cancelled row the pointer never moved off of). This module
 * matches those rows to a completed swap. It does not guess: no completed
 * swap, no end date, no length.
 */
import { bookingPhase, type BookingPhase } from "@/lib/bookings-list";

export type RentalSpan = {
  id: string;
  status: string | null;
  vehicleId: string | null;
  applicationId: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type SwapRecord = {
  id: string;
  swapNumber: number | null;
  rentalId: string;
  applicationId: string;
  fromVehicleId: string;
  completedAt: string;
  reasonCode: string;
  reason: string;
};

const CANCELLED = new Set(["cancelled", "canceled", "void", "voided"]);

export function isCancelledRentalStatus(status: string | null | undefined): boolean {
  return CANCELLED.has(String(status ?? "").toLowerCase());
}

/** Calendar date in America/New_York. A date-only value is kept as written. */
export function etCalendarDate(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function calendarDays(start: string, end: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(start.trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(end.trim());
  if (!a || !b) return null;
  const ms = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) - Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

function unit(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * How long the rental lasted, in Title Case.
 * "14 Days (2 Weeks)", "8 Days (1 Week 1 Day)", "1 Day", "Same Day".
 * Missing dates, or an end before the start, return null — nothing is guessed.
 * The count is the return date minus the start date (a two-week rental that
 * starts Nov 1 and is returned Nov 15 is 14 days).
 */
export function rentalLengthLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const days = calendarDays(start, end);
  if (days == null || days < 0) return null;
  if (days === 0) return "Same Day";
  const weeks = Math.floor(days / 7);
  const rem = days % 7;
  const daysLabel = unit(days, "Day");
  if (weeks === 0) return daysLabel;
  const weeksLabel = unit(weeks, "Week");
  if (rem === 0) return `${daysLabel} (${weeksLabel})`;
  return `${daysLabel} (${weeksLabel} ${unit(rem, "Day")})`;
}

/**
 * Which cancelled rental each completed swap ended.
 *
 * A swap claims at most one row: the cancelled rental that still names
 * from_vehicle_id for the same driver. The swap's own rental wins when that
 * row is itself cancelled and still on the old car. Otherwise the latest
 * start date on or before the swap, and not before the continuing rental's
 * start, wins — an older cancelled reservation of the same car is left as
 * Cancelled. Earliest swap claims first.
 */
export function swapEndsByRentalId(
  rentals: readonly RentalSpan[],
  swaps: readonly SwapRecord[],
): Map<string, SwapRecord> {
  const out = new Map<string, SwapRecord>();
  const cancelled = rentals.filter((r) => isCancelledRentalStatus(r.status) && r.vehicleId && r.applicationId);
  const byId = new Map(rentals.map((r) => [r.id, r]));
  const ordered = [...swaps].filter((s) => s.completedAt).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  for (const swap of ordered) {
    const end = etCalendarDate(swap.completedAt);
    if (!end) continue;
    const continuing = byId.get(swap.rentalId);
    const candidates = cancelled.filter((r) => {
      if (out.has(r.id)) return false;
      if (r.applicationId !== swap.applicationId) return false;
      if (r.vehicleId !== swap.fromVehicleId) return false;
      if (r.startDate && r.startDate > end) return false;
      if (r.endDate && r.endDate < end) return false;
      if (r.id === swap.rentalId) return true;
      if (continuing?.startDate && r.startDate && r.startDate < continuing.startDate) return false;
      return true;
    });
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const aSame = a.id === swap.rentalId ? 1 : 0;
      const bSame = b.id === swap.rentalId ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      const as = a.startDate ?? "";
      const bs = b.startDate ?? "";
      if (as !== bs) return bs.localeCompare(as);
      return b.id.localeCompare(a.id);
    });
    out.set(candidates[0].id, swap);
  }
  return out;
}

export function presentRentalSpan(
  rental: RentalSpan,
  swap: SwapRecord | null,
): { phase: BookingPhase; endDate: string | null; lengthLabel: string | null } {
  const phase: BookingPhase = swap ? "swap" : bookingPhase(rental.status);
  const recorded = rental.endDate ? rental.endDate.slice(0, 10) : null;
  const endDate = recorded ?? (swap ? etCalendarDate(swap.completedAt) : null);
  const lengthLabel = phase === "active" || phase === "reserved" ? null : rentalLengthLabel(rental.startDate, endDate);
  return { phase, endDate, lengthLabel };
}
