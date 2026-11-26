// Deadlines and payment-link matching for toll and citation charges.
//
// Pure: no database and no Stripe. The Charges screen, the importer and the
// payment webhook all use these rules so a charge is overdue in one place only.
//
// Pay By defaults to the agency deadline minus PAY_BY_LEAD_DAYS (7). A charge
// can store a different Pay By; the screen sends the edited date and the
// default is used only when Pay By is omitted. Staff always see the agency
// deadline beside Pay By.

/** Days before the agency due date that the renter is asked to pay. */
export const PAY_BY_LEAD_DAYS = 7;

/** Agency Due Soon when the agency date is today or this many days out. */
export const AGENCY_DUE_SOON_DAYS = 3;

/**
 * Payment Link reasons that can settle a toll charge. `fee` is included
 * because hand-made links often use it, and only when a notice is present.
 */
export const TOLL_CHARGE_LINK_REASONS = [
  "toll",
  "ticket",
  "citation",
  "school_zone_ticket",
  "red_light",
  "fee",
] as const;

/** Columns added by 20261126200000_toll_charge_deadlines.sql. Absent until that migration is applied. */
export const TOLL_CHARGE_DEADLINE_COLUMNS = [
  "agency_due_date",
  "renter_pay_by",
  "escalation",
  "escalated_at",
  "stripe_payment_link_id",
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date in America/New_York, YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

/** A real YYYY-MM-DD, or null. A timestamp keeps its calendar date. */
export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = String(value).trim().slice(0, 10);
  if (!ISO_DAY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== date) return null;
  return day;
}

/** Shift a calendar date by whole days. Month and year boundaries are real dates. */
export function addCalendarDays(iso: string, days: number): string | null {
  const day = isoDay(iso);
  if (!day || !Number.isFinite(days)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date + days));
  return utc.toISOString().slice(0, 10);
}

/** Agency due date minus the lead time. Null when the agency date is missing or not a date. */
export function defaultRenterPayBy(
  agencyDueDate: string | null | undefined,
  leadDays: number = PAY_BY_LEAD_DAYS,
): string | null {
  const day = isoDay(agencyDueDate ?? null);
  if (!day || !Number.isInteger(leadDays)) return null;
  return addCalendarDays(day, -leadDays);
}

/**
 * Dates to store on a new charge.
 * An omitted Pay By uses the default. An explicit Pay By, including null, is kept.
 * Returns null when there is nothing to write, so an insert can leave the new
 * columns out until the migration exists.
 */
export function resolveChargeDeadlines(input: {
  agencyDueDate?: string | null;
  renterPayBy?: string | null;
}): { agency_due_date: string | null; renter_pay_by: string | null } | null {
  const agencyProvided = input.agencyDueDate !== undefined;
  const payByProvided = input.renterPayBy !== undefined;
  if (!agencyProvided && !payByProvided) return null;
  const agency = agencyProvided ? isoDay(input.agencyDueDate) : null;
  const payBy = payByProvided ? isoDay(input.renterPayBy) : defaultRenterPayBy(agency);
  if (!agency && !payBy) return null;
  return { agency_due_date: agency, renter_pay_by: payBy };
}

export function omitDeadlineColumns<T extends Record<string, unknown>>(row: T): T {
  const next = { ...row };
  for (const key of TOLL_CHARGE_DEADLINE_COLUMNS) delete next[key];
  return next;
}

/** Paid and written off are settled. Everything else can still be overdue. */
export function isChargeUnpaid(status: string | null | undefined): boolean {
  const key = String(status ?? "").trim().toLowerCase();
  return key !== "paid" && key !== "written_off";
}

export function chargeDeadlineFlags(
  charge: {
    status?: string | null;
    renter_pay_by?: string | null;
    agency_due_date?: string | null;
  },
  today: string,
): { overdue: boolean; agencyDueSoon: boolean } {
  const day = isoDay(today);
  if (!day || !isChargeUnpaid(charge.status)) return { overdue: false, agencyDueSoon: false };
  const payBy = isoDay(charge.renter_pay_by);
  const agency = isoDay(charge.agency_due_date);
  const overdue = !!payBy && payBy < day;
  let agencyDueSoon = false;
  if (agency) {
    const ahead = calendarDaysBetween(day, agency);
    agencyDueSoon = ahead != null && ahead >= 0 && ahead <= AGENCY_DUE_SOON_DAYS;
  }
  return { overdue, agencyDueSoon };
}

/** Whole days from `fromDay` to `toDay`. Negative when `toDay` is earlier. */
export function calendarDaysBetween(fromDay: string, toDay: string): number | null {
  const from = isoDay(fromDay);
  const to = isoDay(toDay);
  if (!from || !to) return null;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function isTollChargeLinkReason(reason: string | null | undefined): boolean {
  const key = String(reason ?? "").trim().toLowerCase();
  return (TOLL_CHARGE_LINK_REASONS as readonly string[]).includes(key);
}

/** Notice text as staff and agencies write it: trimmed, inner space collapsed. */
export function normalizeNotice(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text || null;
}

export function noticesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeNotice(a);
  const right = normalizeNotice(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

/** A paid Payment Link settles a charge only when the reason qualifies and a notice was sent. */
export function shouldLinkPaidTollCharge(
  reason: string | null | undefined,
  notice: string | null | undefined,
): boolean {
  return isTollChargeLinkReason(reason) && normalizeNotice(notice) != null;
}

export type TollChargeRef = {
  id: string;
  status?: string | null;
  payment_id?: string | null;
  reference_number?: string | null;
  rental_id?: string | null;
  stripe_payment_link_id?: string | null;
};

export type TollChargeMatchInput = {
  paymentLinkId?: string | null;
  notice?: string | null;
  rentalId?: string | null;
  paymentId?: string | null;
};

export type TollChargeMatch =
  | { ok: true; id: string; by: "payment_link" | "notice" }
  | { ok: false; why: "none" | "ambiguous_link" | "ambiguous_notice" | "already_paid" };

/**
 * One charge, or nothing.
 * The Payment Link id wins. Otherwise the notice number and the rental must
 * both match. More than one row is not a match: the caller must not update any.
 */
export function pickTollChargeMatch(rows: TollChargeRef[], input: TollChargeMatchInput): TollChargeMatch {
  const link = input.paymentLinkId?.trim() || null;
  if (link) {
    const hits = rows.filter((row) => (row.stripe_payment_link_id ?? "").trim() === link);
    if (hits.length > 1) return { ok: false, why: "ambiguous_link" };
    if (hits.length === 1) return acceptMatch(hits[0], input.paymentId, "payment_link");
  }
  const notice = normalizeNotice(input.notice);
  const rentalId = input.rentalId?.trim() || null;
  if (notice && rentalId) {
    const hits = rows.filter((row) => row.rental_id === rentalId && noticesEqual(row.reference_number, notice));
    if (hits.length > 1) return { ok: false, why: "ambiguous_notice" };
    if (hits.length === 1) return acceptMatch(hits[0], input.paymentId, "notice");
  }
  return { ok: false, why: "none" };
}

function acceptMatch(
  row: TollChargeRef,
  paymentId: string | null | undefined,
  by: "payment_link" | "notice",
): TollChargeMatch {
  if (row.status === "paid" && row.payment_id && paymentId && row.payment_id !== paymentId) {
    return { ok: false, why: "already_paid" };
  }
  return { ok: true, id: row.id, by };
}
