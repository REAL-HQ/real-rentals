/**
 * GPS alerts to a person (Dolmar, t299s1618; SOP D18). Client-safe rules, no I/O.
 *
 * Three alerts, for trackers matched to a car in the app:
 *   outside_area   the car is outside the service area: more than
 *                  GPS_RULES.maxMilesFromShop (100) miles from Tampa (the shop),
 *                  Dolmar t311u. A reading with only an address and a state
 *                  other than Florida is also outside (all of FL beyond
 *                  100 miles is caught by the distance check).
 *   offline        the tracker has not reported for GPS_RULES.offlineHours,
 *                  or the tracker itself says no power / not reporting
 *   no_movement    a car on an active rental has not moved for
 *                  GPS_RULES.noMovementHours (48)
 *
 * The app has no live tracker feed today: readings arrive from FLEET's
 * twice-daily tracker check (POST /api/public/fleet/gps-readings), or later
 * from the tracker provider's API. See docs/gps-alerts.md.
 */

export const GPS_RULES = {
  /** Only a fallback for readings with no coordinates; every point within 100 miles of Tampa is in FL. */
  serviceStates: ["FL"] as readonly string[],
  /** Center of the service area: the shop (3500 E Hillsborough Ave, Tampa, FL 33610). */
  shop: { lat: 27.9813, lng: -82.4157 },
  /** Service area radius: 100 miles of Tampa (Dolmar, t311u; was 150). */
  maxMilesFromShop: 100,
  offlineHours: 24,
  noMovementHours: 48,
} as const;

export type GpsReading = {
  /** Tracker label as the provider shows it, a plate, or the app vehicle id. */
  device?: string | null;
  vehicle_id?: string | null;
  /** When the tracker last reported (ISO with zone). */
  last_report_at?: string | null;
  /** When the car last stopped, if it is stopped now (ISO with zone). */
  stopped_since?: string | null;
  moving?: boolean | null;
  address?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Provider status words, e.g. "No power 2 d 22 h", "Stopped 1 d 3 h". */
  status_text?: string | null;
};

export type GpsVehicle = { id: string; license_plate: string | null; unit_number: string | null; gps_device_id: string | null; status: string | null; label: string };
export type GpsRule = "outside_area" | "offline" | "no_movement";
export type GpsFinding = { vehicle_id: string; rule: GpsRule; message: string };

/** Plates and labels compare without spaces/dashes, upper case, letter O as zero and I as one. */
export function plateKey(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
}

/** Which car a reading belongs to: vehicle id, then tracker id, then the plate at the start of the label. */
export function matchVehicle(r: GpsReading, cars: readonly GpsVehicle[]): GpsVehicle | null {
  if (r.vehicle_id) return cars.find((c) => c.id === r.vehicle_id) ?? null;
  const dev = String(r.device ?? "").trim();
  if (!dev) return null;
  const byDevice = cars.find((c) => c.gps_device_id && c.gps_device_id.trim().toLowerCase() === dev.toLowerCase());
  if (byDevice) return byDevice;
  const first = plateKey(dev.split(/\s+-\s+|\s+/)[0]);
  if (first.length < 5) return null;
  return cars.find((c) => plateKey(c.license_plate) === first) ?? null;
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Two-letter state from a reading: the state field, or ", FL 33610" at the end of the address. */
export function readingState(r: GpsReading): string | null {
  const s = String(r.state ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  const m = /,\s*([A-Z]{2})\s+\d{5}(-\d{4})?\s*(,\s*(USA|US|United States))?\s*$/i.exec(String(r.address ?? ""));
  return m ? m[1].toUpperCase() : null;
}

const hoursSince = (iso: string | null | undefined, now: Date) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (now.getTime() - t) / 3600_000 : null;
};

export function evaluateGps(r: GpsReading, car: GpsVehicle, now: Date, rules = GPS_RULES): GpsFinding[] {
  const out: GpsFinding[] = [];
  const where = r.address ? ` at ${String(r.address).slice(0, 120)}` : "";
  const state = readingState(r);
  const far = Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)) && r.lat != null && r.lng != null
    ? milesBetween(rules.shop, { lat: Number(r.lat), lng: Number(r.lng) })
    : null;
  const outside = far !== null ? far > rules.maxMilesFromShop : Boolean(state && !rules.serviceStates.includes(state));
  if (outside) {
    out.push({ vehicle_id: car.id, rule: "outside_area", message: `${car.label} is outside the ${rules.maxMilesFromShop}-mile service area around Tampa${where}${far !== null ? ` (${Math.round(far)} miles from the shop)` : ""}.` });
  }
  const silent = hoursSince(r.last_report_at, now);
  const noPower = /\b(no power|not reporting|offline|unplugged|disconnected)\b/i.test(String(r.status_text ?? ""));
  if (noPower || (silent !== null && silent >= rules.offlineHours)) {
    out.push({ vehicle_id: car.id, rule: "offline", message: `${car.label} tracker is offline${silent !== null ? ` (last report ${Math.floor(silent)} hours ago)` : ""}${noPower ? `: ${String(r.status_text).slice(0, 60)}` : ""}.` });
  }
  const onRental = String(car.status ?? "").toLowerCase() === "rented";
  const still = r.moving === true ? 0 : hoursSince(r.stopped_since, now);
  if (onRental && !noPower && still !== null && still >= rules.noMovementHours) {
    out.push({ vehicle_id: car.id, rule: "no_movement", message: `${car.label} (on rental) has not moved for ${Math.floor(still)} hours${where}.` });
  }
  return out;
}
