/** Pure helpers for the Bookings page tabs (Reserved / Active / Past). */

export const BOOKINGS_VIEWS = [
  { id: "reserved", label: "Reserved" },
  { id: "active", label: "Active" },
  { id: "past", label: "Past" },
] as const;

export type BookingsView = (typeof BOOKINGS_VIEWS)[number]["id"];

export function parseBookingsView(
  raw: string | undefined | null,
  opts: { canViewBoard: boolean; openId?: string | null },
): BookingsView {
  const v = String(raw ?? "").toLowerCase();
  // "booked" is the old name for this tab; old links keep working.
  if (v === "reserved" || v === "booked") return "reserved";
  if (v === "past" || v === "all") return "past";
  if (v === "active" || v === "board") return opts.canViewBoard ? "active" : "past";
  if (opts.openId) return "past";
  return opts.canViewBoard ? "active" : "past";
}
