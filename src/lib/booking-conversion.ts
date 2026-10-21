/**
 * Booking conversion. The flag is a hard constant, declared once.
 * getBookingConversion throws from bookingConversionGate before auth, the
 * role check, and any table read unless this is exactly true.
 *
 * This is not the Applicant Funnel (status buckets over 7, 30, or 90 days)
 * and not Approved, Not Yet Renting. Overview leads and the contact-lead
 * inbox are separate lists: a contact lead has no application id, so it is
 * not a step here. Waitlist / Leads is the waitlist row plus
 * applications.waitlist_signed_up_at.
 *
 * A person is in the chosen Eastern dates when their earliest entry day is
 * in that range. Entry is the earliest of a waitlist created_at, the
 * application's waitlist signup, and the application's created_at. Later
 * steps count whenever they happened. There is no submitted_at column, so
 * the medians into Submitted and Approved are omitted.
 */

export const BOOKING_CONVERSION_ENABLED: boolean = false;

export function assertBookingConversionEnabled(): void {
  if (BOOKING_CONVERSION_ENABLED !== true) {
    throw new Error("Booking conversion is not enabled.");
  }
}

export const BOOKING_TIME_ZONE = "America/New_York";
export const BOOKING_CONVERSION_ROW_CAP = 1000;
export const BOOKING_CONVERSION_MAX_DAYS = 366;

export const BOOKING_CONVERSION_STEPS = [
  "waitlist_leads",
  "started",
  "submitted",
  "approved",
  "agreement_signed",
  "card_on_file",
  "first_rental",
] as const;

export type BookingConversionStepId = (typeof BOOKING_CONVERSION_STEPS)[number];

export const BOOKING_CONVERSION_LABEL: Record<BookingConversionStepId, string> = {
  waitlist_leads: "Waitlist / Leads",
  started: "Applications Started",
  submitted: "Submitted",
  approved: "Approved",
  agreement_signed: "Agreement Signed",
  card_on_file: "Card On File",
  first_rental: "First Rental Recorded",
};

export const SUBMITTED_MEDIAN_NOTE = "Submitted time is not stored, so this median is omitted.";

export type BookingConversionStep = {
  id: BookingConversionStepId;
  label: string;
  count: number;
  conversion: string | null;
  medianDays: string | null;
  medianNote: string | null;
};

export type BookingConversionReady = {
  status: "ready";
  timeZone: typeof BOOKING_TIME_ZONE;
  from: string;
  to: string;
  rangeLabel: string;
  cap: number;
  steps: BookingConversionStep[];
  note: string;
};

export type BookingConversionOverflow = {
  status: "overflow";
  timeZone: typeof BOOKING_TIME_ZONE;
  from: string;
  to: string;
  cap: number;
};

export type BookingConversionReport = BookingConversionReady | BookingConversionOverflow;

export type BookingLeadRow = {
  id: string;
  createdAt: string | null;
  promotedApplicationId: string | null;
};

export type BookingApplicationRow = {
  id: string;
  status: string | null;
  createdAt: string | null;
  deletedAt: string | null;
  waitlistSignedUpAt: string | null;
  cardOnFileAt: string | null;
  cardLast4: string | null;
  stripePaymentMethodId: string | null;
};

export type BookingAgreementRow = {
  applicationId: string | null;
  status: string | null;
  signedAt: string | null;
  voidedAt: string | null;
};

export type BookingRentalRow = {
  applicationId: string | null;
  createdAt: string | null;
};

export type BookingApprovalRow = {
  applicationId: string | null;
  createdAt: string | null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function takeCapped<T>(rows: readonly T[], cap = BOOKING_CONVERSION_ROW_CAP): { ok: true; rows: T[] } | { ok: false } {
  if (rows.length > cap) return { ok: false };
  return { ok: true, rows: [...rows] };
}

function isRealDate(iso: string): boolean {
  const match = DATE_ONLY.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

type EasternParts = { year: number; month: number; day: number; hour: number };

function easternParts(instant: Date): EasternParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = num("hour") === 24 ? 0 : num("hour");
  return { year: num("year"), month: num("month"), day: num("day"), hour };
}

/** Midnight at the start of an Eastern calendar day. EST is UTC-5, EDT is UTC-4. */
export function easternMidnight(year: number, month: number, day: number): Date {
  for (const utcHour of [4, 5]) {
    const instant = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));
    const parts = easternParts(instant);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === 0) return instant;
  }
  throw new Error("Eastern midnight could not be resolved.");
}

function shiftDate(year: number, month: number, day: number, delta: number) {
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function etCalendarDate(now: Date): string {
  const parts = easternParts(now);
  return isoDate(parts);
}

/** A stored value as an Eastern calendar day. Date-only strings stay on that day. */
export function calendarDay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (DATE_ONLY.test(value)) return isRealDate(value) ? value : null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return etCalendarDate(new Date(time));
}

/** later minus earlier, in whole calendar days. */
export function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function parseBookingRange(from: string, to: string): { ok: true; from: string; to: string } | { ok: false; reason: string } {
  if (!isRealDate(from) || !isRealDate(to)) return { ok: false, reason: "Choose a real date range." };
  if (from > to) return { ok: false, reason: "The start is after the end." };
  if (daysBetween(from, to) + 1 > BOOKING_CONVERSION_MAX_DAYS) {
    return { ok: false, reason: "Choose 366 days or fewer." };
  }
  return { ok: true, from, to };
}

/** Inclusive Eastern dates as [start, end) instants. */
export function rangeInstants(from: string, to: string): { start: string; end: string } {
  const parsed = parseBookingRange(from, to);
  if (!parsed.ok) throw new Error(parsed.reason);
  const [fy, fm, fd] = parsed.from.split("-").map(Number);
  const [ty, tm, td] = parsed.to.split("-").map(Number);
  const next = shiftDate(ty, tm, td, 1);
  return {
    start: easternMidnight(fy, fm, fd).toISOString(),
    end: easternMidnight(next.year, next.month, next.day).toISOString(),
  };
}

export function defaultBookingRange(now = new Date()): { from: string; to: string } {
  const today = etCalendarDate(now);
  const [year, month, day] = today.split("-").map(Number);
  const start = shiftDate(year, month, day, -29);
  return { from: isoDate(start), to: today };
}

export function formatRangeDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function percent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  const rounded = Math.round((part / whole) * 1000) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
}

function formatMedian(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? "Day" : "Days"}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function earliest(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestTime = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time) || time >= bestTime) continue;
    best = value;
    bestTime = time;
  }
  return best;
}

function daySpan(earlier: string | null, later: string | null): number | null {
  const from = calendarDay(earlier);
  const to = calendarDay(later);
  if (!from || !to) return null;
  const days = daysBetween(from, to);
  return days >= 0 ? days : null;
}

function inRange(day: string | null, from: string, to: string): boolean {
  return day != null && day >= from && day <= to;
}

function isSigned(row: BookingAgreementRow): boolean {
  if (row.voidedAt) return false;
  const status = (row.status ?? "").toLowerCase();
  if (status === "voided") return false;
  return status === "signed" || Boolean(row.signedAt);
}

export function buildBookingConversion(input: {
  from: string;
  to: string;
  leads: BookingLeadRow[];
  applications: BookingApplicationRow[];
  agreements: BookingAgreementRow[];
  rentals: BookingRentalRow[];
  approvals: BookingApprovalRow[];
}): BookingConversionReady {
  const parsed = parseBookingRange(input.from, input.to);
  if (!parsed.ok) throw new Error(parsed.reason);
  const from = parsed.from;
  const to = parsed.to;

  const leadsByApp = new Map<string, BookingLeadRow[]>();
  for (const lead of input.leads) {
    if (!lead.promotedApplicationId) continue;
    const list = leadsByApp.get(lead.promotedApplicationId) ?? [];
    list.push(lead);
    leadsByApp.set(lead.promotedApplicationId, list);
  }

  const apps = new Map<string, BookingApplicationRow>();
  for (const app of input.applications) {
    if (app.deletedAt) continue;
    apps.set(app.id, app);
  }

  const signedAt = new Map<string, string | null>();
  const signed = new Set<string>();
  for (const row of input.agreements) {
    if (!row.applicationId || !isSigned(row)) continue;
    signed.add(row.applicationId);
    if (!row.signedAt) continue;
    const previous = signedAt.get(row.applicationId);
    if (previous === undefined || previous === null || Date.parse(row.signedAt) < Date.parse(previous)) {
      signedAt.set(row.applicationId, row.signedAt);
    }
  }

  const rentalAt = new Map<string, string>();
  for (const row of input.rentals) {
    if (!row.applicationId || !row.createdAt) continue;
    const previous = rentalAt.get(row.applicationId);
    if (!previous || Date.parse(row.createdAt) < Date.parse(previous)) rentalAt.set(row.applicationId, row.createdAt);
  }

  const approvedAt = new Map<string, string>();
  for (const row of input.approvals) {
    if (!row.applicationId || !row.createdAt) continue;
    const previous = approvedAt.get(row.applicationId);
    if (!previous || Date.parse(row.createdAt) < Date.parse(previous)) approvedAt.set(row.applicationId, row.createdAt);
  }

  let leads = 0;
  let started = 0;
  let submitted = 0;
  let approved = 0;
  let agreements = 0;
  let cards = 0;
  let rentals = 0;
  const spans: Record<BookingConversionStepId, number[]> = {
    waitlist_leads: [],
    started: [],
    submitted: [],
    approved: [],
    agreement_signed: [],
    card_on_file: [],
    first_rental: [],
  };
  const excluded: Record<BookingConversionStepId, boolean> = {
    waitlist_leads: false,
    started: false,
    submitted: false,
    approved: false,
    agreement_signed: false,
    card_on_file: false,
    first_rental: false,
  };

  function consider(app: BookingApplicationRow | null, appLeads: BookingLeadRow[], standalone: BookingLeadRow | null) {
    const entry = earliest([
      app?.createdAt,
      app?.waitlistSignedUpAt,
      ...appLeads.map((lead) => lead.createdAt),
      standalone?.createdAt,
    ]);
    if (!inRange(calendarDay(entry), from, to)) return;

    const leadAt = earliest([...appLeads.map((lead) => lead.createdAt), app?.waitlistSignedUpAt, standalone?.createdAt]);
    const hasLead = appLeads.length > 0 || Boolean(app?.waitlistSignedUpAt) || Boolean(standalone);
    const status = (app?.status ?? "").toLowerCase();
    const didStart = Boolean(app);
    const didSubmit = didStart && status !== "" && status !== "partial";
    const approvalTime = app ? approvedAt.get(app.id) ?? null : null;
    const didApprove = didSubmit && (Boolean(approvalTime) || status === "approved" || status === "active");
    const didSign = Boolean(app && signed.has(app.id));
    const signTime = app ? signedAt.get(app.id) ?? null : null;
    const didCard = Boolean(app && (app.cardOnFileAt || app.cardLast4 || app.stripePaymentMethodId));
    const cardTime = app?.cardOnFileAt ?? null;
    const firstRental = app ? rentalAt.get(app.id) ?? null : null;

    if (hasLead) leads += 1;
    if (didStart) started += 1;
    if (didSubmit) submitted += 1;
    if (didApprove) approved += 1;
    if (didSign) agreements += 1;
    if (didCard) cards += 1;
    if (firstRental) rentals += 1;

    const record = (id: BookingConversionStepId, fromAt: string | null, toAt: string | null) => {
      if (!fromAt || !toAt) return;
      const days = daySpan(fromAt, toAt);
      if (days == null) {
        if (calendarDay(fromAt) && calendarDay(toAt)) excluded[id] = true;
        return;
      }
      spans[id].push(days);
    };
    record("started", leadAt, app?.createdAt ?? null);
    record("agreement_signed", approvalTime, signTime);
    record("card_on_file", signTime, cardTime);
    record("first_rental", cardTime, firstRental);
  }

  for (const app of apps.values()) consider(app, leadsByApp.get(app.id) ?? [], null);
  const orphans = new Map<string, BookingLeadRow[]>();
  for (const lead of input.leads) {
    if (lead.promotedApplicationId && apps.has(lead.promotedApplicationId)) continue;
    if (!lead.promotedApplicationId) {
      consider(null, [], lead);
      continue;
    }
    const group = orphans.get(lead.promotedApplicationId) ?? [];
    group.push(lead);
    orphans.set(lead.promotedApplicationId, group);
  }
  for (const group of orphans.values()) consider(null, group, null);

  const counts: Record<BookingConversionStepId, number> = {
    waitlist_leads: leads,
    started,
    submitted,
    approved,
    agreement_signed: agreements,
    card_on_file: cards,
    first_rental: rentals,
  };

  const steps: BookingConversionStep[] = BOOKING_CONVERSION_STEPS.map((id, index) => {
    const previous = index === 0 ? null : counts[BOOKING_CONVERSION_STEPS[index - 1]];
    let medianDays: string | null = null;
    let medianNote: string | null = null;
    if (index === 0) {
      medianNote = null;
    } else if (id === "submitted" || id === "approved") {
      medianNote = SUBMITTED_MEDIAN_NOTE;
    } else if (spans[id].length === 0) {
      medianNote = "Not Recorded";
    } else {
      medianDays = formatMedian(median(spans[id]));
      if (excluded[id]) medianNote = "A step recorded before the previous one is left out.";
    }
    return {
      id,
      label: BOOKING_CONVERSION_LABEL[id],
      count: counts[id],
      conversion: previous == null ? null : percent(counts[id], previous),
      medianDays,
      medianNote,
    };
  });

  return {
    status: "ready",
    timeZone: BOOKING_TIME_ZONE,
    from,
    to,
    rangeLabel: `${formatRangeDate(from)} – ${formatRangeDate(to)}`,
    cap: BOOKING_CONVERSION_ROW_CAP,
    steps,
    note: "People whose earliest waitlist or application day falls on these Eastern dates. Later steps count whenever they happened. Conversion is this count divided by the previous count.",
  };
}
