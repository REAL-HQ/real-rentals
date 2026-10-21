// Documents Expiring — pure classification. No database and no sends.
//
// Expiry fields that already exist, and nothing else:
//   Driver License
//     applications.license_expiration (date)
//     documents.expires_at on the current license_front / license_back row (date)
//   Insurance
//     applications.insurance_expires_on (date)
//     documents.expires_at on the current insurance row (date)
//   Rideshare Platform
//     documents.expires_at on the current gig_profile / trip_history row (date)
//     Applications has no platform-expiry column. Those categories are filed
//     as screenshots; a missing date is still Unknown, never OK.
//
// A group with more than one date uses the soonest. A group with no date is
// Unknown. A date more than 30 days out is later, and a renter whose every
// group is later is not in the view. Days are calendar days against today's
// date in America/New_York. Stored date-only values are not timezone-shifted.

export const EXPIRY_WINDOW_DAYS = 30;
export const EXPIRY_TIME_ZONE = "America/New_York";

/**
 * Who counts as an approved driver, from applications_status_check
 * (migration 20260727033224):
 *   partial, new, complete, reviewing, approved, active,
 *   suspended, declined, closed, duplicate
 *
 * There is no "onboarded" or "ready-to-rent" status. `approved` is the
 * approval. `active` is the operating application status (the portal's
 * onboarded driver, including a row marked active when public.rentals is
 * still empty). Readiness "decision_ready" is not approval. Vehicle
 * rental-ready is a car, not a driver.
 */
export const APPROVED_DRIVER_STATUSES = ["approved", "active"] as const;

export type ExpiryScope = "renting" | "approved";

export function isApprovedDriverStatus(status: string | null | undefined): boolean {
  const value = (status ?? "").toLowerCase();
  return (APPROVED_DRIVER_STATUSES as readonly string[]).includes(value);
}

/** Renting Now is an active rentals row. Approved Drivers is that plus approved/active applications. */
export function expiryScopes(input: { hasActiveRental: boolean; status: string | null | undefined }): ExpiryScope[] {
  const scopes: ExpiryScope[] = [];
  if (input.hasActiveRental) scopes.push("renting");
  if (input.hasActiveRental || isApprovedDriverStatus(input.status)) scopes.push("approved");
  return scopes;
}

/**
 * Prefer Renting Now when that list has anyone. When it is empty, use
 * Approved Drivers — including when both lists are empty.
 */
export function defaultExpiryScope(rentingCount: number, _approvedCount: number): ExpiryScope {
  if (rentingCount > 0) return "renting";
  return "approved";
}

export const LICENSE_DOCUMENT_CATEGORIES = ["license_front", "license_back"] as const;
export const INSURANCE_DOCUMENT_CATEGORIES = ["insurance"] as const;
export const RIDESHARE_DOCUMENT_CATEGORIES = ["gig_profile", "trip_history"] as const;

export const EXPIRY_DOCUMENT_CATEGORIES = [
  ...LICENSE_DOCUMENT_CATEGORIES,
  ...INSURANCE_DOCUMENT_CATEGORIES,
  ...RIDESHARE_DOCUMENT_CATEGORIES,
] as const;

export type ExpiryKind = "license" | "insurance" | "rideshare";
export type ExpiryStatus = "expired" | "expiring" | "later" | "unknown";

export type ExpiryCell = {
  kind: ExpiryKind;
  label: string;
  status: ExpiryStatus;
  /** Calendar days until the soonest date. Null when the group has no date. */
  daysLeft: number | null;
  date: string | null;
};

export type RenterExpiryInput = {
  applicationId: string;
  rentalId: string;
  fullName: string | null;
  licenseExpiration: string | null;
  insuranceExpiresOn: string | null;
  documents: Array<{ category: string; expiresAt: string | null }>;
};

export type ExpiringRenter = {
  applicationId: string;
  rentalId: string;
  fullName: string;
  cells: ExpiryCell[];
  /** Soonest expired or within-window date. Null when every attention cell is Unknown. */
  soonestDays: number | null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Today's calendar date in Eastern Time, YYYY-MM-DD. */
export function etCalendarDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EXPIRY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return "1970-01-01";
  return `${year}-${month}-${day}`;
}

/** Date-only prefix. Timestamps keep the calendar date they were stored as, not a shifted one. */
export function calendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Whole calendar days from todayEt until expiry. Negative means already past. */
export function daysBetween(todayEt: string, expiry: string): number {
  const start = Date.parse(`${todayEt}T00:00:00Z`);
  const end = Date.parse(`${expiry}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export function daysLeftLabel(days: number | null, status: ExpiryStatus): string {
  if (status === "unknown" || days == null) return "Unknown";
  if (days < 0) {
    const overdue = -days;
    return overdue === 1 ? "1 Day Overdue" : `${overdue} Days Overdue`;
  }
  if (days === 0) return "Expires Today";
  return days === 1 ? "1 Day Left" : `${days} Days Left`;
}

function soonestDate(values: Array<string | null | undefined>): string | null {
  const dates = values.map(calendarDate).filter((d): d is string => !!d);
  if (!dates.length) return null;
  return dates.sort()[0];
}

function cell(kind: ExpiryKind, label: string, date: string | null, todayEt: string): ExpiryCell {
  if (!date) return { kind, label, status: "unknown", daysLeft: null, date: null };
  const daysLeft = daysBetween(todayEt, date);
  const status: ExpiryStatus =
    daysLeft < 0 ? "expired" : daysLeft <= EXPIRY_WINDOW_DAYS ? "expiring" : "later";
  return { kind, label, status, daysLeft, date };
}

function datesFor(docs: RenterExpiryInput["documents"], categories: readonly string[]): Array<string | null> {
  return docs.filter((d) => categories.includes(d.category)).map((d) => d.expiresAt);
}

/**
 * Classify one active renter. Returns null when every group is more than 30
 * days out — that renter is not in Documents Expiring. Unknown is never dropped.
 */
export function classifyActiveRenter(input: RenterExpiryInput, todayEt: string): ExpiringRenter | null {
  const cells: ExpiryCell[] = [
    cell(
      "license",
      "Driver License",
      soonestDate([input.licenseExpiration, ...datesFor(input.documents, LICENSE_DOCUMENT_CATEGORIES)]),
      todayEt,
    ),
    cell(
      "insurance",
      "Insurance",
      soonestDate([input.insuranceExpiresOn, ...datesFor(input.documents, INSURANCE_DOCUMENT_CATEGORIES)]),
      todayEt,
    ),
    cell(
      "rideshare",
      "Rideshare Platform",
      soonestDate(datesFor(input.documents, RIDESHARE_DOCUMENT_CATEGORIES)),
      todayEt,
    ),
  ];
  if (cells.every((c) => c.status === "later")) return null;
  const attention = cells.filter((c) => c.status === "expired" || c.status === "expiring");
  const soonestDays = attention.length
    ? Math.min(...attention.map((c) => c.daysLeft ?? 0))
    : null;
  return {
    applicationId: input.applicationId,
    rentalId: input.rentalId,
    fullName: input.fullName?.trim() || "Unnamed",
    cells,
    soonestDays,
  };
}

/** Soonest dated attention first. Unknown-only renters follow, then by name. */
export function compareExpiringRenters(a: ExpiringRenter, b: ExpiringRenter): number {
  if (a.soonestDays == null && b.soonestDays == null) return a.fullName.localeCompare(b.fullName);
  if (a.soonestDays == null) return 1;
  if (b.soonestDays == null) return -1;
  return a.soonestDays - b.soonestDays || a.fullName.localeCompare(b.fullName);
}

export function sortExpiringRenters(rows: ExpiringRenter[]): ExpiringRenter[] {
  return [...rows].sort(compareExpiringRenters);
}

/** A notice is for a real date that is expired or inside the window, not for Unknown. */
export function renterNeedsExpiryNotice(renter: ExpiringRenter): boolean {
  return renter.cells.some((c) => c.status === "expired" || c.status === "expiring");
}
