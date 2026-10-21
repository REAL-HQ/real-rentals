// Returns Due rules. No database access and no writes.
// Active rentals whose end date is already past, or falls within the next N
// Eastern calendar days. Today's Ops only names today and tomorrow.
// Renewal Due also uses next billing and leaves past dates out.
// This list uses rentals.end_date only.

export const RETURNS_TIME_ZONE = "America/New_York";
export const RETURNS_DUE_WINDOW_DAYS = 7;
export const RETURNS_DUE_LIMIT = 200;

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RETURNS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

export function returnsHorizon(today: string): string {
  return addCalendarDays(today, RETURNS_DUE_WINDOW_DAYS);
}

function utcDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Calendar days from today to the due date. Negative means overdue. */
export function daysUntilDue(today: string, due: string): number {
  const ms = utcDate(due).getTime() - utcDate(today).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatDueBack(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(isoDate));
}

export function returnsDueLabel(days: number): string {
  if (days < 0) {
    const n = -days;
    return n === 1 ? "1 Day Overdue" : `${n} Days Overdue`;
  }
  if (days === 0) return "Due Today";
  if (days === 1) return "Due Tomorrow";
  return `Due In ${days} Days`;
}

export function vehicleDueLabel(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  unit_number?: string | null;
} | null): string {
  if (!vehicle) return "Unknown Vehicle";
  const unit = vehicle.unit_number?.trim() ? `#${vehicle.unit_number.trim()}` : "";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part != null && String(part).trim() !== "").join(" ");
  return [unit, name].filter(Boolean).join(" ") || "Unknown Vehicle";
}

export type ReturnsDueInput = {
  id: string;
  status: string | null;
  endDate: string | null;
  driverName: string | null;
  vehicleLabel: string;
};

export type ReturnsDueRow = {
  rentalId: string;
  driverName: string;
  vehicleLabel: string;
  dueBack: string;
  days: number;
  state: "overdue" | "due";
  label: string;
};

export type ReturnsDueBoard = {
  today: string;
  through: string;
  windowDays: number;
  rows: ReturnsDueRow[];
  truncated: boolean;
};

/** Active rentals only. A missing end date is not due back. Past the window is omitted. */
export function buildReturnsDue(rows: ReturnsDueInput[], today: string, truncated = false): ReturnsDueBoard {
  const through = returnsHorizon(today);
  const out: ReturnsDueRow[] = [];
  for (const row of rows) {
    if (row.status !== "active") continue;
    const dueBack = dateOnly(row.endDate);
    if (!dueBack) continue;
    if (dueBack > through) continue;
    const days = daysUntilDue(today, dueBack);
    out.push({
      rentalId: row.id,
      driverName: row.driverName?.trim() || "No Driver",
      vehicleLabel: row.vehicleLabel.trim() || "Unknown Vehicle",
      dueBack,
      days,
      state: days < 0 ? "overdue" : "due",
      label: returnsDueLabel(days),
    });
  }
  out.sort((a, b) => (a.dueBack < b.dueBack ? -1 : a.dueBack > b.dueBack ? 1 : a.rentalId < b.rentalId ? -1 : 1));
  return { today, through, windowDays: RETURNS_DUE_WINDOW_DAYS, rows: out, truncated };
}
