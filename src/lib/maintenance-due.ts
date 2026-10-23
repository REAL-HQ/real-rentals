// Read-only "next service" facts for the Vehicles page.
//
// Dates and mileages are shown only when a stored column already says them.
// A missing fact is "Unknown". Nothing here invents an oil interval, a tire
// interval, or an inspection expiry.

/** Dark until the owner installs any missing columns and turns the view on. */
export const MAINTENANCE_DUE_ENABLED = false;

export const MAINTENANCE_DUE_KINDS = [
  { id: "oil_change", label: "Oil Change" },
  { id: "tires", label: "Tires" },
  { id: "registration_inspection", label: "Registration / Inspection" },
  { id: "insurance", label: "Insurance" },
] as const;

export type DueKind = (typeof MAINTENANCE_DUE_KINDS)[number]["id"];

export type DueBadge = "overdue" | "due_14" | "ok" | "unknown";

export const DUE_BADGE_LABEL: Record<DueBadge, string> = {
  overdue: "Overdue",
  due_14: "Due In 14 Days",
  ok: "OK",
  unknown: "Unknown",
};

const UNKNOWN = "Unknown";

/** Calendar date, or null when the value is not a real YYYY-MM-DD. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1];
}

/** Non-negative integer miles, or null. Fractional miles are not rounded. */
export function parseMiles(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

export function addCalendarDays(iso: string, days: number): string | null {
  const parsed = parseIsoDate(iso);
  if (!parsed || !Number.isInteger(days)) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** America/New_York calendar date for "today". */
export function businessToday(now = new Date()): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseIsoDate(formatted) ?? formatted;
}

export function badgeFromDate(today: string, dueOn: unknown): DueBadge {
  const due = parseIsoDate(dueOn);
  const start = parseIsoDate(today);
  if (!due || !start) return "unknown";
  if (due < start) return "overdue";
  const soon = addCalendarDays(start, 14);
  if (!soon || due <= soon) return "due_14";
  return "ok";
}

/**
 * Mileage can prove Overdue when the current reading has reached the stored
 * due mileage. Miles still remaining do not say whether that is inside 14 days.
 */
export function milesOverdue(dueMiles: unknown, currentMiles: unknown): boolean {
  const due = parseMiles(dueMiles);
  const current = parseMiles(currentMiles);
  if (due == null || current == null) return false;
  return current >= due;
}

/** Due mileage is on file, but the car has no current reading to compare. */
export function milesIncomparable(dueMiles: unknown, currentMiles: unknown): boolean {
  return parseMiles(dueMiles) != null && parseMiles(currentMiles) == null;
}

/**
 * Date window and mileage, without inventing a miles-per-day rate.
 * OK requires a due date more than 14 days out and no mileage conflict.
 */
export function serviceBadge(input: {
  today: string;
  dueOn: unknown;
  dueMiles: unknown;
  currentMiles: unknown;
}): DueBadge {
  if (milesOverdue(input.dueMiles, input.currentMiles)) return "overdue";
  const dated = badgeFromDate(input.today, input.dueOn);
  if (dated === "overdue" || dated === "due_14") return dated;
  if (dated === "ok") return milesIncomparable(input.dueMiles, input.currentMiles) ? "unknown" : "ok";
  return "unknown";
}

/** Overdue, then Due In 14 Days. OK only when every part is OK. */
export function combineBadges(parts: DueBadge[]): DueBadge {
  if (parts.some((part) => part === "overdue")) return "overdue";
  if (parts.some((part) => part === "due_14")) return "due_14";
  if (parts.length > 0 && parts.every((part) => part === "ok")) return "ok";
  return "unknown";
}

export type VehicleDueSource = {
  id: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  status: string | null;
  bodyType: string | null;
  partnerId: string | null;
  currentMiles: unknown;
  registrationExpiresOn: unknown;
  insuranceExpiresOn: unknown;
};

export type ExpenseDueSource = {
  vehicleId: string;
  category: string;
  incurredOn: unknown;
};

/** Optional row from proposed/maintenance-due-v1.sql. Absent when that table is not installed. */
export type StoredDueSource = {
  vehicleId: string;
  oilLastOn: unknown;
  oilLastMiles: unknown;
  oilDueOn: unknown;
  oilDueMiles: unknown;
  tiresLastMiles: unknown;
  tiresDueOn: unknown;
  tiresDueMiles: unknown;
  inspectionDueOn: unknown;
};

export type DueItem = {
  kind: DueKind;
  label: string;
  lastService: string;
  dueBy: string;
  badge: DueBadge;
  badgeLabel: string;
};

export type VehicleDueRow = {
  vehicleId: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  status: string | null;
  bodyType: string | null;
  partnerId: string | null;
  currentMiles: string;
  items: DueItem[];
};

const MILES = new Intl.NumberFormat("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function showDate(value: unknown): string | null {
  const iso = parseIsoDate(value);
  if (!iso) return null;
  const [, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${iso.slice(0, 4)}`;
}

function showMiles(value: unknown): string | null {
  const miles = parseMiles(value);
  return miles == null ? null : `${MILES.format(miles)} mi`;
}

function joinKnown(parts: Array<string | null>): string {
  const known = parts.filter((part): part is string => part != null && part !== "");
  return known.length ? known.join(" · ") : UNKNOWN;
}

function item(kind: DueKind, label: string, lastService: string, dueBy: string, badge: DueBadge): DueItem {
  return { kind, label, lastService, dueBy, badge, badgeLabel: DUE_BADGE_LABEL[badge] };
}

function latestDate(values: unknown[]): string | null {
  const dates = values.map(parseIsoDate).filter((date): date is string => date != null).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

const EXPENSE_CATEGORIES = new Set(["tires", "registration", "insurance"]);

function expensesFor(rows: ExpenseDueSource[], vehicleId: string, category: string): ExpenseDueSource[] {
  if (!EXPENSE_CATEGORIES.has(category)) return [];
  return rows.filter((row) => row.vehicleId === vehicleId && row.category === category);
}

export function buildMaintenanceDue(input: {
  today: string;
  vehicles: VehicleDueSource[];
  expenses: ExpenseDueSource[];
  stored: StoredDueSource[];
}): VehicleDueRow[] {
  const storedByVehicle = new Map(input.stored.map((row) => [row.vehicleId, row]));
  return input.vehicles.map((vehicle) => {
    const stored = storedByVehicle.get(vehicle.id);
    const current = showMiles(vehicle.currentMiles);
    const oilLast = joinKnown([showDate(stored?.oilLastOn), showMiles(stored?.oilLastMiles)]);
    const oilDue = joinKnown([showDate(stored?.oilDueOn), showMiles(stored?.oilDueMiles)]);
    const oil = item(
      "oil_change",
      "Oil Change",
      oilLast,
      oilDue,
      serviceBadge({
        today: input.today,
        dueOn: stored?.oilDueOn,
        dueMiles: stored?.oilDueMiles,
        currentMiles: vehicle.currentMiles,
      }),
    );

    const tireDate = latestDate(expensesFor(input.expenses, vehicle.id, "tires").map((row) => row.incurredOn));
    const tireLast = joinKnown([
      tireDate ? showDate(tireDate) : null,
      showMiles(stored?.tiresLastMiles) ? `Recorded ${showMiles(stored?.tiresLastMiles)}` : null,
    ]);
    const tireDue = joinKnown([showDate(stored?.tiresDueOn), showMiles(stored?.tiresDueMiles)]);
    const tires = item(
      "tires",
      "Tires",
      tireLast,
      tireDue,
      serviceBadge({
        today: input.today,
        dueOn: stored?.tiresDueOn,
        dueMiles: stored?.tiresDueMiles,
        currentMiles: vehicle.currentMiles,
      }),
    );

    const registrationDue = showDate(vehicle.registrationExpiresOn);
    const inspectionDue = showDate(stored?.inspectionDueOn);
    const registrationLast = showDate(latestDate(expensesFor(input.expenses, vehicle.id, "registration").map((row) => row.incurredOn)));
    const registration = item(
      "registration_inspection",
      "Registration / Inspection",
      registrationLast ? `Registration ${registrationLast} · Inspection Unknown` : UNKNOWN,
      `Registration ${registrationDue ?? UNKNOWN} · Inspection ${inspectionDue ?? UNKNOWN}`,
      combineBadges([
        badgeFromDate(input.today, vehicle.registrationExpiresOn),
        badgeFromDate(input.today, stored?.inspectionDueOn),
      ]),
    );

    const insuranceLast = showDate(latestDate(expensesFor(input.expenses, vehicle.id, "insurance").map((row) => row.incurredOn)));
    const insuranceDue = showDate(vehicle.insuranceExpiresOn);
    const insurance = item(
      "insurance",
      "Insurance",
      insuranceLast ?? UNKNOWN,
      insuranceDue ?? UNKNOWN,
      badgeFromDate(input.today, vehicle.insuranceExpiresOn),
    );

    return {
      vehicleId: vehicle.id,
      unitNumber: vehicle.unitNumber,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      plate: vehicle.plate,
      status: vehicle.status,
      bodyType: vehicle.bodyType,
      partnerId: vehicle.partnerId,
      currentMiles: current ?? UNKNOWN,
      items: [oil, tires, registration, insurance],
    };
  });
}

export function vehicleUrgency(items: { badge: DueBadge }[]): number {
  const rank: Record<DueBadge, number> = { overdue: 0, due_14: 1, unknown: 2, ok: 3 };
  return items.reduce((best, entry) => Math.min(best, rank[entry.badge]), 3);
}
