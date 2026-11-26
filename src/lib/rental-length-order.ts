// Rental length order for the four Bookings tabs.
//
// Default leaves each tab's existing order alone. Longest First and Shortest
// First compare a number of calendar days. A row with no length sorts last in
// either direction so a missing date is never treated as zero.
//
// Active: days since the start date (a future start is zero).
// Completed and Cancelled: start-to-end days, the same span the length label uses.
// Reserved: days the car has been held, from the Reserved column (createdAt)
// through today. Pickup is the appointment, not a length.

import { calendarDaysBetween } from "@/lib/active-rentals";
import { etCalendarDate } from "@/lib/swap-ended-rental";

export const RENTAL_LENGTH_ORDERS = ["default", "longest", "shortest"] as const;
export type RentalLengthOrder = (typeof RENTAL_LENGTH_ORDERS)[number];

/** Length order, or the Owes Money filter on the same Bookings dropdown. */
export const BOOKINGS_LIST_MODES = ["default", "longest", "shortest", "owes"] as const;
export type BookingsListMode = (typeof BOOKINGS_LIST_MODES)[number];

export function isRentalLengthOrder(value: unknown): value is RentalLengthOrder {
  return value === "default" || value === "longest" || value === "shortest";
}

export function isBookingsListMode(value: unknown): value is BookingsListMode {
  return isRentalLengthOrder(value) || value === "owes";
}

/** The same test as the red "$600 due" line and the "Owes $100.00" line. */
export function owesAmount(amount: number | null | undefined): boolean {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}

export function orderByLength<T extends { id: string }>(
  rows: readonly T[],
  days: (row: T) => number | null,
  order: RentalLengthOrder,
): T[] {
  if (order === "default") return [...rows];
  return [...rows].sort((a, b) => {
    const ad = days(a);
    const bd = days(b);
    if (ad == null || bd == null) {
      if (ad == null && bd == null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return ad == null ? 1 : -1;
    }
    if (ad !== bd) return order === "longest" ? bd - ad : ad - bd;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The page is a slice of an already-ordered list, never a sort of one page. */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (Math.max(1, page) - 1) * pageSize);
  return rows.slice(start, start + pageSize);
}

/** Days since the start date. A future start counts as zero. Missing stays null. */
export function activeLengthDays(startDate: string | null | undefined, today: string): number | null {
  const days = calendarDaysBetween(startDate, today);
  if (days == null) return null;
  return Math.max(0, days);
}

/**
 * Days the reservation has been held.
 * The Reserved column is createdAt. That date is read in America/New_York,
 * the same zone the rest of the board uses for calendar days.
 */
export function heldLengthDays(createdAt: string | null | undefined, today: string): number | null {
  const reserved = etCalendarDate(createdAt);
  const days = calendarDaysBetween(reserved, today);
  if (days == null) return null;
  return Math.max(0, days);
}

/** Start-to-end calendar days. An end before the start is not a length. */
export function endedLengthDays(start: string | null | undefined, end: string | null | undefined): number | null {
  const days = calendarDaysBetween(start, end);
  if (days == null || days < 0) return null;
  return days;
}

export type EndedLengthSpan = {
  id: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
};

/**
 * Rows that belong on this Bookings list, in caller order, with a length.
 * `present` supplies the phase and the end date the tab already shows
 * (including a swap's completion date). The caller has already applied
 * search and the vehicle filter, so this does not widen that set.
 */
export function endedLengthCandidates<T extends EndedLengthSpan>(
  spans: readonly T[],
  present: (span: T) => { phase: string; endDate: string | null },
  opts: {
    statusFilter: readonly string[] | null;
    scope: string;
    phase: string;
    showsEnded: boolean;
  },
): Array<{ id: string; days: number | null }> {
  const allowed = opts.statusFilter ? new Set(opts.statusFilter) : null;
  const out: Array<{ id: string; days: number | null }> = [];
  for (const span of spans) {
    if (allowed && !allowed.has(String(span.status ?? ""))) continue;
    const presented = present(span);
    if (opts.phase === "swap" && presented.phase !== "swap") continue;
    if (opts.scope === "past" && opts.phase === "cancelled" && presented.phase === "swap") continue;
    if (
      opts.showsEnded &&
      presented.phase !== "completed" &&
      presented.phase !== "cancelled" &&
      presented.phase !== "swap"
    ) {
      continue;
    }
    if (!opts.showsEnded && opts.phase !== "all" && opts.phase !== "swap" && presented.phase !== opts.phase) continue;
    out.push({ id: span.id, days: endedLengthDays(span.startDate, presented.endDate) });
  }
  return out;
}
