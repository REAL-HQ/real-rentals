// Follow-up aging for an incident already on the Incidents list.
// Days are Eastern calendar days. A missing date stays Unknown.
// An unresolved deduction means the driver-responsible amount is still
// larger than the non-negative deductions recorded for that incident.
// Nothing here is invented, and nothing is written.

const EASTERN = "America/New_York";
const FINISHED = new Set(["closed", "written_off"]);

export type DeductionFlag = "unresolved" | "resolved" | "unknown";

export type IncidentAging = {
  incidentId: string;
  daysOpen: string;
  lastUpdate: string;
  unresolvedDeduction: DeductionFlag;
};

export function easternCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

/** A date-only value stays that calendar day. A timestamp becomes its Eastern day. */
export function easternDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return easternCalendarDate(date);
}

function calendarDays(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return Number.isInteger(days) && days >= 0 ? days : null;
}

export function daysOpenLabel(days: number): string {
  if (days === 0) return "Opened Today";
  if (days === 1) return "1 Day Open";
  return `${days.toLocaleString("en-US")} Days Open`;
}

export function incidentDaysOpen(input: {
  status: string | null;
  occurredAt: string | null;
  updatedAt: string | null;
  today: string;
}): string {
  const start = easternDateOf(input.occurredAt);
  if (!start) return "Unknown";
  const finished = FINISHED.has(String(input.status ?? ""));
  const end = finished ? easternDateOf(input.updatedAt) : input.today;
  if (!end) return "Unknown";
  const days = calendarDays(start, end);
  return days == null ? "Unknown" : daysOpenLabel(days);
}

export function incidentLastUpdate(updatedAt: string | null | undefined): string {
  return easternDateOf(updatedAt) ?? "Unknown";
}

function cents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const amount = Math.round(value * 100);
    return Number.isSafeInteger(amount) ? amount : null;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const amount = Math.round(Number(value.trim()) * 100);
    return Number.isSafeInteger(amount) ? amount : null;
  }
  return null;
}

/** Negative deduction rows are ignored. A missing amount is Unknown, not resolved. */
export function unresolvedDeduction(responsible: unknown, amounts: unknown[]): DeductionFlag {
  const owed = cents(responsible);
  if (owed == null) return "unknown";
  let settled = 0;
  for (const amount of amounts) {
    const value = cents(amount);
    if (value == null) return "unknown";
    if (value < 0) continue;
    settled += value;
  }
  if (!Number.isSafeInteger(settled)) return "unknown";
  if (owed <= 0) return "resolved";
  return settled < owed ? "unresolved" : "resolved";
}

export function incidentAging(input: {
  incidentId: string;
  status: string | null;
  occurredAt: string | null;
  updatedAt: string | null;
  responsible: unknown;
  deductionAmounts: unknown[];
  today: string;
}): IncidentAging {
  return {
    incidentId: input.incidentId,
    daysOpen: incidentDaysOpen(input),
    lastUpdate: incidentLastUpdate(input.updatedAt),
    unresolvedDeduction: unresolvedDeduction(input.responsible, input.deductionAmounts),
  };
}
