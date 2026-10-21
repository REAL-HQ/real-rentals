// Browser-safe shapes and helpers for the Vehicles list (List 1).
import { isRentalReady, rentalReadyItems } from "@/lib/vehicle-readiness";

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
  /** Where this car sits on the two gates the fleet is actually judged by. */
  readiness: ReadinessBand;
  /** What is missing, named — so the list can say WHY, not just "not ready". */
  readinessGaps: string[];
};

/**
 * Readiness across the whole fleet, in the same three words the vehicle's own
 * profile uses.
 *
 * Deliberately NOT a fourth definition of readiness: the bands are computed
 * from rentalReadyItems() and one published listing photo — the same rules
 * public.vehicle_rental_ready_missing and public.vehicle_listing_ready_missing
 * enforce server-side. A car being ready never changes its status, and this
 * never gates anything; it is how an operator finds the cars that need work
 * without opening nine records one at a time.
 */
export const READINESS_BANDS = ["listing_ready", "rental_ready", "not_ready"] as const;
export type ReadinessBand = (typeof READINESS_BANDS)[number];
export const READINESS_FILTERS = ["all", ...READINESS_BANDS] as const;

export const READINESS_LABEL: Record<ReadinessBand, string> = {
  listing_ready: "Listing Ready",
  rental_ready: "Rental Ready",
  not_ready: "Needs Setup",
};

/** One line explaining what each band means, for the filter and the tooltip. */
export const READINESS_HINT: Record<ReadinessBand, string> = {
  listing_ready: "Rental Ready, with a published listing photo.",
  rental_ready:
    "Can be rented — year, make, model, a valid VIN and a weekly rate. No published photo yet.",
  not_ready: "Missing something a rental needs.",
};

export function readinessBand(
  v: Record<string, unknown>,
  hasPublishedPhoto: boolean,
): ReadinessBand {
  if (!isRentalReady(v)) return "not_ready";
  return hasPublishedPhoto ? "listing_ready" : "rental_ready";
}

/** The missing pieces, in the order the profile checklist lists them. */
export function readinessGaps(v: Record<string, unknown>, hasPublishedPhoto: boolean): string[] {
  const gaps = rentalReadyItems(v)
    .filter((i) => !i.done)
    .map((i) => i.label);
  if (!gaps.length && !hasPublishedPhoto) gaps.push("Published Listing Photo");
  return gaps;
}

export function isReadinessFilter(v: unknown): v is (typeof READINESS_FILTERS)[number] {
  return (READINESS_FILTERS as readonly string[]).includes(String(v));
}

/** Fleet-wide tally, for the chips above the list. */
export type ReadinessCounts = Record<ReadinessBand, number>;

export type VehicleListResult = {
  rows: VehicleListRow[];
  total: number;
  page: number;
  pageSize: number;
  statuses: string[];
  bodyTypes: string[];
  /**
   * Readiness across everything the current search and filters cover — not
   * just this page. Counting the page would make the chips change as you
   * paged, which is the opposite of a fleet-wide indicator.
   */
  readinessCounts: ReadinessCounts;
  /** True when the fleet is larger than one readiness sweep can cover. */
  readinessPartial?: boolean;
};

const TEXT_FIELDS = [
  "unit_number",
  "vin",
  "license_plate",
  "make",
  "model",
  "trim",
  "color",
] as const;

/**
 * PostgREST `or` filter for the search box: unit, VIN, plate, make, model,
 * trim, color by substring; year by exact number. Characters that carry
 * meaning in the filter grammar are stripped so input cannot widen the query.
 */
export function buildVehicleSearchOr(raw: string): string | null {
  const q = raw
    .replace(/[,()*%\\"':]/g, " ")
    .trim()
    .slice(0, 100);
  if (!q) return null;
  const parts = TEXT_FIELDS.map((f) => `${f}.ilike.*${q}*`);
  if (/^\d{4}$/.test(q)) parts.push(`year.eq.${q}`);
  return parts.join(",");
}

/** PostgREST `.in` lists stay short. 2,000 compliance ids would blow the URL. */
export const VEHICLE_LIST_ID_CHUNK = 100;

export function chunkVehicleIds(ids: readonly string[], size = VEHICLE_LIST_ID_CHUNK): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Invalid id chunk");
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

export type VehicleListIdPlan =
  | { action: "ignore" }
  | { action: "empty" }
  | { action: "filter"; chunks: string[][] };

/**
 * Compliance ids change the Vehicles list only while that flag is on.
 * An empty id list is an empty page. Otherwise the ids are chunked for `.in`.
 */
export function vehicleListIdPlan(enabled: boolean, ids: readonly string[] | undefined): VehicleListIdPlan {
  if (!enabled || ids === undefined) return { action: "ignore" };
  if (ids.length === 0) return { action: "empty" };
  return { action: "filter", chunks: chunkVehicleIds(ids) };
}

type ListedSortRow = {
  id: string;
  unit_number?: string | null;
  make?: string | null;
  model?: string | null;
  weekly_rate?: number | string | null;
  created_at?: string | null;
};

function cmpNullsLast(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Same order as the SQL list: nulls last, then id, so chunked reads page the same way. */
export function pageListedVehicles<T extends ListedSortRow>(rows: readonly T[], sort: string, page: number, pageSize: number): T[] {
  const sorted = [...rows].sort((a, b) => {
    let diff = 0;
    if (sort === "make") diff = cmpNullsLast(a.make, b.make) || cmpNullsLast(a.model, b.model);
    else if (sort === "rate") {
      const left = a.weekly_rate == null || a.weekly_rate === "" ? null : Number(a.weekly_rate);
      const right = b.weekly_rate == null || b.weekly_rate === "" ? null : Number(b.weekly_rate);
      if (left == null && right == null) diff = 0;
      else if (left == null || !Number.isFinite(left)) diff = 1;
      else if (right == null || !Number.isFinite(right)) diff = -1;
      else diff = left - right;
    }     else if (sort === "newest") {
      if (a.created_at == null && b.created_at == null) diff = 0;
      else if (a.created_at == null) diff = 1;
      else if (b.created_at == null) diff = -1;
      else if (a.created_at < b.created_at) diff = 1;
      else if (a.created_at > b.created_at) diff = -1;
    }
    else diff = cmpNullsLast(a.unit_number, b.unit_number);
    return diff || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const from = Math.max(0, (page - 1) * pageSize);
  return sorted.slice(from, from + pageSize);
}

/** Availability shown in the list: running rental first, then operational status. */
export function availabilityLabel(row: Pick<VehicleListRow, "on_rent" | "status">): string {
  if (row.on_rent) return "On Rent";
  if (row.status === "onboarding") return "Needs Setup";
  return (row.status ?? "—").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
