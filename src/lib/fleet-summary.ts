/**
 * The single definition of fleet counts on the Overview. Every card reads
 * from this so "In Fleet" and "Total Vehicles" can never disagree again.
 * Status vocabulary mirrors VEHICLE_STATUSES in vehicles.functions.ts.
 *
 * Total is the working fleet. Archived, sold, and retired rows, and any row
 * with archived_at set, stay out of it. For Sale stays in the total, in its
 * own slice, and out of Available. The Vehicles page total is a different
 * number: the whole table, labeled "Including Archived". Those totals match
 * when no car has left the fleet. Every car inside this total is in exactly
 * one slice: Rented, Reserved, Pending Reservation, Available, Maintenance,
 * Needs Setup, Unavailable, For Sale, or Other.
 *
 * Pending Reservation is the soft hold after the Reservation Fee is paid and
 * before the insurance card is issued. It is not Available (the car cannot
 * be offered or booked for anyone else) and it is not Rented. It stays in
 * the rentable denominator with Available, Reserved, and Rented:
 * utilization = rented ÷ (available + reserved + pending reservation + rented).
 * Leaving it out of that denominator would raise utilization just because a
 * car was held. Counting it as rented would overstate occupancy.
 *
 * Occupancy (Rented) prefers live active rentals over vehicle.status, because
 * a vehicle can stay "available" after activation or stay "rented" after
 * return. Status mismatches are reported so staff can fix the row.
 * Utilization is rented ÷ (available + reserved + pending reservation + rented).
 * Unavailable, maintenance, needs-setup, and For Sale cars are in the total
 * and out of that denominator. Pending Reservation stays in the denominator.
 */
export const INACTIVE_VEHICLE_STATUSES = ["archived", "sold", "retired"] as const;
/** Stored value for the For Sale status. The label is "For Sale". */
export const FOR_SALE_VEHICLE_STATUS = "for_sale";
/**
 * Statuses the public catalog must not list. Matches vehicles_public once
 * the For Sale migration is applied; the app also filters For Sale so a car
 * stays off the site before that migration runs.
 */
export const PUBLIC_HIDDEN_VEHICLE_STATUSES = ["retired", "archived", "sold", "for_sale"] as const;

export function isForSaleVehicleStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_") === FOR_SALE_VEHICLE_STATUS;
}

export function isPublicHiddenVehicleStatus(status: string | null | undefined): boolean {
  const key = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (PUBLIC_HIDDEN_VEHICLE_STATUSES as readonly string[]).includes(key);
}
/**
 * Statuses that take part in rental utilization. Pending Reservation is held
 * inventory: not Available, not earning, and still in the denominator.
 */
export const RENTABLE_VEHICLE_STATUSES = ["available", "reserved", "pending_reservation", "rented"] as const;

export type FleetSummary = {
  total: number;
  needsSetup: number;
  available: number;
  reserved: number;
  /** Fee paid, insurance card not issued. Not Available and not Rented. */
  pendingReservation: number;
  rented: number;
  maintenance: number;
  unavailable: number;
  /** Unarchived, not on a rental, status for_sale. Not part of Available. */
  forSale: number;
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
 * Donut and legend colors. Green, yellow, gray, red, and blue, plus a
 * second yellow for Pending Reservation so Reserved keeps #FFCC33.
 * Maintenance, Needs Setup, and Unavailable share Unavailable's red.
 * Other uses the same gray as Available. For Sale is blue, and it is not
 * counted as Available.
 */
const FLEET_SNAPSHOT_GREEN = "#4CD964";
const FLEET_SNAPSHOT_YELLOW = "#FFCC33";
const FLEET_SNAPSHOT_PENDING_YELLOW = "#FFE566";
const FLEET_SNAPSHOT_GRAY = "#C7C7CC";
const FLEET_SNAPSHOT_RED = "#FF3B30";
const FLEET_SNAPSHOT_BLUE = "#007AFF";

export const FLEET_SNAPSHOT_COLORS = {
  rented: FLEET_SNAPSHOT_GREEN,
  reserved: FLEET_SNAPSHOT_YELLOW,
  pendingReservation: FLEET_SNAPSHOT_PENDING_YELLOW,
  available: FLEET_SNAPSHOT_GRAY,
  maintenance: FLEET_SNAPSHOT_RED,
  setup: FLEET_SNAPSHOT_RED,
  unavailable: FLEET_SNAPSHOT_RED,
  forSale: FLEET_SNAPSHOT_BLUE,
  other: FLEET_SNAPSHOT_GRAY,
} as const;

const FLEET_SNAPSHOT_SLICE_DEFS = [
  { key: "rented", label: "Rented", field: "rented", color: FLEET_SNAPSHOT_COLORS.rented },
  { key: "reserved", label: "Reserved", field: "reserved", color: FLEET_SNAPSHOT_COLORS.reserved },
  { key: "pending_reservation", label: "Pending Reservation", field: "pendingReservation", color: FLEET_SNAPSHOT_COLORS.pendingReservation },
  { key: "available", label: "Available", field: "available", color: FLEET_SNAPSHOT_COLORS.available },
  { key: "maintenance", label: "Maintenance", field: "maintenance", color: FLEET_SNAPSHOT_COLORS.maintenance },
  { key: "setup", label: "Needs Setup", field: "needsSetup", color: FLEET_SNAPSHOT_COLORS.setup },
  { key: "unavailable", label: "Unavailable", field: "unavailable", color: FLEET_SNAPSHOT_COLORS.unavailable },
  { key: "for_sale", label: "For Sale", field: "forSale", color: FLEET_SNAPSHOT_COLORS.forSale },
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
    pendingReservation: 0,
    rented: 0,
    maintenance: 0,
    unavailable: 0,
    forSale: 0,
    other: 0,
    rentable: 0,
    utilizationPct: null,
  };
}

function vehicleStatusKey(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isOutOfFleet(row: { archived_at?: string | null }, status: string): boolean {
  return Boolean(row.archived_at) || (INACTIVE_VEHICLE_STATUSES as readonly string[]).includes(status);
}

/** One working-fleet car, one counter. Unknown statuses land in Other. */
function countWorkingStatus(summary: FleetSummary, status: string): void {
  if (status === "onboarding") summary.needsSetup++;
  else if (status === "available") summary.available++;
  else if (status === "reserved") summary.reserved++;
  else if (status === "pending_reservation") summary.pendingReservation++;
  else if (status === "rented") summary.rented++;
  else if (status === "maintenance") summary.maintenance++;
  else if (status === "unavailable") summary.unavailable++;
  else if (status === FOR_SALE_VEHICLE_STATUS) summary.forSale++;
  else summary.other++;
}

function finishSummary(summary: FleetSummary): FleetSummary {
  summary.rentable = summary.available + summary.reserved + summary.pendingReservation + summary.rented;
  summary.utilizationPct = summary.rentable > 0 ? Math.round((summary.rented / summary.rentable) * 100) : null;
  return summary;
}

export function summarizeFleet(
  rows: { status: string | null; archived_at?: string | null }[],
): FleetSummary {
  const summary = blankSummary();
  for (const row of rows) {
    const status = vehicleStatusKey(row.status);
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
    const status = vehicleStatusKey(row.status);
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
