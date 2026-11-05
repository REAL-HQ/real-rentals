/**
 * Shared vehicle display + search helpers for admin pickers.
 * Form values stay as vehicle.id; labels never replace the id.
 */

export type VehicleLabelSource = {
  id?: string;
  unit_number?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
  vin?: string | null;
  status?: string | null;
};

/** Last 6 of a VIN for lists and assigned-car cards. */
export function vinLast6(vin: string | null | undefined): string {
  const n = String(vin ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return n.length >= 6 ? n.slice(-6) : n;
}

function part(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v).trim();
}

/**
 * Display label: unit · year make model · plate · VIN last 6 · status.
 * Empty segments are omitted (no hanging separators).
 */
export function formatVehicleLabel(v: VehicleLabelSource): string {
  const unit = part(v.unit_number);
  const ymm = [part(v.year), part(v.make), part(v.model)].filter(Boolean).join(" ");
  const plate = part(v.license_plate).toUpperCase();
  const last6 = vinLast6(v.vin);
  const status = part(v.status);
  const bits: string[] = [];
  if (unit) bits.push(unit);
  if (ymm) bits.push(ymm);
  if (plate) bits.push(plate);
  if (last6) bits.push(`VIN …${last6}`);
  if (status) bits.push(status);
  return bits.join(" · ") || "Vehicle";
}

/** Compact secondary line: plate + VIN last 6 (for cards/headers). */
export function formatVehicleIdentityLine(v: VehicleLabelSource): string {
  const plate = part(v.license_plate).toUpperCase();
  const last6 = vinLast6(v.vin);
  const bits: string[] = [];
  if (plate) bits.push(plate);
  if (last6) bits.push(`VIN …${last6}`);
  return bits.join(" · ");
}

/** Lowercased tokens used for combobox filtering. */
export function vehicleSearchText(v: VehicleLabelSource): string {
  const plate = part(v.license_plate).toUpperCase();
  const vin = part(v.vin).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const last6 = vinLast6(vin);
  return [
    part(v.unit_number),
    part(v.year),
    part(v.make),
    part(v.model),
    plate,
    vin,
    last6,
    part(v.status),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** True when the vehicle matches a free-text query (plate, VIN, last 6, unit, make/model/year). */
export function vehicleMatchesQuery(v: VehicleLabelSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = vehicleSearchText(v);
  // Also allow matching a space-free plate/VIN fragment against tokens.
  const compact = q.replace(/\s+/g, "");
  if (hay.includes(q)) return true;
  if (compact && hay.replace(/\s+/g, "").includes(compact)) return true;
  return false;
}

/** Columns every vehicle query should include so the combobox can label/search. */
export const VEHICLE_COMBOBOX_SELECT =
  "id,unit_number,year,make,model,license_plate,vin,status" as const;
