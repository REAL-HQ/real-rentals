/**
 * The public "Cars Available" override from app_settings.fleet_availability
 * (exposed to the city pages by the cars_available() RPC).
 *
 * A missing or unreadable value is "not set", never 0. Number(null) is 0 in
 * JavaScript, and treating a cleared override as 0 puts city landing pages
 * into waitlist mode by accident.
 */
export function parseCarsAvailable(data: unknown): number | null {
  if (data == null || data === "") return null;
  if (typeof data === "boolean") return null;
  const n = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}
