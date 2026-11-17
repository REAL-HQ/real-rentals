/**
 * Staff coverage for handoffs: who is on duty, and which company line to
 * reach them on. Pure functions only. Hours and holiday/off exceptions are
 * stored in public.staff_schedules and public.staff_schedule_exceptions;
 * this file holds the fallback defaults (names and weekly hours, never a
 * staff or renter phone number) and the clock math.
 *
 * Rosa DeJesus covers Real Rentals hours (America/New_York):
 *   Mon 2:00–6:00 PM, Tue 9:00 AM–3:00 PM, Wed 9:00 AM–3:00 PM, Fri 9:00 AM–1:00 PM.
 *   Off Thu, Sat, Sun, and any stored "off" exception.
 * Dolmar Cross is after-hours coverage and the field rep.
 *
 * Reach: during Rosa's hours, text the *other* company Quo line (the one the
 * renter is not already on) so she can pick up in Quo. Outside her hours,
 * text the field-rep numbers from the Pickup Schedule settings.
 *
 * Applicant calls are not placed after 6:00 PM ET. Bot texts to renters stay
 * in 8 AM–9 PM ET (withinTextingHours). Injuries still go to the field rep
 * at any hour.
 */
import { withinTextingHours } from "@/lib/failed-payment-link";

export const STAFF_TIMEZONE = "America/New_York";
export const STAFF_SCHEDULES_TABLE = "staff_schedules";
export const STAFF_EXCEPTIONS_TABLE = "staff_schedule_exceptions";

export type StaffRole = "coverage" | "after_hours" | "field_rep";
export type StaffReachVia = "other_quo_line" | "field_rep_sms";
export type ExceptionKind = "off" | "on";

/** 0 = Sunday ... 6 = Saturday. Times are 24-hour HH:mm in `timezone`. */
export type WeeklyWindow = { dow: number; start: string; end: string };

export type StaffSchedule = {
  staffKey: string;
  displayName: string;
  roles: StaffRole[];
  timezone: string;
  windows: WeeklyWindow[];
  reachVia: StaffReachVia;
  isActive: boolean;
};

export type StaffException = {
  staffKey: string;
  /** Calendar date in the staff timezone, YYYY-MM-DD. */
  date: string;
  kind: ExceptionKind;
  start: string | null;
  end: string | null;
  note: string | null;
};

/** A company phone line (PN id + E.164). Never a staff or renter personal number. */
export type CompanyLine = { id: string; label: string; display: string; e164: string };

export type EtParts = {
  year: number;
  month: number;
  day: number;
  dow: number;
  hour: number;
  minute: number;
  minutes: number;
  dateKey: string;
};

export const DEFAULT_STAFF_SCHEDULES: readonly StaffSchedule[] = [
  {
    staffKey: "rosa",
    displayName: "Rosa DeJesus",
    roles: ["coverage"],
    timezone: STAFF_TIMEZONE,
    windows: [
      { dow: 1, start: "14:00", end: "18:00" },
      { dow: 2, start: "09:00", end: "15:00" },
      { dow: 3, start: "09:00", end: "15:00" },
      { dow: 5, start: "09:00", end: "13:00" },
    ],
    reachVia: "other_quo_line",
    isActive: true,
  },
  {
    staffKey: "dolmar",
    displayName: "Dolmar Cross",
    roles: ["after_hours", "field_rep"],
    timezone: STAFF_TIMEZONE,
    windows: [],
    reachVia: "field_rep_sms",
    isActive: true,
  },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DOW_NAME: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function etParts(at: Date, timeZone: string = STAFF_TIMEZONE): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") bag[p.type] = p.value;
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  const dow = DOW_NAME[bag.weekday] ?? 0;
  return {
    year,
    month,
    day,
    dow,
    hour,
    minute,
    minutes: hour * 60 + minute,
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function isValidHhmm(value: unknown): value is string {
  return typeof value === "string" && HHMM.test(value);
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY.test(value);
}

/** Inclusive start, exclusive end, same weekday. 2:00 PM is on; 6:00 PM is off. */
export function isInWeeklyWindow(parts: EtParts, window: WeeklyWindow): boolean {
  if (parts.dow !== window.dow) return false;
  if (!isValidHhmm(window.start) || !isValidHhmm(window.end)) return false;
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  return parts.minutes >= start && parts.minutes < end;
}

export function exceptionOn(
  exceptions: readonly StaffException[],
  staffKey: string,
  dateKey: string,
): StaffException | null {
  return exceptions.find((e) => e.staffKey === staffKey && e.date === dateKey) ?? null;
}

/**
 * Is this staff person on duty at `at`? An "off" exception wins over the
 * weekly window. An "on" exception covers that date, using its start/end when
 * both are set, otherwise the whole calendar day.
 */
export function isStaffOnDuty(schedule: StaffSchedule, exceptions: readonly StaffException[], at: Date): boolean {
  if (!schedule.isActive) return false;
  const parts = etParts(at, schedule.timezone || STAFF_TIMEZONE);
  const ex = exceptionOn(exceptions, schedule.staffKey, parts.dateKey);
  if (ex?.kind === "off") return false;
  if (ex?.kind === "on") {
    if (isValidHhmm(ex.start) && isValidHhmm(ex.end)) {
      return parts.minutes >= toMinutes(ex.start) && parts.minutes < toMinutes(ex.end);
    }
    return true;
  }
  return schedule.windows.some((w) => isInWeeklyWindow(parts, w));
}

export function coverageUntil(
  schedule: StaffSchedule,
  exceptions: readonly StaffException[],
  at: Date,
): string | null {
  if (!isStaffOnDuty(schedule, exceptions, at)) return null;
  const parts = etParts(at, schedule.timezone || STAFF_TIMEZONE);
  const ex = exceptionOn(exceptions, schedule.staffKey, parts.dateKey);
  if (ex?.kind === "on" && isValidHhmm(ex.end)) return ex.end;
  const open = schedule.windows.filter((w) => isInWeeklyWindow(parts, w));
  return open.length ? open[0].end : null;
}

export type OnDutyStaff = {
  schedule: StaffSchedule;
  until: string | null;
  source: "coverage" | "after_hours";
};

/** The coverage person if one is on duty, otherwise the after-hours person. */
export function resolveOnDuty(
  schedules: readonly StaffSchedule[] = DEFAULT_STAFF_SCHEDULES,
  exceptions: readonly StaffException[] = [],
  at: Date = new Date(),
): OnDutyStaff | null {
  const active = schedules.filter((s) => s.isActive);
  const coverage = active.find((s) => s.roles.includes("coverage") && isStaffOnDuty(s, exceptions, at));
  if (coverage) return { schedule: coverage, until: coverageUntil(coverage, exceptions, at), source: "coverage" };
  const after = active.find((s) => s.roles.includes("after_hours"));
  return after ? { schedule: after, until: null, source: "after_hours" } : null;
}

export function fieldRepSchedule(
  schedules: readonly StaffSchedule[] = DEFAULT_STAFF_SCHEDULES,
): StaffSchedule | null {
  return schedules.find((s) => s.isActive && s.roles.includes("field_rep")) ?? null;
}

/**
 * The company line that is not the one the renter/bot is already on.
 * Accepts a PN id or E.164. Unknown or missing → treat as the first
 * (default) sender, so the handoff goes to the other one.
 */
export function otherCompanyLine(
  lines: readonly CompanyLine[],
  activeLine?: string | null,
): CompanyLine | null {
  if (lines.length < 2) return null;
  const key = String(activeLine ?? "").trim();
  const active = key ? lines.find((s) => s.id === key || s.e164 === key) ?? lines[0] : lines[0];
  return lines.find((s) => s.id !== active.id) ?? null;
}

export function activeCompanyLine(
  lines: readonly CompanyLine[],
  activeLine?: string | null,
): CompanyLine | null {
  if (!lines.length) return null;
  const key = String(activeLine ?? "").trim();
  return (key ? lines.find((s) => s.id === key || s.e164 === key) : null) ?? lines[0];
}

/** True when `value` is one of the given company lines (PN id or E.164). */
export function isCompanyLine(
  lines: readonly CompanyLine[],
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  return lines.some((s) => s.id === value || s.e164 === value);
}

/** Applicant calls are allowed from 8:00 AM up to, but not including, 6:00 PM ET. */
export function mayPlaceApplicantCall(at: Date = new Date()): boolean {
  const { minutes } = etParts(at);
  return minutes >= 8 * 60 && minutes < 18 * 60;
}

/** Bot texts to renters: 8 AM to 9 PM Eastern. */
export function mayTextRenter(at: Date = new Date()): boolean {
  return withinTextingHours(at);
}

export type CoverageSnapshot = {
  timezone: typeof STAFF_TIMEZONE;
  onDuty: { staffKey: string; name: string; until: string | null; source: "coverage" | "after_hours" } | null;
  reachVia: StaffReachVia | null;
  mayCallApplicant: boolean;
  renterTextingHours: boolean;
};

export function coverageSnapshot(
  schedules: readonly StaffSchedule[] = DEFAULT_STAFF_SCHEDULES,
  exceptions: readonly StaffException[] = [],
  at: Date = new Date(),
): CoverageSnapshot {
  const on = resolveOnDuty(schedules, exceptions, at);
  return {
    timezone: STAFF_TIMEZONE,
    onDuty: on
      ? { staffKey: on.schedule.staffKey, name: on.schedule.displayName, until: on.until, source: on.source }
      : null,
    reachVia: on?.schedule.reachVia ?? null,
    mayCallApplicant: mayPlaceApplicantCall(at),
    renterTextingHours: mayTextRenter(at),
  };
}

/** Parse weekly_windows JSON from the staff_schedules table. */
export function readWeeklyWindows(value: unknown): WeeklyWindow[] {
  if (!Array.isArray(value)) return [];
  const out: WeeklyWindow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const dow = Number((row as { dow?: unknown }).dow);
    const start = (row as { start?: unknown }).start;
    const end = (row as { end?: unknown }).end;
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    if (!isValidHhmm(start) || !isValidHhmm(end)) continue;
    if (toMinutes(start) >= toMinutes(end)) continue;
    out.push({ dow, start, end });
  }
  return out;
}

export function readRoles(value: unknown): StaffRole[] {
  const allowed: StaffRole[] = ["coverage", "after_hours", "field_rep"];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is StaffRole => allowed.includes(v as StaffRole));
}

export function readReachVia(value: unknown): StaffReachVia {
  return value === "other_quo_line" || value === "field_rep_sms" ? value : "field_rep_sms";
}
