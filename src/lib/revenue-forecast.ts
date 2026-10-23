/**
 * Read-only 4-week rental income projection. Eastern Time weeks are Monday
 * through Sunday. A figure here is expected income, not money collected.
 * No database access.
 */

export const PROJECTION_LABEL = "Projection, Not Collected Money";
export const IDLE_POTENTIAL_LABEL = "Potential If Idle Vehicles Were Rented";
export const FORECAST_PAGE_CAP = "Record Page Cap Reached. The Forecast Is Not Shown.";
export const WEEK_COUNT = 4;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INACTIVE = new Set(["archived", "sold", "retired"]);

export type ForecastRental = {
  id: string;
  vehicleId: string;
  status: string;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  endDate: string | null;
};

export type ForecastVehicle = {
  id: string;
  label: string;
  status: string;
  weeklyRate: number | null;
  archived: boolean;
};

export type ForecastWeek = { from: string; through: string; label: string; cents: number };

export type ForecastVehicleRow = {
  vehicleId: string;
  label: string;
  weekCents: number[];
  totalCents: number;
};

export type RevenueForecastReport = {
  projectionLabel: string;
  today: string;
  weeks: ForecastWeek[];
  vehicles: ForecastVehicleRow[];
  totalCents: number;
  excludedMissingDue: number;
  idleCount: number;
  idlePotentialCents: number;
  idleRateNotSet: number;
  warnings: string[];
};

export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(ymd: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function forecastWeeks(today: string): Array<{ from: string; through: string; label: string }> | null {
  const monday = mondayOf(today);
  if (!monday) return null;
  const weeks = [];
  for (let index = 0; index < WEEK_COUNT; index++) {
    const from = addCalendarDays(monday, index * 7);
    const through = from ? addCalendarDays(from, 6) : null;
    if (!from || !through) return null;
    weeks.push({ from, through, label: weekLabel(from, through) });
  }
  return weeks;
}

/**
 * Expected charges are weekly_rate on next_payment_due and every 7 days after,
 * while the charge date is on or before end_date. A rental that ends
 * contributes nothing after that date. A missing next_payment_due is left out
 * and counted. Idle potential is listed vehicle rates and is not added to the weeks.
 */
export function buildRevenueForecast(input: {
  today: string;
  rentals: ForecastRental[];
  vehicles: ForecastVehicle[];
}): RevenueForecastReport | null {
  const ranges = forecastWeeks(input.today);
  if (!ranges) return null;
  const windowStart = ranges[0]!.from;
  const windowEnd = ranges[ranges.length - 1]!.through;
  const vehicleById = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const occupied = new Set<string>();
  const byVehicle = new Map<string, number[]>();
  let excludedMissingDue = 0;

  for (const rental of input.rentals) {
    if (rental.status.trim().toLowerCase() !== "active") continue;
    if (rental.vehicleId) occupied.add(rental.vehicleId);
    const due = dateOnly(rental.nextPaymentDue);
    if (!due) {
      excludedMissingDue += 1;
      continue;
    }
    const cents = dollarsToCents(rental.weeklyRate);
    if (cents === null) continue;
    const end = dateOnly(rental.endDate);
    if (rental.endDate && !end) continue;
    const dates = chargeDates(due, windowStart, windowEnd, end);
    if (!dates.length) continue;
    const row = byVehicle.get(rental.vehicleId) ?? [0, 0, 0, 0];
    for (const date of dates) {
      const index = ranges.findIndex((week) => date >= week.from && date <= week.through);
      if (index >= 0) row[index] = (row[index] ?? 0) + cents;
    }
    byVehicle.set(rental.vehicleId, row);
  }

  const vehicles: ForecastVehicleRow[] = [...byVehicle.entries()]
    .map(([vehicleId, weekCents]) => ({
      vehicleId,
      label: vehicleById.get(vehicleId)?.label || "Vehicle",
      weekCents,
      totalCents: weekCents.reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));

  const weeks: ForecastWeek[] = ranges.map((week, index) => ({
    ...week,
    cents: vehicles.reduce((sum, vehicle) => sum + (vehicle.weekCents[index] ?? 0), 0),
  }));

  let idleCount = 0;
  let idlePotentialCents = 0;
  let idleRateNotSet = 0;
  for (const vehicle of input.vehicles) {
    if (!isIdle(vehicle, occupied)) continue;
    idleCount += 1;
    const cents = dollarsToCents(vehicle.weeklyRate);
    if (cents === null) idleRateNotSet += 1;
    else idlePotentialCents += cents;
  }

  return {
    projectionLabel: PROJECTION_LABEL,
    today: input.today,
    weeks,
    vehicles,
    totalCents: weeks.reduce((sum, week) => sum + week.cents, 0),
    excludedMissingDue,
    idleCount,
    idlePotentialCents,
    idleRateNotSet,
    warnings: [],
  };
}

export function revenueForecastToCsv(report: RevenueForecastReport): string {
  const lines: string[][] = [
    [PROJECTION_LABEL],
    ["Week", "From", "Through", "Projected Income"],
  ];
  report.weeks.forEach((week, index) => {
    lines.push([`Week ${index + 1}`, week.from, week.through, dollars(week.cents)]);
  });
  lines.push(["Total", "", "", dollars(report.totalCents)]);
  lines.push([]);
  lines.push(["Vehicle", "Week 1", "Week 2", "Week 3", "Week 4", "Total"]);
  for (const vehicle of report.vehicles) {
    lines.push([vehicle.label, ...vehicle.weekCents.map(dollars), dollars(vehicle.totalCents)]);
  }
  lines.push([]);
  lines.push(["Idle Vehicles", String(report.idleCount)]);
  lines.push([IDLE_POTENTIAL_LABEL, dollars(report.idlePotentialCents)]);
  lines.push(["Idle Vehicles With No Listed Rate", String(report.idleRateNotSet)]);
  lines.push(["Active Rentals Excluded For Missing Next Payment Due", String(report.excludedMissingDue)]);
  for (const warning of report.warnings) lines.push([warning]);
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function dollarsToCents(amount: number | null): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function chargeDates(due: string, windowStart: string, windowEnd: string, end: string | null): string[] {
  let cursor = due < windowStart ? firstOnOrAfter(due, windowStart) : due;
  const dates: string[] = [];
  for (let step = 0; cursor && step < WEEK_COUNT + 2 && cursor <= windowEnd; step++) {
    if (end && cursor > end) break;
    if (cursor >= windowStart) dates.push(cursor);
    cursor = addCalendarDays(cursor, 7);
  }
  return dates;
}

function firstOnOrAfter(due: string, start: string): string | null {
  const delta = calendarDays(due, start);
  if (delta === null) return null;
  if (delta <= 0) return due;
  return addCalendarDays(due, Math.ceil(delta / 7) * 7);
}

function isIdle(vehicle: ForecastVehicle, occupied: Set<string>): boolean {
  if (vehicle.archived) return false;
  const status = vehicle.status.trim().toLowerCase();
  if (INACTIVE.has(status)) return false;
  if (occupied.has(vehicle.id)) return false;
  return true;
}

function mondayOf(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(ymd, delta);
}

function calendarDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function dateOnly(value: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return match ? match[1]! : null;
}

function weekLabel(from: string, through: string): string {
  return `${shortDate(from)} – ${shortDate(through)} ET`;
}

function shortDate(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}, ${year}`;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
