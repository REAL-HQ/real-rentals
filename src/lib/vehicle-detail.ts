/**
 * Public vehicle detail. Reads are shaped here so the page can only render
 * columns that already exist on `vehicles_public`.
 *
 * Plate and VIN are never copied. Plate visibility is a pending owner
 * decision, and the public view does not expose either value.
 * Deposit is not a column on `vehicles_public`, so this page has no deposit
 * amount to show.
 */
import { resolvePhotoUrl } from "@/lib/photoUrl";

/** Hard off. The route and the listing card duplicate this and must not import this module while it is off. */
export const VEHICLE_DETAIL_PAGE_ENABLED: boolean = false as boolean;

/**
 * Explicit column list. Plate, VIN, and deposit are not selected, even if a
 * later view grows those fields.
 */
export const PUBLIC_VEHICLE_DETAIL_COLUMNS =
  "id,make,model,year,weekly_rate,photos,status,uber_eligibility,description" as const;

/** Existing public copy from the fleet detail page and listing cards. */
export const RENTAL_REQUIREMENTS = [
  "No deposit — payment card on file",
  "Routine maintenance included",
  "24/7 driver support",
  "Unlimited Miles",
  "No Credit Check",
] as const;

export type VehicleDetailPhoto = { src: string; alt: string };

export type PublicVehicleDetail = {
  id: string;
  year: number | null;
  make: string;
  model: string;
  heading: string;
  weeklyRateLabel: string;
  /** Null until a deposit column exists on `vehicles_public`. */
  depositLabel: string | null;
  /** Null when `uber_eligibility` is missing or empty. */
  eligibility: string[] | null;
  requirements: readonly string[];
  photos: VehicleDetailPhoto[];
  description: string | null;
  metaTitle: string;
  metaDescription: string;
  applyHref: "/apply";
};

export type VehicleDetailResult = { kind: "ready"; vehicle: PublicVehicleDetail } | { kind: "missing" };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A row is listable only when the public view returned it and the back office
 * marks it available. Unknown ids, errors, and any other status are not found.
 * Only allowlisted fields are copied, so plate and VIN cannot leak through.
 */
export function presentPublicVehicle(row: Record<string, unknown> | null, failed = false): VehicleDetailResult {
  if (failed || !row) return { kind: "missing" };
  const id = text(row.id);
  const status = text(row.status);
  if (!id || status !== "available") return { kind: "missing" };

  const make = text(row.make) ?? "";
  const model = text(row.model) ?? "";
  const year = typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null;
  const name = [make, model].filter(Boolean).join(" ").trim() || "Vehicle";
  const heading = [year !== null ? String(year) : null, name].filter(Boolean).join(" ");

  const weeklyRateLabel =
    typeof row.weekly_rate === "number" && Number.isFinite(row.weekly_rate)
      ? `$${Number(row.weekly_rate)}/week`
      : "Rate confirmed on your call";

  let eligibility: string[] | null = null;
  if (Object.prototype.hasOwnProperty.call(row, "uber_eligibility") && Array.isArray(row.uber_eligibility)) {
    const items = row.uber_eligibility
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
    eligibility = items.length > 0 ? items : null;
  }

  const photos = Array.isArray(row.photos)
    ? row.photos.flatMap((item, index) => {
        if (typeof item !== "string" || item.trim().length === 0) return [];
        const src = resolvePhotoUrl(item);
        return src ? [{ src, alt: `${heading} photo ${index + 1}` }] : [];
      })
    : [];

  const description = text(row.description);
  const metaTitle = name === "Vehicle" ? "Vehicle Details — REAL RENTALS" : `${heading} — REAL RENTALS`;
  const metaDescription = `${heading}. Weekly rate ${weeklyRateLabel}. ${RENTAL_REQUIREMENTS[0]}.`;

  return {
    kind: "ready",
    vehicle: {
      id,
      year,
      make,
      model,
      heading,
      weeklyRateLabel,
      depositLabel: null,
      eligibility,
      requirements: RENTAL_REQUIREMENTS,
      photos,
      description,
      metaTitle,
      metaDescription,
      applyHref: "/apply",
    },
  };
}
