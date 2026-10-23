import { decimalSourceCents } from "./unified-finance-live-mapping";

/** Eastern calendar used for toll age and rental windows. Date-only values are not shifted. */
export const TOLLS_TIME_ZONE = "America/New_York";

const BILLED = new Set(["pending", "paid", "succeeded", "processing"]);
const NOT_A_BILL = new Set(["void", "cancelled", "canceled", "waived", "refunded", "failed", "written_off"]);
/** Statuses the report skips. The toll read uses the same list so those rows do not fill the page cap. */
export const SKIP_TOLL_STATUSES = ["written_off", "disputed"] as const;
const SKIP_TOLL = new Set<string>(SKIP_TOLL_STATUSES);
/** PostgREST `or` filter. Null status stays; written_off and disputed do not. */
export const UNBILLED_TOLL_STATUS_FILTER = `status.is.null,status.not.in.(${SKIP_TOLL_STATUSES.join(",")})`;

export const NOTE_AMBIGUOUS = "An Ambiguous Rental Match Withholds The Total";
export const NOTE_AMOUNT = "An Unreadable Amount Withholds The Total";
export const NOTE_CHARGE = "An Unresolved Charge Withholds The Total";
export const NOTE_TRUNCATED = "This Read Is Truncated";
export const NOTE_DUPLICATE = "Duplicate Records Withhold The Total";

export type TollInput = {
  id: string;
  vehicleId: string;
  rentalId: string | null;
  occurredAt: string | null;
  amount: string | number | null;
  adminFee: string | number | null;
  status: string | null;
  paymentId: string | null;
};

export type RentalInput = {
  id: string;
  vehicleId: string;
  driverId: string;
  applicationId: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type PaymentInput = {
  id: string;
  driverId: string | null;
  status: string | null;
};

export type DeductionInput = {
  id: string;
  rentalId: string | null;
  tollChargeId: string | null;
};

export type VehicleInput = {
  id: string;
  year: number | string | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
};

export type DriverInput = {
  id: string;
  fullName: string | null;
};

export type UnbilledCaps = {
  tolls: boolean;
  rentals: boolean;
  payments: boolean;
  deductions: boolean;
  vehicles: boolean;
  drivers: boolean;
};

export type UnbilledLoad = {
  tolls: TollInput[];
  rentals: RentalInput[];
  payments: PaymentInput[];
  deductions: DeductionInput[];
  vehicles: VehicleInput[];
  drivers: DriverInput[];
  caps: UnbilledCaps;
};

export type UnbilledTollRow = {
  tollId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string | null;
  rentalId: string | null;
  occurredOn: string | null;
  ageDays: number | null;
  cents: number | null;
  ambiguous: boolean;
};

export type UnbilledTollsReport = {
  asOf: string;
  rows: UnbilledTollRow[];
  totalCents: number | null;
  truncated: boolean;
  notes: string[];
};

export type UnbilledTollsResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: UnbilledTollsReport };

export function easternToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOLLS_TIME_ZONE,
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

/** YYYY-MM-DD stays as written. A zoned timestamp becomes its Eastern calendar day. */
export function easternDay(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  const day = easternToday(new Date(ms));
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function calendarAge(fromDay: string | null, asOf: string): number | null {
  if (!fromDay || !/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000;
  if (!Number.isInteger(days) || days < 0) return null;
  return days;
}

export function formatUnbilledAge(days: number | null): string {
  if (days == null) return "Unknown";
  if (days === 0) return "Today";
  if (days === 1) return "1 Day";
  return `${days} Days`;
}

export function formatUnbilledMoney(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function duplicateIds(rows: { id: string }[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) return true;
    seen.add(row.id);
  }
  return false;
}

function tollCents(amount: string | number | null, adminFee: string | number | null): number | null {
  if (amount == null || amount === "") return null;
  const base = decimalSourceCents(amount);
  if (base == null) return null;
  const fee = adminFee == null || adminFee === "" ? 0 : decimalSourceCents(adminFee);
  if (fee == null) return null;
  const sum = base + fee;
  return Number.isSafeInteger(sum) ? sum : null;
}

function covers(rental: RentalInput, day: string): boolean {
  const start = easternDay(rental.startDate);
  if (!start) return false;
  const rawEnd = rental.endDate == null ? "" : String(rental.endDate).trim();
  const end = rawEnd ? easternDay(rawEnd) : null;
  if (rawEnd && !end) return false;
  if (day < start) return false;
  if (end && day > end) return false;
  return true;
}

function vehicleLabel(vehicle: VehicleInput | undefined): string {
  if (!vehicle) return "Vehicle";
  const parts = [vehicle.year, vehicle.make, vehicle.model]
    .filter((part) => part != null && String(part).trim() !== "")
    .map((part) => String(part).trim());
  const plate = vehicle.licensePlate?.trim() ?? "";
  const name = parts.join(" ");
  if (name && plate) return `${name} · ${plate}`;
  return name || plate || "Vehicle";
}

function driverName(drivers: Map<string, DriverInput>, id: string): string {
  const name = drivers.get(id)?.fullName?.trim();
  return name || "Driver";
}

function paymentVerdict(
  payment: PaymentInput | undefined,
  rental: RentalInput,
  paymentsComplete: boolean,
): "match" | "none" | "unresolved" {
  if (!payment) return paymentsComplete ? "none" : "unresolved";
  const driver = payment.driverId?.trim() ?? "";
  const applicationId = rental.applicationId?.trim() ?? "";
  const driverOk = driver !== "" && (driver === rental.driverId || (applicationId !== "" && driver === applicationId));
  if (!driverOk) return "none";
  const status = norm(payment.status);
  if (BILLED.has(status)) return "match";
  if (NOT_A_BILL.has(status)) return "none";
  return "unresolved";
}

export function buildUnbilledTolls(input: UnbilledLoad, now = new Date()): UnbilledTollsReport {
  const asOf = easternToday(now);
  const caps = input.caps;
  const truncated = caps.tolls || caps.rentals || caps.payments || caps.deductions || caps.vehicles || caps.drivers;
  const notes: string[] = [];
  if (duplicateIds(input.tolls) || duplicateIds(input.rentals)) {
    notes.push(NOTE_DUPLICATE);
    if (truncated) notes.push(NOTE_TRUNCATED);
    return { asOf, rows: [], totalCents: null, truncated, notes };
  }

  const active = input.rentals.filter((rental) => norm(rental.status) === "active" && rental.vehicleId);
  const payments = new Map(input.payments.filter((payment) => payment.id).map((payment) => [payment.id, payment]));
  const deducted = new Set(
    input.deductions
      .filter((row) => row.tollChargeId && row.rentalId)
      .map((row) => `${row.tollChargeId}|${row.rentalId}`),
  );
  const vehicles = new Map(input.vehicles.filter((vehicle) => vehicle.id).map((vehicle) => [vehicle.id, vehicle]));
  const drivers = new Map(input.drivers.filter((driver) => driver.id).map((driver) => [driver.id, driver]));
  const classificationBlocked = caps.rentals || caps.payments || caps.deductions;
  const rows: UnbilledTollRow[] = [];
  let sawAmbiguous = false;
  let sawAmount = false;
  let sawCharge = false;

  for (const toll of input.tolls) {
    if (SKIP_TOLL.has(norm(toll.status))) continue;
    const onVehicle = active.filter((rental) => rental.vehicleId === toll.vehicleId);
    const day = easternDay(toll.occurredAt);
    const base = {
      tollId: toll.id,
      vehicleId: toll.vehicleId,
      vehicleLabel: vehicleLabel(vehicles.get(toll.vehicleId)),
      occurredOn: day,
      ageDays: calendarAge(day, asOf),
    };

    if (!day || (classificationBlocked && caps.rentals)) {
      if (!day && !caps.rentals && onVehicle.length === 0) continue;
      if (!day || caps.rentals) {
        sawAmbiguous = true;
        rows.push({ ...base, driverLabel: null, rentalId: null, cents: null, ambiguous: true });
        continue;
      }
    }

    const covered = day ? onVehicle.filter((rental) => covers(rental, day)) : [];
    if (!caps.rentals && covered.length === 0) continue;
    const stamp = toll.rentalId?.trim() || null;
    const ambiguous = caps.rentals || covered.length !== 1 || (stamp != null && stamp !== covered[0]?.id);
    if (ambiguous) {
      sawAmbiguous = true;
      rows.push({ ...base, driverLabel: null, rentalId: null, cents: null, ambiguous: true });
      continue;
    }

    const rental = covered[0]!;
    const driverLabel = driverName(drivers, rental.driverId);
    if (classificationBlocked) {
      sawCharge = true;
      rows.push({ ...base, driverLabel, rentalId: rental.id, cents: null, ambiguous: false });
      continue;
    }

    const paymentId = toll.paymentId?.trim() || null;
    const deductedThis = deducted.has(`${toll.id}|${rental.id}`);
    const verdict = paymentId ? paymentVerdict(payments.get(paymentId), rental, !caps.payments) : "none";
    if (deductedThis || verdict === "match") continue;
    if (verdict === "unresolved") {
      sawCharge = true;
      rows.push({ ...base, driverLabel, rentalId: rental.id, cents: null, ambiguous: false });
      continue;
    }

    const cents = tollCents(toll.amount, toll.adminFee);
    if (cents == null) sawAmount = true;
    rows.push({ ...base, driverLabel, rentalId: rental.id, cents, ambiguous: false });
  }

  rows.sort((a, b) => {
    const ageA = a.ageDays ?? -1;
    const ageB = b.ageDays ?? -1;
    if (ageA !== ageB) return ageB - ageA;
    return a.tollId < b.tollId ? -1 : a.tollId > b.tollId ? 1 : 0;
  });

  if (sawAmbiguous) notes.push(NOTE_AMBIGUOUS);
  if (sawAmount) notes.push(NOTE_AMOUNT);
  if (sawCharge) notes.push(NOTE_CHARGE);
  if (truncated) notes.push(NOTE_TRUNCATED);

  const unknownMoney = rows.some((row) => row.ambiguous || row.cents == null);
  let totalCents: number | null = null;
  if (!caps.tolls && !unknownMoney) {
    let sum = 0;
    for (const row of rows) sum += row.cents ?? 0;
    totalCents = Number.isSafeInteger(sum) ? sum : null;
  }

  return { asOf, rows, totalCents, truncated, notes };
}
