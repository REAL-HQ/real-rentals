/**
 * One vehicle by vehicle_id or license plate, for the FLEET expense calls.
 * Refuses (never guesses) when the id or plate is missing, malformed, unknown
 * or ambiguous. Plates match ignoring case, spaces and dashes.
 */
import { fleetJson, UUID_RE } from "@/lib/fleet-api.server";
import { vinLast6 } from "@/lib/vehicle-label";
import { normalizePlate } from "@/lib/vehicle-maintenance";

export const FLEET_VEHICLE_COLUMNS = "id,license_plate,vin,archived_at";

export type FleetVehicleRow = { id: string; license_plate: string | null; vin: string | null; archived_at: string | null };

export async function resolveFleetVehicle(
  admin: any,
  body: Record<string, unknown>,
  opts: { allowArchived?: boolean } = {},
): Promise<{ vehicle: FleetVehicleRow } | { response: Response }> {
  const rawPlate = body.license_plate ?? body.plate;
  const id = body.vehicle_id == null || body.vehicle_id === "" ? null : String(body.vehicle_id);
  const hasPlate = rawPlate != null && rawPlate !== "";
  const plate = hasPlate ? normalizePlate(rawPlate) : null;
  if (hasPlate && !plate)
    return { response: fleetJson(400, { ok: false, error: "license_plate must be 2-12 letters or numbers." }) };
  if (id && !UUID_RE.test(id)) return { response: fleetJson(400, { ok: false, error: "vehicle_id must be a UUID." }) };
  if (!id && !plate) return { response: fleetJson(400, { ok: false, error: "Send vehicle_id or license_plate." }) };
  const archivedRefusal = () => fleetJson(409, { ok: false, error: "This vehicle is archived. Nothing was saved." });

  if (id) {
    const res = await admin.from("vehicles").select(FLEET_VEHICLE_COLUMNS).eq("id", id).maybeSingle();
    if (res.error) return { response: fleetJson(503, { ok: false, error: "Could not read the vehicle." }) };
    if (!res.data) return { response: fleetJson(404, { ok: false, error: "Vehicle not found." }) };
    if (plate && normalizePlate(res.data.license_plate) !== plate)
      return { response: fleetJson(409, { ok: false, error: "vehicle_id and license_plate do not match." }) };
    if (res.data.archived_at && !opts.allowArchived) return { response: archivedRefusal() };
    return { vehicle: res.data };
  }

  // "AB%C%1" matches AB-C 1 as well as ABC1; the exact comparison is below.
  const pattern = [...(plate as string)].join("%");
  const res = await admin.from("vehicles").select(FLEET_VEHICLE_COLUMNS).ilike("license_plate", pattern).limit(25);
  if (res.error) return { response: fleetJson(503, { ok: false, error: "Could not read the vehicle." }) };
  const rows = ((res.data ?? []) as FleetVehicleRow[]).filter((r) => normalizePlate(r.license_plate) === plate);
  const live = rows.filter((r) => !r.archived_at);
  if (live.length > 1)
    return { response: fleetJson(409, { ok: false, error: "More than one vehicle has that plate. Send vehicle_id." }) };
  if (live.length === 1) return { vehicle: live[0] };
  if (rows.length > 1) return { response: fleetJson(409, { ok: false, error: "More than one vehicle has that plate. Send vehicle_id." }) };
  if (rows.length === 1) {
    if (opts.allowArchived) return { vehicle: rows[0] };
    return { response: archivedRefusal() };
  }
  return { response: fleetJson(404, { ok: false, error: "Vehicle not found." }) };
}

/** Plate and the last 6 of the VIN. Never the unit number or the full VIN. */
export function fleetVehicleRef(vehicle: FleetVehicleRow) {
  return {
    vehicle_id: vehicle.id,
    license_plate: vehicle.license_plate ? String(vehicle.license_plate).toUpperCase() : null,
    vin_last6: vinLast6(vehicle.vin) || null,
  };
}
