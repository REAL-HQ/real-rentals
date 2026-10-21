/**
 * Booking conversion for the existing Bookings and Leads screens.
 *
 * Off until an owner changes this constant and rebuilds. No environment
 * variable can turn it on. The server function refuses before the role check
 * and before any read while this stays false.
 */
export const BOOKING_CONVERSION_ENABLED: boolean = false;

export function assertBookingConversionEnabled(): void {
  if (BOOKING_CONVERSION_ENABLED !== true) {
    throw new Error("Booking conversion is not enabled.");
  }
}

export const BOOKING_TIME_ZONE = "America/New_York";
/** Last eight Eastern weeks, including the week that contains today. */
export const BOOKING_CONVERSION_WEEKS = 8;
/**
 * Each read asks for one more row than this. The extra row is the overflow
 * sentinel and is not counted. A truncated report has no rates.
 */
export const BOOKING_CONVERSION_ROW_CAP = 1000;

const APPROVED_STATUSES = new Set(["approved", "active", "closed"]);

export type WaitlistFact = {
  id: string;
  createdAt: string;
  source: string | null;
  utmSource: string | null;
  gclid: string | null;
  promotedApplicationId: string | null;
};

export type ApplicationFact = {
  id: string;
  createdAt: string;
  status: string | null;
  source: string | null;
  utmSource: string | null;
  gclid: string | null;
  waitlistSource: string | null;
};

export type ConversionCounts = {
  leads: number;
  applications: number;
  approved: number;
  firstRentals: number;
};

export type ConversionRates = {
  toApplication: number | null;
  toApproved: number | null;
  toFirstRental: number | null;
};

export type ConversionRow = {
  weekStart: string;
  weekLabel: string;
  source: string;
  counts: ConversionCounts;
  rates: ConversionRates;
};

export type BookingConversionReport =
  | { truncated: true; cap: number }
  | {
      truncated: false;
      cap: number;
      weeks: number;
      from: string;
      to: string;
      rows: ConversionRow[];
      totals: ConversionCounts;
      rates: ConversionRates;
    };

export type ConversionWindow = {
  startMonday: string;
  endMonday: string;
  startMs: number;
  endMs: number;
};

function zoneParts(instant: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone: BOOKING_TIME_ZONE, ...options }).formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

/** Eastern calendar date, YYYY-MM-DD. */
export function easternDate(instant: Date): string {
  const p = zoneParts(instant, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

function easternClock(instant: Date): string {
  const p = zoneParts(instant, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${hour}:${p.minute}`;
}

/** UTC instant of midnight at the start of an Eastern calendar date. */
export function easternMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  for (const hour of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
    if (easternDate(candidate) === ymd && easternClock(candidate) === "00:00") return candidate;
  }
  throw new Error(`No Eastern midnight for ${ymd}`);
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** Monday of the Eastern week that contains this calendar date. Weeks start Monday. */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  return addCalendarDays(ymd, -delta);
}

export function weekLabel(monday: string): string {
  const [y, m, d] = monday.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `Week Of ${month} ${d}, ${y}`;
}

export function conversionWindow(now: Date): ConversionWindow {
  const thisMonday = weekStart(easternDate(now));
  const startMonday = addCalendarDays(thisMonday, -7 * (BOOKING_CONVERSION_WEEKS - 1));
  const endMonday = addCalendarDays(thisMonday, 7);
  return {
    startMonday,
    endMonday,
    startMs: easternMidnight(startMonday).getTime(),
    endMs: easternMidnight(endMonday).getTime(),
  };
}

function inWindow(iso: string, window: ConversionWindow): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= window.startMs && t < window.endMs;
}

/**
 * Where the person came from. A click id is Google Ads. Otherwise the
 * recorded utm source, then the form source, then Direct. Values stay as
 * recorded so a source code is not rewritten.
 */
export function acquisitionSource(row: {
  gclid?: string | null;
  utmSource?: string | null;
  source?: string | null;
  waitlistSource?: string | null;
}): string {
  if (row.gclid?.trim()) return "Google Ads";
  const utm = row.utmSource?.trim();
  if (utm) return utm;
  const source = row.source?.trim();
  if (source) return source;
  const wait = row.waitlistSource?.trim();
  if (wait) return wait;
  return "Direct";
}

function emptyCounts(): ConversionCounts {
  return { leads: 0, applications: 0, approved: 0, firstRentals: 0 };
}

/** One decimal percent. Null when the previous step has nobody. */
export function conversionRate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function ratesFor(counts: ConversionCounts): ConversionRates {
  return {
    toApplication: conversionRate(counts.applications, counts.leads),
    toApproved: conversionRate(counts.approved, counts.applications),
    toFirstRental: conversionRate(counts.firstRentals, counts.approved),
  };
}

function isDuplicate(status: string | null): boolean {
  return String(status ?? "").trim().toLowerCase() === "duplicate";
}

type Person = {
  at: string;
  source: string;
  lead: boolean;
  applicationId: string | null;
};

/**
 * One person is a lead (a waitlist row) or a booking request (an application
 * with no in-window waitlist). Later steps count whenever they happened.
 * The week and source come from the earliest in-window entry.
 */
export function buildBookingConversion(input: {
  now: Date;
  waitlist: WaitlistFact[];
  applications: ApplicationFact[];
  approvals: { applicationId: string }[];
  rentals: { applicationId: string }[];
  truncated: boolean;
}): BookingConversionReport {
  if (input.truncated) return { truncated: true, cap: BOOKING_CONVERSION_ROW_CAP };
  const window = conversionWindow(input.now);
  const apps = new Map(input.applications.filter((row) => !isDuplicate(row.status)).map((row) => [row.id, row]));
  const people = new Map<string, Person>();

  const remember = (key: string, at: string, source: string, lead: boolean, applicationId: string | null) => {
    const prior = people.get(key);
    if (!prior) {
      people.set(key, { at, source, lead, applicationId });
      return;
    }
    if (lead) prior.lead = true;
    if (!prior.applicationId && applicationId) prior.applicationId = applicationId;
    if (Date.parse(at) < Date.parse(prior.at)) {
      prior.at = at;
      prior.source = source;
    }
  };

  const waitlist = [...input.waitlist].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const row of waitlist) {
    if (!inWindow(row.createdAt, window)) continue;
    const appId = row.promotedApplicationId;
    const key = appId ? `app:${appId}` : `wait:${row.id}`;
    remember(key, row.createdAt, acquisitionSource(row), true, appId);
  }

  for (const row of input.applications) {
    if (isDuplicate(row.status) || !inWindow(row.createdAt, window)) continue;
    remember(
      `app:${row.id}`,
      row.createdAt,
      acquisitionSource({
        gclid: row.gclid,
        utmSource: row.utmSource,
        source: row.source,
        waitlistSource: row.waitlistSource,
      }),
      false,
      row.id,
    );
  }

  const approved = new Set(input.approvals.map((row) => row.applicationId));
  const rented = new Set(input.rentals.map((row) => row.applicationId));
  const cells = new Map<string, ConversionCounts>();

  for (const person of people.values()) {
    const app = person.applicationId ? apps.get(person.applicationId) : undefined;
    const hasApplication = !!app;
    const isApproved =
      hasApplication &&
      (APPROVED_STATUSES.has(String(app.status ?? "").trim().toLowerCase()) ||
        approved.has(app.id) ||
        rented.has(app.id));
    const hasRental = hasApplication && rented.has(app.id);
    const week = weekStart(easternDate(new Date(person.at)));
    const key = `${week}\t${person.source}`;
    const cell = cells.get(key) ?? emptyCounts();
    cell.leads += 1;
    if (hasApplication) cell.applications += 1;
    if (isApproved) cell.approved += 1;
    if (hasRental) cell.firstRentals += 1;
    cells.set(key, cell);
  }

  const rows: ConversionRow[] = [...cells.entries()]
    .map(([key, counts]) => {
      const [week, source] = key.split("\t");
      return { weekStart: week, weekLabel: weekLabel(week), source, counts, rates: ratesFor(counts) };
    })
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.source.localeCompare(b.source));

  const totals = emptyCounts();
  for (const row of rows) {
    totals.leads += row.counts.leads;
    totals.applications += row.counts.applications;
    totals.approved += row.counts.approved;
    totals.firstRentals += row.counts.firstRentals;
  }

  return {
    truncated: false,
    cap: BOOKING_CONVERSION_ROW_CAP,
    weeks: BOOKING_CONVERSION_WEEKS,
    from: window.startMonday,
    to: addCalendarDays(window.endMonday, -1),
    rows,
    totals,
    rates: ratesFor(totals),
  };
}
