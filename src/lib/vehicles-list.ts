// Browser-safe shapes and helpers for the Vehicles list (List 1).

export const VEHICLE_LIST_PAGE_SIZE = 50;
export const VEHICLE_SORTS = ["unit", "make", "rate", "newest"] as const;
export type VehicleSort = (typeof VEHICLE_SORTS)[number];

export type VehicleListRow = {
  id: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  color: string | null;
  license_plate: string | null;
  vin: string | null;
  status: string | null;
  body_type: string | null;
  weekly_rate: number | null;
  partner_id: string | null;
  photo: string | null;
  on_rent: boolean;
};

export type VehicleListResult = {
  rows: VehicleListRow[];
  total: number;
  page: number;
  pageSize: number;
  statuses: string[];
  bodyTypes: string[];
};

const TEXT_FIELDS = ["unit_number", "vin", "license_plate", "make", "model", "trim", "color"] as const;

/**
 * PostgREST `or` filter for the search box: unit, VIN, plate, make, model,
 * trim, color by substring; year by exact number. Characters that carry
 * meaning in the filter grammar are stripped so input cannot widen the query.
 */
export function buildVehicleSearchOr(raw: string): string | null {
  const q = raw.replace(/[,()*%\\"':]/g, " ").trim().slice(0, 100);
  if (!q) return null;
  const parts = TEXT_FIELDS.map((f) => `${f}.ilike.*${q}*`);
  if (/^\d{4}$/.test(q)) parts.push(`year.eq.${q}`);
  return parts.join(",");
}

/** Availability shown in the list: running rental first, then operational status. */
export function availabilityLabel(row: Pick<VehicleListRow, "on_rent" | "status">): string {
  if (row.on_rent) return "On Rent";
  if (row.status === "onboarding") return "Needs Setup";
  return (row.status ?? "—").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
