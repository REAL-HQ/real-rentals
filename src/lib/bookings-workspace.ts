/** Pure helpers for the Bookings page tabs (Reserved / Active / Completed / Cancelled). */

export const BOOKINGS_VIEWS = [
  { id: "reserved", label: "Reserved" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
] as const;

export type BookingsView = (typeof BOOKINGS_VIEWS)[number]["id"];

export function parseBookingsView(
  raw: string | undefined | null,
  opts: { canViewBoard: boolean; openId?: string | null },
): BookingsView {
  const v = String(raw ?? "").toLowerCase();
  // "booked" is the old name for Reserved. "past" and "all" are the old Past
  // tab, which is now Completed. Old links keep working.
  if (v === "reserved" || v === "booked") return "reserved";
  if (v === "cancelled" || v === "canceled" || v === "swap") return "cancelled";
  if (v === "completed" || v === "past" || v === "all") return "completed";
  if (v === "active" || v === "board") return opts.canViewBoard ? "active" : "completed";
  if (opts.openId) return "completed";
  return opts.canViewBoard ? "active" : "completed";
}
