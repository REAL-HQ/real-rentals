/**
 * Read-only service history and reminders. Nothing here writes.
 *
 * What already handles maintenance and incidents, left in place:
 *
 * Service writes go through src/lib/maintenance.server.ts.
 * addOdometerReading (line 46) inserts one odometer_readings row.
 * recordServiceEvent (line 62) inserts maintenance_records, one
 * vehicle_expenses row for the net paid (line 116), at most one mileage
 * reading (line 125), and rolls a matching maintenance_schedules row
 * forward (lines 139-143). src/lib/maintenance.functions.ts is the API:
 * getVehicleService (line 64) reads a car, addServiceEvent (line 142) calls
 * recordServiceEvent, and getFleetMaintenance (line 324) is what Overview's
 * Service card counts (OverviewPanel.tsx line 205, card at line 551).
 * MaintenancePanel.computeDueReasons (line 42) is a separate client read:
 * oil uses oil_interval_miles or 5000 (line 46), tires at 12 months
 * (line 53), brakes at 12 months (line 57). That panel still updates
 * maintenance_records.status (line 113) and vehicles.current_odometer
 * (line 127) from the browser. src/routes/api/public/cron/ops-reminders.ts
 * (line 119) emails a digest: oil from the stored interval (line 136),
 * tires at 6 months (line 138), brakes at 12 months (line 139).
 *
 * Incidents live in src/lib/incidents.functions.ts. assertStaff (line 19)
 * is requireManager. listIncidents (line 64), saveIncident (line 118) and
 * deleteIncident (line 228) all use it. saveIncident enrolls
 * incident_logged only when RENTER_LIFECYCLE_NOTICES_ENABLED is true
 * (line 216). getVehicleTimeline reads incidents (maintenance.functions.ts
 * line 378). This log does not write an incident and does not change
 * those functions.
 *
 * This view reads the columns those paths already store. A missing oil
 * interval stays unknown. It does not copy the panel's 5000-mile default.
 * Tires and brakes use the staff panel's 12-month mark, then a 14-day
 * due-soon window. The cron's 6-month tire line is a different sender and
 * is not changed here. Registration and insurance use the expiry dates on
 * the vehicle. Inspection checklists are history. An inspection expiry
 * exists only when proposed/maintenance-log-v1.sql has been installed.
 */
import { normalizeCategory } from "@/lib/maintenance-rules";

export const MAINTENANCE_LOG_KINDS = [
  { id: "oil", label: "Oil" },
  { id: "tires", label: "Tires" },
  { id: "brakes", label: "Brakes" },
  { id: "inspection", label: "Inspection" },
  { id: "registration", label: "Registration" },
  { id: "insurance", label: "Insurance" },
] as const;

export type MaintenanceLogKind = (typeof MAINTENANCE_LOG_KINDS)[number]["id"];
export type LogState = "overdue" | "due_soon" | "ok" | "unknown";
export type LogAttention = "overdue" | "due_soon";

/** Same windows as dueStatus in maintenance-rules.ts. */
export const OIL_DUE_SOON_MILES = 500;
export const DATE_DUE_SOON_DAYS = 14;
/** Staff Service panel: tires and brakes at 12 months. The ops digest uses 6 months for tires. */
export const TIRE_INTERVAL_MONTHS = 12;
export const BRAKE_INTERVAL_MONTHS = 12;

const KIND_LABEL: Record<MaintenanceLogKind, string> = {
  oil: "Oil",
  tires: "Tires",
  brakes: "Brakes",
  inspection: "Inspection",
  registration: "Registration",
  insurance: "Insurance",
};

export type HistoryLine = {
  id: string;
  on: string | null;
  label: string;
  miles: number | null;
};

export type LogItem = {
  kind: MaintenanceLogKind;
  label: string;
  state: LogState;
  reason: string;
  dueOn: string | null;
  dueMiles: number | null;
  history: HistoryLine[];
};

export type VehicleLog = {
  vehicleId: string;
  unitNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  items: LogItem[];
  attention: LogAttention | null;
};

export type MaintenanceLogResult = {
  today: string;
  vehicles: VehicleLog[];
  counts: { overdue: number; dueSoon: number };
  inspectionExpiryInstalled: boolean;
};

export type VehicleLogSource = {
  id: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  current_odometer: unknown;
  last_oil_change_miles: unknown;
  oil_interval_miles: unknown;
  last_tire_date: unknown;
  last_brake_inspection_date: unknown;
  registration_expires_on: unknown;
  insurance_expires_on: unknown;
};

export type ServiceHistorySource = {
  id: string;
  vehicle_id: string;
  item: string | null;
  category: string | null;
  performed_on: string | null;
  odometer: unknown;
  status: string | null;
};

export type InspectionHistorySource = {
  id: string;
  vehicle_id: string;
  inspection_type: string | null;
  status: string | null;
  completed_at: string | null;
  created_at: string | null;
  odometer: unknown;
};

export type InspectionDueSource = {
  vehicle_id: string;
  inspection_due_on: unknown;
};

export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1];
}

export function parseMiles(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

export function businessToday(now = new Date()): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseIsoDate(formatted) ?? formatted;
}

export function addCalendarDays(iso: string, days: number): string | null {
  const parsed = parseIsoDate(iso);
  if (!parsed || !Number.isInteger(days)) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addCalendarMonths(iso: string, months: number): string | null {
  const parsed = parseIsoDate(iso);
  if (!parsed || !Number.isInteger(months)) return null;
  const [year, month, day] = parsed.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  cursor.setUTCDate(Math.min(day, last));
  return cursor.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
}

const fmt = (n: number) => n.toLocaleString("en-US");

function dateReminder(today: string, dueOn: string | null, missing: string): { state: LogState; reason: string; dueOn: string | null } {
  if (!dueOn) return { state: "unknown", reason: missing, dueOn: null };
  const left = daysBetween(today, dueOn);
  if (left < 0) return { state: "overdue", reason: `Overdue By ${fmt(-left)} Days`, dueOn };
  if (left === 0) return { state: "overdue", reason: "Due Today", dueOn };
  if (left <= DATE_DUE_SOON_DAYS) return { state: "due_soon", reason: `Due In ${fmt(left)} Days`, dueOn };
  return { state: "ok", reason: `Due In ${fmt(left)} Days`, dueOn };
}

function oilReminder(vehicle: VehicleLogSource): Pick<LogItem, "state" | "reason" | "dueOn" | "dueMiles"> {
  const current = parseMiles(vehicle.current_odometer);
  const last = parseMiles(vehicle.last_oil_change_miles);
  const interval = parseMiles(vehicle.oil_interval_miles);
  if (interval == null || interval <= 0) return { state: "unknown", reason: "No Interval On Record", dueOn: null, dueMiles: null };
  if (last == null || current == null) return { state: "unknown", reason: "No Mileage On Record", dueOn: null, dueMiles: null };
  const dueMiles = last + interval;
  const left = dueMiles - current;
  if (left <= 0) return { state: "overdue", reason: left === 0 ? "Due Now" : `Overdue By ${fmt(-left)} Miles`, dueOn: null, dueMiles };
  if (left <= OIL_DUE_SOON_MILES) return { state: "due_soon", reason: `Due In ${fmt(left)} Miles`, dueOn: null, dueMiles };
  return { state: "ok", reason: `Due In ${fmt(left)} Miles`, dueOn: null, dueMiles };
}

function serviceKind(row: ServiceHistorySource): MaintenanceLogKind | null {
  const category = normalizeCategory(row.category);
  const item = normalizeCategory(row.item);
  const hit = category !== "other" ? category : item;
  if (hit === "oil_change") return "oil";
  if (hit === "tire_replacement" || hit === "tire_rotation") return "tires";
  if (hit === "brakes") return "brakes";
  if (hit === "inspection") return "inspection";
  return null;
}

function byDateDesc(a: HistoryLine, b: HistoryLine): number {
  const left = a.on ?? "";
  const right = b.on ?? "";
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function attentionOf(items: LogItem[]): LogAttention | null {
  if (items.some((item) => item.state === "overdue")) return "overdue";
  if (items.some((item) => item.state === "due_soon")) return "due_soon";
  return null;
}

export function buildMaintenanceLog(input: {
  today: string;
  vehicles: VehicleLogSource[];
  services: ServiceHistorySource[];
  inspections: InspectionHistorySource[];
  inspectionDue: InspectionDueSource[];
  inspectionExpiryInstalled: boolean;
}): MaintenanceLogResult {
  const services = new Map<string, ServiceHistorySource[]>();
  for (const row of input.services) {
    const list = services.get(row.vehicle_id) ?? [];
    list.push(row);
    services.set(row.vehicle_id, list);
  }
  const inspections = new Map<string, InspectionHistorySource[]>();
  for (const row of input.inspections) {
    const list = inspections.get(row.vehicle_id) ?? [];
    list.push(row);
    inspections.set(row.vehicle_id, list);
  }
  const inspectionDue = new Map(input.inspectionDue.map((row) => [row.vehicle_id, parseIsoDate(row.inspection_due_on)]));

  const vehicles = input.vehicles.map((vehicle) => {
    const rows = services.get(vehicle.id) ?? [];
    const historyFor = (kind: MaintenanceLogKind): HistoryLine[] =>
      rows
        .filter((row) => serviceKind(row) === kind)
        .map((row) => ({
          id: row.id,
          on: parseIsoDate(row.performed_on),
          label: (row.item ?? KIND_LABEL[kind]).trim() || KIND_LABEL[kind],
          miles: parseMiles(row.odometer),
        }))
        .sort(byDateDesc);

    const oilHistory = historyFor("oil");
    const lastOil = parseMiles(vehicle.last_oil_change_miles);
    if (lastOil != null) oilHistory.push({ id: `vehicle-oil-${vehicle.id}`, on: null, label: "Recorded On The Vehicle", miles: lastOil });
    oilHistory.sort(byDateDesc);

    const tireHistory = historyFor("tires");
    const lastTire = parseIsoDate(vehicle.last_tire_date);
    if (lastTire) tireHistory.push({ id: `vehicle-tires-${vehicle.id}`, on: lastTire, label: "Recorded On The Vehicle", miles: null });
    tireHistory.sort(byDateDesc);

    const brakeHistory = historyFor("brakes");
    const lastBrake = parseIsoDate(vehicle.last_brake_inspection_date);
    if (lastBrake) brakeHistory.push({ id: `vehicle-brakes-${vehicle.id}`, on: lastBrake, label: "Recorded On The Vehicle", miles: null });
    brakeHistory.sort(byDateDesc);

    const inspectionHistory = (inspections.get(vehicle.id) ?? [])
      .map((row) => ({
        id: row.id,
        on: parseIsoDate(row.completed_at) ?? parseIsoDate(row.created_at),
        label: [row.inspection_type, row.status].filter(Boolean).join(" · ") || "Inspection",
        miles: parseMiles(row.odometer),
      }))
      .sort(byDateDesc);
    inspectionHistory.push(...historyFor("inspection"));
    inspectionHistory.sort(byDateDesc);

    const oil = oilReminder(vehicle);
    const tires = dateReminder(input.today, lastTire ? addCalendarMonths(lastTire, TIRE_INTERVAL_MONTHS) : null, "No Date On Record");
    const brakes = dateReminder(input.today, lastBrake ? addCalendarMonths(lastBrake, BRAKE_INTERVAL_MONTHS) : null, "No Date On Record");
    const inspection = dateReminder(input.today, inspectionDue.get(vehicle.id) ?? null, "No Expiry On Record");
    const registrationDue = parseIsoDate(vehicle.registration_expires_on);
    const insuranceDue = parseIsoDate(vehicle.insurance_expires_on);
    const registration = dateReminder(input.today, registrationDue, "No Expiry On Record");
    const insurance = dateReminder(input.today, insuranceDue, "No Expiry On Record");

    const items: LogItem[] = [
      { kind: "oil", label: "Oil", ...oil, history: oilHistory },
      { kind: "tires", label: "Tires", ...tires, dueMiles: null, history: tireHistory },
      { kind: "brakes", label: "Brakes", ...brakes, dueMiles: null, history: brakeHistory },
      { kind: "inspection", label: "Inspection", ...inspection, dueMiles: null, history: inspectionHistory },
      {
        kind: "registration",
        label: "Registration",
        ...registration,
        dueMiles: null,
        history: registrationDue ? [{ id: `registration-${vehicle.id}`, on: registrationDue, label: "Registration Expires", miles: null }] : [],
      },
      {
        kind: "insurance",
        label: "Insurance",
        ...insurance,
        dueMiles: null,
        history: insuranceDue ? [{ id: `insurance-${vehicle.id}`, on: insuranceDue, label: "Insurance Expires", miles: null }] : [],
      },
    ];

    return {
      vehicleId: vehicle.id,
      unitNumber: vehicle.unit_number,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      items,
      attention: attentionOf(items),
    };
  });

  return {
    today: input.today,
    vehicles,
    counts: {
      overdue: vehicles.filter((vehicle) => vehicle.attention === "overdue").length,
      dueSoon: vehicles.filter((vehicle) => vehicle.attention === "due_soon").length,
    },
    inspectionExpiryInstalled: input.inspectionExpiryInstalled,
  };
}

export type RelationReadError = { code?: string; message?: string };

/**
 * A missing proposed table is Postgres undefined_table (42P01) or PostgREST
 * PGRST205. The server sentence is `relation "public.maintenance_log_v1" does
 * not exist`, which does not contain the contiguous phrase the old check used.
 */
export function maintenanceLogRelationMissing(error: RelationReadError): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

/** Rows from one page, or "missing" when the proposed relation is not installed. */
export function takeOptionalRelationPage(
  error: RelationReadError | null,
  data: unknown[] | null,
): "missing" | unknown[] {
  if (!error) return data ?? [];
  if (maintenanceLogRelationMissing(error)) return "missing";
  throw new Error("Could not load the maintenance log.");
}

export function reminderBadges(vehicles: VehicleLog[]): Record<string, LogAttention> {
  const badges: Record<string, LogAttention> = {};
  for (const vehicle of vehicles) {
    if (vehicle.attention) badges[vehicle.vehicleId] = vehicle.attention;
  }
  return badges;
}
