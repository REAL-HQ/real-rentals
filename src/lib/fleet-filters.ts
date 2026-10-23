/**
 * Public /fleet filters. The flag stays off until the owner turns it on.
 * "Newest" is model year: vehicles_public has no created_at column.
 */
export const FLEET_FILTERS_ENABLED: boolean = false as boolean;

/** Every column on vehicles_public, named. The flag-off page keeps its current column list. */
export const FLEET_LISTING_COLUMNS =
  "badges,body_type,color,description,doors,fuel_type,id,make,miles_per_tank,model,monthly_rate,mpg,photos,seats,status,trim,uber_eligibility,weekly_rate,year";

// fleet-search-start
const FLEET_SORTS = ["price_asc", "price_desc", "newest"] as const;

export type FleetSort = (typeof FLEET_SORTS)[number];

export type FleetFilterState = {
  make: string;
  minRate: number | null;
  maxRate: number | null;
  uberOnly: boolean;
  availableOnly: boolean;
  sort: FleetSort;
};

function cleanRate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readFleetSearch(search: Record<string, unknown>): FleetFilterState {
  const make =
    typeof search.make === "string" && search.make.trim() !== "" && search.make !== "all"
      ? search.make.trim().slice(0, 40)
      : "all";
  const sort = FLEET_SORTS.find((item) => item === search.sort) ?? "price_asc";
  return {
    make,
    minRate: cleanRate(search.min),
    maxRate: cleanRate(search.max),
    uberOnly: search.uber === "1" || search.uber === 1 || search.uber === true,
    availableOnly: !(search.available === "0" || search.available === 0 || search.available === false),
    sort,
  };
}

export function fleetSearchParams(state: FleetFilterState): {
  make?: string;
  min?: number;
  max?: number;
  uber?: boolean;
  available?: boolean;
  sort?: string;
} {
  return {
    ...(state.make !== "all" ? { make: state.make } : {}),
    ...(state.minRate !== null ? { min: state.minRate } : {}),
    ...(state.maxRate !== null ? { max: state.maxRate } : {}),
    ...(state.uberOnly ? { uber: true } : {}),
    ...(!state.availableOnly ? { available: false } : {}),
    ...(state.sort !== "price_asc" ? { sort: state.sort } : {}),
  };
}
// fleet-search-end

export type FleetListingRow = {
  id?: string | null;
  make?: string | null;
  weekly_rate?: number | null;
  year?: number | null;
  status?: string | null;
  uber_eligibility?: string[] | null;
};

/** Client-side only. A missing weekly rate sorts last, and a missing year is not newest. */
export function applyFleetFilters<T extends FleetListingRow>(rows: T[], state: FleetFilterState): T[] {
  const next = rows.filter((row) => {
    if (state.make !== "all" && row.make !== state.make) return false;
    if (state.availableOnly && row.status !== "available") return false;
    if (state.uberOnly && !(row.uber_eligibility && row.uber_eligibility.length > 0)) return false;
    if (state.minRate !== null && (row.weekly_rate === null || row.weekly_rate === undefined || row.weekly_rate < state.minRate)) {
      return false;
    }
    if (state.maxRate !== null && (row.weekly_rate === null || row.weekly_rate === undefined || row.weekly_rate > state.maxRate)) {
      return false;
    }
    return true;
  });
  const sorted = [...next];
  sorted.sort((a, b) => {
    if (state.sort === "newest") {
      const yearDelta = (b.year ?? Number.NEGATIVE_INFINITY) - (a.year ?? Number.NEGATIVE_INFINITY);
      if (yearDelta !== 0) return yearDelta;
      return String(b.id ?? "").localeCompare(String(a.id ?? ""));
    }
    const direction = state.sort === "price_desc" ? -1 : 1;
    const left = a.weekly_rate === null || a.weekly_rate === undefined ? Number.POSITIVE_INFINITY : a.weekly_rate * direction;
    const right = b.weekly_rate === null || b.weekly_rate === undefined ? Number.POSITIVE_INFINITY : b.weekly_rate * direction;
    if (left !== right) return left - right;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return sorted;
}
