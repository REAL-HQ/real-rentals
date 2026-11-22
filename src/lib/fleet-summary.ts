/**
 * The single definition of fleet counts on the Overview. Every card reads
 * from this so "In Fleet" and "Total Vehicles" can never disagree again.
 * Status vocabulary mirrors VEHICLE_STATUSES in vehicles.functions.ts.
 *
 * Total is the working fleet. Archived, sold, and retired rows, and any row
 * with archived_at set, stay out of it. The Vehicles page total is a different
 * number: the whole table, labeled "Including Archived". Those totals match
 * when no car has left the fleet. Every car inside this total is in exactly
 * one slice: Rented, Reserved, Available, Maintenance, Needs Setup,
 * Unavailable, or Other.
 *
 * Occupancy (Rented) prefers live active rentals over vehicle.status, because
 * a vehicle can stay "available" after activation or stay "rented" after
 * return. Status mismatches are reported so staff can fix the row.
 * Utilization stays rented ÷ (available + reserved + rented). Unavailable,
 * maintenance, and needs-setup cars are in the total and out of that denominator.
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
  unavailable: number;
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

/**
 * Donut and legend colors. Maintenance is orange so it stays distinct from
 * Reserved yellow and Unavailable red. Other is indigo, the leftover bucket.
 */
export const FLEET_SNAPSHOT_COLORS = {
  rented: "#4CD964",
  reserved: "#FFCC33",
  available: "#C7C7CC",
  maintenance: "#F97316",
  setup: "#8E8E93",
  unavailable: "#FF3B30",
  other: "#5856D6",
} as const;

const FLEET_SNAPSHOT_SLICE_DEFS = [
  { key: "rented", label: "Rented", field: "rented", color: FLEET_SNAPSHOT_COLORS.rented },
  { key: "reserved", label: "Reserved", field: "reserved", color: FLEET_SNAPSHOT_COLORS.reserved },
  { key: "available", label: "Available", field: "available", color: FLEET_SNAPSHOT_COLORS.available },
  { key: "maintenance", label: "Maintenance", field: "maintenance", color: FLEET_SNAPSHOT_COLORS.maintenance },
  { key: "setup", label: "Needs Setup", field: "needsSetup", color: FLEET_SNAPSHOT_COLORS.setup },
  { key: "unavailable", label: "Unavailable", field: "unavailable", color: FLEET_SNAPSHOT_COLORS.unavailable },
  { key: "other", label: "Other", field: "other", color: FLEET_SNAPSHOT_COLORS.other },
] as const;

export type FleetSnapshotSlice = {
  key: (typeof FLEET_SNAPSHOT_SLICE_DEFS)[number]["key"];
  label: string;
  value: number;
  color: string;
};

/** Legend and donut rows, in display order. Their values sum to `total`. */
export function fleetSnapshotSlices(summary: FleetSummary): FleetSnapshotSlice[] {
  return FLEET_SNAPSHOT_SLICE_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: summary[def.field],
    color: def.color,
  }));
}

function blankSummary(): FleetSummary {
  return {
    total: 0,
    needsSetup: 0,
    available: 0,
    reserved: 0,
    rented: 0,
    maintenance: 0,
    unavailable: 0,
    other: 0,
    rentable: 0,
    utilizationPct: null,
  };
}

function isOutOfFleet(row: { archived_at?: string | null }, status: string): boolean {
  return Boolean(row.archived_at) || (INACTIVE_VEHICLE_STATUSES as readonly string[]).includes(status);
}

/** One working-fleet car, one counter. Unknown statuses land in Other. */
function countWorkingStatus(summary: FleetSummary, status: string): void {
  if (status === "onboarding") summary.needsSetup++;
  else if (status === "available") summary.available++;
  else if (status === "reserved") summary.reserved++;
  else if (status === "rented") summary.rented++;
  else if (status === "maintenance") summary.maintenance++;
  else if (status === "unavailable") summary.unavailable++;
  else summary.other++;
}

function finishSummary(summary: FleetSummary): FleetSummary {
  summary.rentable = summary.available + summary.reserved + summary.rented;
  summary.utilizationPct = summary.rentable > 0 ? Math.round((summary.rented / summary.rentable) * 100) : null;
  return summary;
}

export function summarizeFleet(
  rows: { status: string | null; archived_at?: string | null }[],
): FleetSummary {
  const summary = blankSummary();
  for (const row of rows) {
    const status = (row.status ?? "").toLowerCase();
    if (isOutOfFleet(row, status)) continue;
    summary.total++;
    countWorkingStatus(summary, status);
  }
  return finishSummary(summary);
}

/**
 * Distinct vehicle ids currently on an active rental. Null / blank ids are
 * ignored so a bad rental row cannot invent occupancy.
 */
export function activeRentalVehicleIds(
  rentals: { vehicle_id?: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const rental of rentals) {
    if (typeof rental.vehicle_id === "string" && rental.vehicle_id.length > 0) ids.add(rental.vehicle_id);
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
  const summary = blankSummary();
  for (const row of vehicles) {
    const status = (row.status ?? "").toLowerCase();
    if (isOutOfFleet(row, status)) continue;
    summary.total++;
    const id = typeof row.id === "string" && row.id.length > 0 ? row.id : null;
    const onRent = id != null && active.has(id);
    if (onRent && id) {
      summary.rented++;
      if (status !== "rented") {
        mismatches.push({ vehicleId: id, status: row.status, kind: "active_without_rented_status" });
      }
      continue;
    }
    if (status === "rented") {
      if (id) mismatches.push({ vehicleId: id, status: row.status, kind: "status_rented_without_active" });
      // Status lagged behind return — treat as available inventory, not rented.
      summary.available++;
      continue;
    }
    countWorkingStatus(summary, status);
  }
  return { ...finishSummary(summary), mismatches };
}
