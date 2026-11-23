// Browser-safe shapes and helpers for the Vehicles list (List 1).
import { isRentalReady, rentalReadyItems } from "@/lib/vehicle-readiness";

export const VEHICLE_LIST_PAGE_SIZE = 50;
export const VEHICLE_SORTS = ["unit", "make", "year", "color", "rate", "newest"] as const;
export type VehicleSort = (typeof VEHICLE_SORTS)[number];

/** Sort the full filtered result before pagination, with missing values last. */
export function vehicleSortOrders(raw: string) {
  const primary = raw === "make" ? ["make", "model"]
    : raw === "year" ? ["year"]
    : raw === "color" ? ["color"]
    : raw === "rate" ? ["weekly_rate"]
    : raw === "newest" ? ["created_at"] : ["unit_number"];
  return [
    ...primary.map((column) => ({ column, options: { ascending: raw !== "newest", nullsFirst: false } })),
    { column: "id", options: { ascending: true } },
  ];
}

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
  /** Lead original in the private staff gallery; never a public photo URL. */
  thumbnailPath?: string | null;
  on_rent: boolean;
  /** Where this car sits on the two gates the fleet is actually judged by. */
  readiness: ReadinessBand;
  /** What is missing, named — so the list can say WHY, not just "not ready". */
  readinessGaps: string[];
  /** An open swap on this car (waiting for signature, or signed and not yet completed). */
  swap_notice?: import("@/lib/vehicle-swap").VehicleSwapNotice | null;
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

/** Position in the returned (sorted/filtered) list, not the vehicle unit ID. */
export function vehicleRowNumber(page: number, pageSize: number, index: number) {
  return (page - 1) * pageSize + index + 1;
}

export type VehicleListResult = {
  /** Exact whole-table count, including archived vehicles; null if unavailable. */
  fleetTotal?: number | null;
  /** Fleet-wide inventory snapshot for the Vehicles stat cards; independent of list filters. */
  fleetStats?: VehicleFleetStats;
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

/** Availability shown in the list: running rental first, then operational status. */
export function availabilityLabel(row: Pick<VehicleListRow, "on_rent" | "status">): string {
  if (row.on_rent) return "Rented";
  if (row.status === "onboarding") return "Needs Setup";
  if (row.status === "for_sale") return "For Sale";
  return (row.status ?? "—").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** URL/Status filter value: vehicles with an active rental, not the stored status. */
export const ON_RENT_STATUS_FILTER = "on_rent";

export type VehicleFleetStats = {
  /** Whole table, including archived. Same scope as fleetTotal. */
  total: number;
  archived: number;
  /** Unarchived vehicles with an active rental. */
  rented: number;
  /** Unarchived, not on a rental, status available. */
  available: number;
  /** Unarchived, not on a rental, status maintenance. */
  maintenance: number;
  /** Unarchived, not on a rental, any other status. */
  other: number;
  /**
   * Rented ÷ unarchived, rounded. Archived vehicles are excluded from the
   * denominator. Null when every vehicle is archived or the unarchived count is 0.
   */
  utilizationPct: number | null;
};

/**
 * Inventory counts for the Vehicles page cards.
 *
 * Total matches "N Vehicles Total (Including Archived)". Rented follows the
 * list's Availability column (an active rental beats stored status).
 * Utilization is rented / (total − archived).
 */
export function summarizeVehicleFleetStats(
  vehicles: { id?: string | null; status?: string | null }[],
  onRentIds: Set<string>,
  total = vehicles.length,
): VehicleFleetStats {
  let archived = 0;
  let rented = 0;
  let available = 0;
  let maintenance = 0;
  let other = 0;
  for (const vehicle of vehicles) {
    const status = (vehicle.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (status === "archived") {
      archived += 1;
      continue;
    }
    const id = typeof vehicle.id === "string" ? vehicle.id : "";
    if (id && onRentIds.has(id)) {
      rented += 1;
      continue;
    }
    if (status === "available") available += 1;
    else if (status === "maintenance") maintenance += 1;
    else other += 1;
  }
  const unarchived = Math.max(0, total - archived);
  return {
    total,
    archived,
    rented,
    available,
    maintenance,
    other,
    utilizationPct: unarchived > 0 ? Math.round((rented / unarchived) * 100) : null,
  };
}
