/**
 * Mileage log, next oil service, and monthly inspection.
 *
 * Pure shapes and checks. Writes go through src/lib/maintenance.server.ts
 * (odometer_readings via addOdometerReading, maintenance_schedules, and
 * maintenance_records). Nothing here sends a text or email.
 *
 * A vehicle shown to staff or FLEET is plate and the last 6 of the VIN.
 * The unit number is never part of this view.
 */
import { vinLast6 } from "@/lib/vehicle-label";
import { SOURCE_LABELS } from "@/lib/maintenance-rules";

export const OIL_ITEM = "Oil Change";
export const MONTHLY_ITEM = "Monthly Inspection";
export const MONTHLY_INTERVAL_DAYS = 30;
export const DEFAULT_OIL_INTERVAL_MILES = 5000;
/** Same ceiling as the vehicle-docs bucket (20 MB). */
export const MAINTENANCE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const MILEAGE_LOG_LIMIT = 100;
export const INSPECTION_HISTORY_LIMIT = 50;
export const MILEAGE_MAX = 1_999_999;

export const FLEET_VEHICLE_MAINTENANCE_KEY = "fleet_vehicle_maintenance";

export const MILEAGE_SOURCE_TYPES = ["manual", "odometer_photo", "inspection", "other"] as const;
export type MileageSourceType = (typeof MILEAGE_SOURCE_TYPES)[number];

export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return match[1];
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

export function parseMiles(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MILEAGE_MAX)
    return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isInteger(n) && n >= 0 && n <= MILEAGE_MAX) return n;
  }
  return null;
}

export function isOilItem(item: unknown): boolean {
  return (
    String(item ?? "")
      .trim()
      .toLowerCase() === OIL_ITEM.toLowerCase()
  );
}

export function isMonthlyItem(item: unknown): boolean {
  return (
    String(item ?? "")
      .trim()
      .toLowerCase() === MONTHLY_ITEM.toLowerCase()
  );
}

export function normalizePlate(value: unknown): string | null {
  const plate = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (plate.length < 2 || plate.length > 12) return null;
  return plate;
}

/** JPEG, PNG, WebP, or HEIC from the file bytes. PDF and a claimed type are refused. */
export function sniffMaintenancePhoto(b: Uint8Array): { mime: string; ext: string } | null {
  const at = (i: number, s: string) => [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n"))
    return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp" };
  if (b.length >= 12 && at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand))
      return { mime: "image/heic", ext: "heic" };
  }
  return null;
}

export function mileageSourceLabel(
  sourceType: string | null | undefined,
  evidenceKey: string | null | undefined,
): string {
  const label =
    SOURCE_LABELS[sourceType ?? ""] ??
    (sourceType
      ? sourceType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
      : "Manual");
  return String(evidenceKey ?? "").startsWith("fleet:") ? `FLEET · ${label}` : label;
}

export type ScheduleRow = {
  id: string;
  item: string;
  interval_miles?: number | null;
  interval_days?: number | null;
  last_done_on?: string | null;
  last_done_miles?: number | null;
  next_due_on?: string | null;
  next_due_miles?: number | null;
  notes?: string | null;
  is_active?: boolean | null;
};

export type ReadingRow = {
  id: string;
  mileage: unknown;
  observed_on: unknown;
  source_type?: string | null;
  note?: string | null;
  status?: string | null;
  document_id?: string | null;
  evidence_key?: string | null;
};

export type InspectionRecordRow = {
  id: string;
  item?: string | null;
  schedule_id?: string | null;
  performed_on?: string | null;
  odometer?: unknown;
  notes?: string | null;
  document_id?: string | null;
  status?: string | null;
  source?: string | null;
};

export type VehicleMaintenanceView = {
  vehicle: {
    id: string;
    license_plate: string | null;
    vin_last6: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    current_odometer: number | null;
    odometer_updated_at: string | null;
  };
  mileage_log: Array<{
    id: string;
    observed_on: string | null;
    mileage: number | null;
    source_type: string;
    source_label: string;
    note: string | null;
    status: string;
    document_id: string | null;
    has_photo: boolean;
  }>;
  mileage_log_truncated: boolean;
  next_service_due: {
    item: "Oil Change";
    schedule_id: string | null;
    next_due_miles: number | null;
    next_due_on: string | null;
    interval_miles: number | null;
    last_done_on: string | null;
    last_done_miles: number | null;
    notes: string | null;
  };
  monthly_inspection: {
    item: "Monthly Inspection";
    schedule_id: string | null;
    interval_days: number;
    last_done_on: string | null;
    next_due_on: string | null;
    notes: string | null;
    history: Array<{
      id: string;
      performed_on: string | null;
      odometer: number | null;
      notes: string | null;
      document_id: string | null;
      has_photo: boolean;
      source: string | null;
    }>;
    history_truncated: boolean;
  };
};

type RawVehicle = {
  id: string;
  license_plate?: string | null;
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  current_odometer?: unknown;
  odometer_updated_at?: string | null;
  unit_number?: string | null;
};

/** The response never includes unit_number or the full VIN. */
export function shapeVehicleMaintenance(input: {
  vehicle: RawVehicle;
  schedules: ScheduleRow[];
  readings: ReadingRow[];
  records: InspectionRecordRow[];
}): VehicleMaintenanceView {
  const oil = input.schedules.find((row) => row.is_active !== false && isOilItem(row.item)) ?? null;
  const monthly =
    input.schedules.find((row) => row.is_active !== false && isMonthlyItem(row.item)) ?? null;
  const readings = input.readings.slice(0, MILEAGE_LOG_LIMIT);
  const historyAll = input.records.filter(
    (row) => row.schedule_id === monthly?.id || isMonthlyItem(row.item),
  );
  const history = historyAll.slice(0, INSPECTION_HISTORY_LIMIT);
  return {
    vehicle: {
      id: input.vehicle.id,
      license_plate: input.vehicle.license_plate
        ? String(input.vehicle.license_plate).toUpperCase()
        : null,
      vin_last6: vinLast6(input.vehicle.vin) || null,
      year: input.vehicle.year ?? null,
      make: input.vehicle.make ?? null,
      model: input.vehicle.model ?? null,
      current_odometer: parseMiles(input.vehicle.current_odometer),
      odometer_updated_at: input.vehicle.odometer_updated_at ?? null,
    },
    mileage_log: readings.map((row) => ({
      id: row.id,
      observed_on: parseIsoDate(row.observed_on),
      mileage: parseMiles(row.mileage),
      source_type: row.source_type || "manual",
      source_label: mileageSourceLabel(row.source_type, row.evidence_key),
      note: row.note ?? null,
      status: row.status || "valid",
      document_id: row.document_id ?? null,
      has_photo: Boolean(row.document_id),
    })),
    mileage_log_truncated: input.readings.length > MILEAGE_LOG_LIMIT,
    next_service_due: {
      item: "Oil Change",
      schedule_id: oil?.id ?? null,
      next_due_miles: parseMiles(oil?.next_due_miles),
      next_due_on: parseIsoDate(oil?.next_due_on),
      interval_miles: parseMiles(oil?.interval_miles),
      last_done_on: parseIsoDate(oil?.last_done_on),
      last_done_miles: parseMiles(oil?.last_done_miles),
      notes: oil?.notes ?? null,
    },
    monthly_inspection: {
      item: "Monthly Inspection",
      schedule_id: monthly?.id ?? null,
      interval_days: MONTHLY_INTERVAL_DAYS,
      last_done_on: parseIsoDate(monthly?.last_done_on),
      next_due_on: parseIsoDate(monthly?.next_due_on),
      notes: monthly?.notes ?? null,
      history: history.map((row) => ({
        id: row.id,
        performed_on: parseIsoDate(row.performed_on),
        odometer: parseMiles(row.odometer),
        notes: row.notes ?? null,
        document_id: row.document_id ?? null,
        has_photo: Boolean(row.document_id),
        source: row.source ?? null,
      })),
      history_truncated: historyAll.length > INSPECTION_HISTORY_LIMIT,
    },
  };
}

export type FieldError = { ok: false; status: number; error: string };
export type Parsed<T> = { ok: true; value: T } | FieldError;

function fail(status: number, error: string): FieldError {
  return { ok: false, status, error };
}

export function parseOptionalDate(
  value: unknown,
  label: string,
): Parsed<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  const date = parseIsoDate(value);
  if (!date) return fail(400, `${label} must be a date in YYYY-MM-DD.`);
  return { ok: true, value: date };
}

export function parseOptionalMiles(
  value: unknown,
  label: string,
): Parsed<number | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  const miles = parseMiles(value);
  if (miles == null)
    return fail(
      400,
      `${label} must be a whole number of miles from 0 to ${MILEAGE_MAX.toLocaleString("en-US")}.`,
    );
  return { ok: true, value: miles };
}

export function parseOptionalNote(value: unknown, max: number): Parsed<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  const note = String(value).replace(/\s+/g, " ").trim();
  if (note.length > max) return fail(400, `notes must be ${max} characters or fewer.`);
  return { ok: true, value: note || null };
}

export type MileageWrite = {
  observedOn: string;
  mileage: number;
  note: string | null;
  sourceType: MileageSourceType;
  hasPhoto: boolean;
};

export function parseMileageWrite(
  body: Record<string, unknown>,
  today: string,
): Parsed<MileageWrite> {
  const observedOn = parseIsoDate(body.observed_on);
  if (!observedOn) return fail(400, "observed_on must be a date in YYYY-MM-DD.");
  if (observedOn > today) return fail(400, "observed_on cannot be in the future.");
  const mileage = parseMiles(body.mileage);
  if (mileage == null)
    return fail(
      400,
      `mileage must be a whole number from 0 to ${MILEAGE_MAX.toLocaleString("en-US")}.`,
    );
  const note = parseOptionalNote(body.note, 500);
  if (!note.ok) return note;
  const hasPhoto = body.content_base64 != null && body.content_base64 !== "";
  let sourceType: MileageSourceType = hasPhoto ? "odometer_photo" : "manual";
  if (body.source_type != null && body.source_type !== "") {
    const raw = String(body.source_type);
    if (!(MILEAGE_SOURCE_TYPES as readonly string[]).includes(raw)) {
      return fail(400, `source_type must be one of: ${MILEAGE_SOURCE_TYPES.join(", ")}.`);
    }
    sourceType = raw as MileageSourceType;
  }
  if (hasPhoto && sourceType === "manual") sourceType = "odometer_photo";
  if (!hasPhoto && sourceType === "odometer_photo")
    return fail(400, "source_type odometer_photo needs a photo (content_base64).");
  return {
    ok: true,
    value: { observedOn, mileage, note: note.value ?? null, sourceType, hasPhoto },
  };
}

export type ServiceDueWrite = {
  nextDueMiles: number | null | undefined;
  nextDueOn: string | null | undefined;
  notes: string | null | undefined;
  intervalMiles: number | null | undefined;
};

export function parseServiceDueWrite(body: Record<string, unknown>): Parsed<ServiceDueWrite> {
  const nextDueMiles = parseOptionalMiles(body.next_due_miles, "next_due_miles");
  if (!nextDueMiles.ok) return nextDueMiles;
  const nextDueOn = parseOptionalDate(body.next_due_on, "next_due_on");
  if (!nextDueOn.ok) return nextDueOn;
  const notes = parseOptionalNote(body.notes, 2000);
  if (!notes.ok) return notes;
  const intervalMiles = parseOptionalMiles(body.interval_miles, "interval_miles");
  if (!intervalMiles.ok) return intervalMiles;
  if (intervalMiles.value != null && intervalMiles.value <= 0)
    return fail(400, "interval_miles must be at least 1.");
  if (nextDueMiles.value === undefined && nextDueOn.value === undefined) {
    return fail(400, "Send next_due_miles, next_due_on, or both.");
  }
  return {
    ok: true,
    value: {
      nextDueMiles: nextDueMiles.value,
      nextDueOn: nextDueOn.value,
      notes: notes.value,
      intervalMiles: intervalMiles.value,
    },
  };
}

export type MonthlyWrite = {
  lastDoneOn: string | null | undefined;
  nextDueOn: string | null | undefined;
  notes: string | null | undefined;
  odometer: number | null | undefined;
  hasPhoto: boolean;
};

export function parseMonthlyWrite(
  body: Record<string, unknown>,
  today: string,
): Parsed<MonthlyWrite> {
  const lastDoneOn = parseOptionalDate(body.last_done_on, "last_done_on");
  if (!lastDoneOn.ok) return lastDoneOn;
  const nextDueOn = parseOptionalDate(body.next_due_on, "next_due_on");
  if (!nextDueOn.ok) return nextDueOn;
  const notes = parseOptionalNote(body.notes, 2000);
  if (!notes.ok) return notes;
  const odometer = parseOptionalMiles(body.odometer, "odometer");
  if (!odometer.ok) return odometer;
  const hasPhoto = body.content_base64 != null && body.content_base64 !== "";
  if (lastDoneOn.value && lastDoneOn.value > today)
    return fail(400, "last_done_on cannot be in the future.");
  if ((hasPhoto || odometer.value != null) && !lastDoneOn.value) {
    return fail(400, "A photo or odometer is saved with last_done_on.");
  }
  if (
    lastDoneOn.value === undefined &&
    nextDueOn.value === undefined &&
    notes.value === undefined &&
    !hasPhoto
  ) {
    return fail(400, "Send last_done_on, next_due_on, notes, or a photo.");
  }
  return {
    ok: true,
    value: {
      lastDoneOn: lastDoneOn.value,
      nextDueOn: nextDueOn.value,
      notes: notes.value,
      odometer: odometer.value,
      hasPhoto,
    },
  };
}
