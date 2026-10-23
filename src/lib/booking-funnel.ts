/**
 * Approved, Not Yet Renting.
 *
 * The people a manager still has to turn into a rental: an application whose
 * status is `approved`, and who has no rentals row in status `active`.
 *
 * `approved` is the approval. There is no onboarded or ready-to-rent
 * application status — the check constraint is partial, new, complete,
 * reviewing, approved, active, suspended, declined, closed, duplicate.
 * `active` means the application is operating (a rental was started, or
 * somebody marked it active). That is a different list. A reviewing
 * application is not approved.
 *
 * Days since approval come from the latest audit_log row for
 * `application.approved`. reviewed_at is the first time somebody opened the
 * record, and applications has no approved_at column. No audit row is
 * Unknown, never zero.
 *
 * Document status is a light read of the two dates on the application
 * (license_expiration, insurance_expires_on). The Documents Expiring view
 * owns the rideshare and uploaded-document dates, and it is not on this
 * branch. A missing or unreadable date is Unknown, never OK.
 *
 * Dates are Eastern calendar days. A date-only value is that calendar day.
 * An instant is the Eastern day it falls on.
 */

export const FUNNEL_TIME_ZONE = "America/New_York";

/** The only application status this list includes. */
export const APPROVED_NOT_RENTING_STATUS = "approved";

export type FunnelContact = {
  contact_status: string | null;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
};

export type FunnelApplicant = {
  id: string;
  fullName: string | null;
  status: string | null;
  deletedAt: string | null;
  licenseExpiration: string | null;
  insuranceExpiresOn: string | null;
  /** Present when the contact columns were on the row that was read. */
  contact: FunnelContact | null;
};

export type ApprovedNotRentingRow = {
  id: string;
  fullName: string;
  /** Whole Eastern days from the approval day to today. Null when unknown. */
  daysSinceApproval: number | null;
  daysSinceLabel: string;
  licenseLabel: string;
  insuranceLabel: string;
  /** Passed straight to ContactStatusCell. Empty when contact columns are absent. */
  contact: FunnelContact | Record<string, never>;
};

export type ApprovedNotRentingResult = {
  todayEt: string;
  rows: ApprovedNotRentingRow[];
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(iso: string): boolean {
  const m = DATE_ONLY.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's calendar day in Eastern Time, YYYY-MM-DD. */
export function etCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FUNNEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}`;
}

/**
 * A stored value as an Eastern calendar day.
 * Date-only strings stay on that day. Anything else is an instant.
 */
export function calendarDay(raw: string | null | undefined, kind: "date" | "instant"): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (DATE_ONLY.test(s)) return isRealDate(s) ? s : null;
  if (kind === "date") {
    const prefix = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return prefix && isRealDate(prefix[1]) ? prefix[1] : null;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return etCalendarDate(new Date(t));
}

/** later minus earlier, in whole calendar days. */
export function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function daysSinceLabel(days: number | null): string {
  if (days == null) return "Unknown";
  if (days <= 0) return "Today";
  if (days === 1) return "1 Day";
  return `${days} Days`;
}

/** How a license or insurance date reads. Missing is Unknown, never OK. */
export function docDateLabel(raw: string | null | undefined, todayEt: string): string {
  const day = calendarDay(raw, "date");
  if (!day) return "Unknown";
  const left = daysBetween(todayEt, day);
  if (left < 0) {
    const n = Math.abs(left);
    return n === 1 ? "1 Day Overdue" : `${n} Days Overdue`;
  }
  if (left === 0) return "Expires Today";
  if (left === 1) return "1 Day Left";
  return `${left} Days Left`;
}

export function latestApprovalAt(
  rows: { entityId: string | null; createdAt: string | null }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.entityId || !row.createdAt) continue;
    const prev = out[row.entityId];
    if (!prev || Date.parse(row.createdAt) >= Date.parse(prev)) out[row.entityId] = row.createdAt;
  }
  return out;
}

function displayName(fullName: string | null): string {
  const n = fullName?.trim();
  return n ? n : "Unnamed Driver";
}

/**
 * Approved applications with no active rental, longest wait first.
 * Unknown approval dates sort after every dated row.
 */
export function buildApprovedNotRenting(input: {
  applicants: FunnelApplicant[];
  activeRentalApplicationIds: Iterable<string>;
  approvedAtById: Record<string, string>;
  now: Date;
}): ApprovedNotRentingResult {
  const todayEt = etCalendarDate(input.now);
  const renting = new Set(input.activeRentalApplicationIds);
  const rows: ApprovedNotRentingRow[] = [];
  for (const a of input.applicants) {
    if (a.status !== APPROVED_NOT_RENTING_STATUS) continue;
    if (a.deletedAt) continue;
    if (renting.has(a.id)) continue;
    const approvedDay = calendarDay(input.approvedAtById[a.id], "instant");
    const days = approvedDay ? daysBetween(approvedDay, todayEt) : null;
    rows.push({
      id: a.id,
      fullName: displayName(a.fullName),
      daysSinceApproval: days,
      daysSinceLabel: daysSinceLabel(days),
      licenseLabel: docDateLabel(a.licenseExpiration, todayEt),
      insuranceLabel: docDateLabel(a.insuranceExpiresOn, todayEt),
      contact: a.contact ?? {},
    });
  }
  rows.sort((a, b) => {
    if (a.daysSinceApproval == null && b.daysSinceApproval != null) return 1;
    if (a.daysSinceApproval != null && b.daysSinceApproval == null) return -1;
    if (a.daysSinceApproval != null && b.daysSinceApproval != null && a.daysSinceApproval !== b.daysSinceApproval) {
      return b.daysSinceApproval - a.daysSinceApproval;
    }
    return a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id);
  });
  return { todayEt, rows };
}
