/**
 * The single definition of fleet counts on the Overview. Every card reads
 * from this so "In Fleet" and "Total Vehicles" can never disagree again.
 * Status vocabulary mirrors VEHICLE_STATUSES in vehicles.functions.ts.
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
