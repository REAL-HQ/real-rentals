/**
 * The single definition of fleet counts on the Overview. Every card reads
 * from this so "In Fleet" and "Total Vehicles" can never disagree again.
 * Status vocabulary mirrors VEHICLE_STATUSES in vehicles.functions.ts.
 *
 * Occupancy (Rented) prefers live active rentals over vehicle.status, because
 * a vehicle can stay "available" after activation or stay "rented" after
 * return. Status mismatches are reported so staff can fix the row.
 */
export const INACTIVE_VEHICLE_STATUSES = ["archived", "sold", "retired"] as const;
/** Statuses that take part in rental utilization. */
export const RENTABLE_VEHICLE_STATUSES = ["available", "reserved", "rented"] as const;

export type FleetSummary = {
  total: number;
  needsSetup: number;
  available: number;
  reserved: number;
  rented: number;
  maintenance: number;
  other: number;
  rentable: number;
  /** null when nothing is rentable — never report a misleading 0%. */
  utilizationPct: number | null;
};

export type FleetVehicleRow = {
  id?: string | null;
  status: string | null;
  archived_at?: string | null;
};

export type FleetStatusMismatch = {
  vehicleId: string;
  status: string | null;
  kind: "status_rented_without_active" | "active_without_rented_status";
};

export function summarizeFleet(
  rows: { status: string | null; archived_at?: string | null }[],
): FleetSummary {
  const s: FleetSummary = {
    total: 0, needsSetup: 0, available: 0, reserved: 0, rented: 0,
    maintenance: 0, other: 0, rentable: 0, utilizationPct: null,
  };
  for (const r of rows) {
    const st = (r.status ?? "").toLowerCase();
    if (r.archived_at || (INACTIVE_VEHICLE_STATUSES as readonly string[]).includes(st)) continue;
    s.total++;
    if (st === "onboarding") s.needsSetup++;
    else if (st === "available") s.available++;
    else if (st === "reserved") s.reserved++;
    else if (st === "rented") s.rented++;
    else if (st === "maintenance") s.maintenance++;
    else s.other++;
  }
  s.rentable = s.available + s.reserved + s.rented;
  s.utilizationPct = s.rentable > 0 ? Math.round((s.rented / s.rentable) * 100) : null;
  return s;
}

/**
 * Distinct vehicle ids currently on an active rental. Null / blank ids are
 * ignored so a bad rental row cannot invent occupancy.
 */
export function activeRentalVehicleIds(
  rentals: { vehicle_id?: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const r of rentals) {
    if (typeof r.vehicle_id === "string" && r.vehicle_id.length > 0) ids.add(r.vehicle_id);
  }
  return ids;
}

/**
 * Occupancy from active rentals, with status-based inventory for the rest.
 * A vehicle on an active rental counts as Rented even when status lagged.
 * Vehicles marked rented with no active rental are flagged and counted under
 * Available so utilization tracks real rentals.
 */
export function summarizeFleetOccupancy(
  vehicles: FleetVehicleRow[],
  activeVehicleIds: Iterable<string>,
): FleetSummary & { mismatches: FleetStatusMismatch[] } {
  const active = activeVehicleIds instanceof Set ? activeVehicleIds : new Set(activeVehicleIds);
  const mismatches: FleetStatusMismatch[] = [];
  const s: FleetSummary = {
    total: 0, needsSetup: 0, available: 0, reserved: 0, rented: 0,
    maintenance: 0, other: 0, rentable: 0, utilizationPct: null,
  };
  for (const r of vehicles) {
    const st = (r.status ?? "").toLowerCase();
    if (r.archived_at || (INACTIVE_VEHICLE_STATUSES as readonly string[]).includes(st)) continue;
    s.total++;
    const id = typeof r.id === "string" && r.id.length > 0 ? r.id : null;
    const onRent = id != null && active.has(id);
    if (onRent && id) {
      s.rented++;
      if (st !== "rented") {
        mismatches.push({ vehicleId: id, status: r.status, kind: "active_without_rented_status" });
      }
      continue;
    }
    if (st === "rented") {
      if (id) mismatches.push({ vehicleId: id, status: r.status, kind: "status_rented_without_active" });
      // Status lagged behind return — treat as available inventory, not rented.
      s.available++;
      continue;
    }
    if (st === "onboarding") s.needsSetup++;
    else if (st === "available") s.available++;
    else if (st === "reserved") s.reserved++;
    else if (st === "maintenance") s.maintenance++;
    else s.other++;
  }
  s.rentable = s.available + s.reserved + s.rented;
  s.utilizationPct = s.rentable > 0 ? Math.round((s.rented / s.rentable) * 100) : null;
  return { ...s, mismatches };
}
