/**
 * POST /api/public/fleet/gps-readings (Bearer FLEET_API_KEY).
 *
 * { "collected_at": "2026-11-15T20:11:00-05:00",
 *   "readings": [{ "device": "CZ06DA - ...", "last_report_at": "...", "stopped_since": "...",
 *                  "moving": false, "address": "1 Davis Islands Brg, Tampa, FL 33606",
 *                  "lat": 27.93, "lng": -82.45, "status_text": "Stopped 1 d 8 h" }] }
 *
 * Matches each reading to a car (vehicle id, tracker id, or the plate at the
 * start of the tracker label), applies the rules in gps-alerts.ts and sends
 * one team alert per car, rule and Eastern day (team-alerts.server.ts).
 *
 * While the GPS team alert is OFF (the default) this is a dry run: it reports
 * what it would alert and writes nothing. When ON it also stores the latest
 * reading on the car (gps_last_ping_at, gps_last_location, gps_status).
 * Tracker labels are never stored (they can carry a renter's name); renter
 * phone numbers are never read.
 */
import { fleetAdmin, fleetJson, fleetRequestBody, type FleetDeps } from "@/lib/fleet-api.server";
import { isForSaleVehicleStatus } from "@/lib/fleet-summary";
import { evaluateGps, matchVehicle, type GpsFinding, type GpsReading, type GpsVehicle } from "@/lib/gps-alerts";
import type { TeamAlertDeps } from "@/lib/team-alerts.server";

type Admin = any;
export type GpsDeps = FleetDeps & TeamAlertDeps;

const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
const etDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

export async function handleGpsReadings(request: Request, deps: GpsDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const now = (deps.now ?? (() => new Date()))();
  const admin: Admin = await fleetAdmin(deps);
  const readings = Array.isArray(body.readings) ? (body.readings as GpsReading[]).slice(0, 200) : null;
  if (!readings) return fleetJson(400, { ok: false, error: "readings must be a list." });

  const v = await admin.from("vehicles").select("id,license_plate,unit_number,gps_device_id,status,year,make,model,archived_at").is("archived_at", null).limit(500);
  if (v.error) return fleetJson(503, { ok: false, error: "Database unavailable." });
  const cars: GpsVehicle[] = ((v.data ?? []) as any[]).filter((c) => !isForSaleVehicleStatus(c.status)).map((c) => ({
    id: c.id, license_plate: c.license_plate ?? null, unit_number: c.unit_number ?? null, gps_device_id: c.gps_device_id ?? null, status: c.status ?? null,
    label: [c.unit_number, [c.year, c.make, c.model].filter(Boolean).join(" "), c.license_plate].filter(Boolean).join(" · "),
  }));

  const { loadTeamAlertSettings, sendTeamAlert } = await import("@/lib/team-alerts.server");
  const settings = deps.settings ?? (await loadTeamAlertSettings(admin));
  const live = settings.gps === true;

  const unmatched: string[] = [];
  const findings: GpsFinding[] = [];
  const sent: any[] = [];
  for (const r of readings) {
    const car = matchVehicle(r, cars);
    if (!car) { unmatched.push(String(r.device ?? r.vehicle_id ?? "").replace(/\s+-\s+.*/, "").slice(0, 40)); continue; }
    const f = evaluateGps(r, car, now);
    findings.push(...f);
    if (!live) continue;
    const loc = { address: r.address ?? null, lat: r.lat ?? null, lng: r.lng ?? null, at: r.last_report_at ?? null, stopped_since: r.stopped_since ?? null };
    await admin.from("vehicles").update({
      gps_last_ping_at: r.last_report_at ?? null,
      gps_last_location: loc,
      gps_status: String(r.status_text ?? (r.moving ? "Moving" : "")).slice(0, 80) || null,
    }).eq("id", car.id);
    for (const x of f) {
      sent.push(await sendTeamAlert(admin, {
        kind: "gps",
        dedupeKey: `${car.id}:${x.rule}:${etDay(now)}`,
        title: `${x.rule === "outside_area" ? "GPS OUTSIDE AREA" : x.rule === "offline" ? "GPS OFFLINE" : "GPS NO MOVEMENT 48H"}: ${car.unit_number ?? car.license_plate ?? "Car"} - Check Tracker`,
        lines: [x.message, "From the latest tracker check. Look at the tracker map before acting; nothing was done to the car."],
        link: `${SITE()}/admin?tab=vehicles&id=${encodeURIComponent(car.id)}`,
        vehicleId: car.id,
      }, { ...deps, settings }));
    }
  }
  return fleetJson(200, { ok: true, dry_run: !live, matched: readings.length - unmatched.length, unmatched, findings, alerts: sent });
}
