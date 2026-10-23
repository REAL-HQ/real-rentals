/**
 * Public fleet availability, read only from columns vehicles_public already
 * exposes. The flag is a hard constant. While it is false the listing and
 * detail pages do not mount this UI and do not issue another query.
 *
 * vehicles_public has status and no date. "Available Soon" can name a date
 * only when a row carries available_on. That column is not on the view.
 */

import { fmtDate } from "@/lib/date-format";

export const PUBLIC_AVAILABILITY_ENABLED: boolean = false;

/**
 * The date column a future vehicles_public change would need. It is not on
 * the view today, and public.vehicles does not have it either. Do not read
 * rentals or any other private table to invent it.
 */
export const PUBLIC_AVAILABILITY_DATE_COLUMN = "available_on";

export type PublicAvailabilityKind = "now" | "soon" | "rented";

export type PublicAvailabilityInput = {
  status: string | null;
  /** Absent on every vehicles_public row until the view exposes it. */
  available_on?: string | null;
};

export type PublicAvailability = {
  kind: PublicAvailabilityKind;
  label: "Available Now" | "Available Soon" | "Currently Rented";
  date: string | null;
  missing: string[];
};

/** A calendar date stays as stored. A timestamp uses the Eastern calendar. */
export function formatAvailabilityDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fmtDate(trimmed) || null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function publicAvailability(row: PublicAvailabilityInput): PublicAvailability {
  const status = (row.status ?? "").trim().toLowerCase();
  if (status === "available") {
    return { kind: "now", label: "Available Now", date: null, missing: [] };
  }
  if (status === "rented") {
    return { kind: "rented", label: "Currently Rented", date: null, missing: [] };
  }
  const date = formatAvailabilityDate(row.available_on);
  return {
    kind: "soon",
    label: "Available Soon",
    date,
    missing: date ? [] : [PUBLIC_AVAILABILITY_DATE_COLUMN],
  };
}

export function isAvailableNow(row: PublicAvailabilityInput): boolean {
  return publicAvailability(row).kind === "now";
}
