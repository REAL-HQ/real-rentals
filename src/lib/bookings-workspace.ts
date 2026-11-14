/** Pure helpers for the Bookings page tabs (Booked / Active / Past). */

export const BOOKINGS_VIEWS = [
  { id: "booked", label: "Booked" },
  { id: "active", label: "Active" },
  { id: "past", label: "Past" },
] as const;

export type BookingsView = (typeof BOOKINGS_VIEWS)[number]["id"];

export function parseBookingsView(
  raw: string | undefined | null,
  opts: { canViewBoard: boolean; openId?: string | null },
): BookingsView {
  const v = String(raw ?? "").toLowerCase();
  if (v === "booked" || v === "reserved") return "booked";
  if (v === "past" || v === "all") return "past";
  if (v === "active" || v === "board") return opts.canViewBoard ? "active" : "past";
  if (opts.openId) return "past";
  return opts.canViewBoard ? "active" : "past";
}
