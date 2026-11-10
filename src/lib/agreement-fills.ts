// Staff fills for gaps in an agreement preview. Client-safe: the same rules
// decide what the form may send and what the server will accept.
//
// A fill is applied only when the record is actually missing or invalid.
// Typing the value that is already on file is a no-op, so seeding the form
// from the record cannot overwrite a good value or add a blocker.
import { z } from "zod";
import { checkVin } from "@/lib/vin";
import { isStorableColor, normalizeDisplayField } from "@/lib/display-normalize";

const text = (max: number) => z.string().trim().max(max).nullish();

export const FillsSchema = z
  .object({
    fullName: text(120),
    email: text(160),
    phone: text(40),
    address: text(160),
    city: text(80),
    state: text(40),
    zip: text(12),
    licenseNumber: text(40),
    licenseState: text(40),
    licenseExpiration: text(10),
    dob: text(10),
    vehicleId: z.string().uuid().nullish(),
    year: z.number().int().min(1950).max(2035).nullish(),
    make: text(60),
    model: text(60),
    color: text(40),
    vin: text(32),
    licensePlate: text(20),
    plateState: text(10),
    weeklyRent: z.number().positive().max(10000).nullish(),
    contractStart: text(10),
    contractEnd: text(10),
    insuranceCarrier: text(120),
    insurancePolicy: text(80),
  })
  .strict();

export type AgreementFills = z.infer<typeof FillsSchema>;

/** Blocker fields the prepare screen can collect. Deposit stays in Agreement Preparation. */
export const FILLABLE_FIELDS = new Set([
  "driver_name",
  "driver_email",
  "driver_phone",
  "driver_address",
  "license_number",
  "license_state",
  "license_expiration",
  "driver_dob",
  "vehicle",
  "vehicle_vin",
  "vehicle_color",
  "license_plate",
  "weekly_rate",
  "contract_start_date",
  "contract_end_date",
  "insurance_carrier",
  "insurance_policy",
]);

export type AgreementRecord = {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  dob: string;
  vehicleId: string | null;
  vehicleLabel: string;
  year: string;
  make: string;
  model: string;
  color: string;
  vin: string;
  licensePlate: string;
  plateState: string;
  weeklyRent: number | null;
  contractStart: string;
  contractEnd: string;
  datesFromRental: boolean;
  insuranceCarrier: string;
  insurancePolicy: string;
};

export type AppliedFill = {
  field: string;
  table: "applications" | "vehicles";
  column: string;
  from: string | number | null;
  to: string | number;
};

export type FillRejection = { field: string; label: string; why: string };

export type OverlayResult = {
  app: Record<string, unknown>;
  vehicle: Record<string, unknown> | null;
  applied: AppliedFill[];
  rejected: FillRejection[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATE = /^[A-Z0-9][A-Z0-9 -]{1,19}$/;

function present(value: unknown): string {
  const s = String(value ?? "").trim();
  return s;
}

function blank(value: unknown): boolean {
  return !present(value);
}

function same(a: unknown, b: unknown): boolean {
  return present(a).toLowerCase() === present(b).toLowerCase();
}

function iso(value: unknown): string {
  const s = String(value ?? "").slice(0, 10);
  return DATE.test(s) ? s : "";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function opt(value: string | null | undefined): string | undefined {
  const s = String(value ?? "").trim();
  return s ? s : undefined;
}

/** What the form should start from. Empty strings are omitted so they are not sent. */
export function recordToFills(record: AgreementRecord): AgreementFills {
  const fills: AgreementFills = {};
  const put = (key: keyof AgreementFills, value: string) => {
    const s = value.trim();
    if (s) (fills as Record<string, unknown>)[key] = s;
  };
  put("fullName", record.fullName);
  put("email", record.email);
  put("phone", record.phone);
  put("address", record.address);
  put("city", record.city);
  put("state", record.state);
  put("zip", record.zip);
  put("licenseNumber", record.licenseNumber);
  put("licenseState", record.licenseState);
  put("licenseExpiration", record.licenseExpiration);
  put("dob", record.dob);
  put("make", record.make);
  put("model", record.model);
  put("color", record.color);
  put("vin", record.vin);
  put("licensePlate", record.licensePlate);
  put("plateState", record.plateState);
  put("contractStart", record.contractStart);
  put("contractEnd", record.contractEnd);
  put("insuranceCarrier", record.insuranceCarrier);
  put("insurancePolicy", record.insurancePolicy);
  if (record.vehicleId) fills.vehicleId = record.vehicleId;
  if (record.weeklyRent != null && record.weeklyRent > 0) fills.weeklyRent = record.weeklyRent;
  if (record.year && /^\d{4}$/.test(record.year)) fills.year = Number(record.year);
  return fills;
}

export function agreementRecord(
  app: Record<string, unknown>,
  vehicle: Record<string, unknown> | null,
  datesFromRental: boolean,
  startIso: string | null,
  endIso: string | null,
): AgreementRecord {
  const weekly = app.weekly_rent ?? vehicle?.weekly_rate;
  const weeklyRent = Number(weekly) > 0 ? Number(weekly) : null;
  return {
    fullName: present(app.full_name),
    email: present(app.email),
    phone: present(app.phone),
    address: present(app.address),
    city: present(app.city),
    state: present(app.state),
    zip: present(app.zip),
    licenseNumber: present(app.license_number),
    licenseState: present(app.license_state),
    licenseExpiration: iso(app.license_expiration),
    dob: iso(app.dob),
    vehicleId: vehicle?.id ? String(vehicle.id) : app.vehicle_id ? String(app.vehicle_id) : null,
    vehicleLabel: vehicle
      ? [vehicle.unit_number ? `Unit ${vehicle.unit_number}` : "", vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")
      : "",
    year: vehicle?.year ? String(vehicle.year) : "",
    make: present(vehicle?.make),
    model: present(vehicle?.model),
    color: present(vehicle?.color),
    vin: present(vehicle?.vin),
    licensePlate: present(vehicle?.license_plate),
    plateState: present(vehicle?.plate_state),
    weeklyRent,
    contractStart: iso(startIso),
    contractEnd: iso(endIso),
    datesFromRental,
    insuranceCarrier: present(app.insurance_carrier),
    insurancePolicy: present(app.insurance_policy_number),
  };
}

/**
 * Overlay fills onto copies of the application and vehicle.
 * `vehicleId` is applied by the caller after it has loaded that vehicle:
 * this function never invents a vehicle and never writes a fleet rate or deposit.
 */
export function overlayAgreementFills(
  sourceApp: Record<string, unknown>,
  sourceVehicle: Record<string, unknown> | null,
  fills: AgreementFills,
  ctx: { datesFromRental: boolean; startIso: string | null; endIso: string | null },
): OverlayResult {
  const app = { ...sourceApp };
  const vehicle = sourceVehicle ? { ...sourceVehicle } : null;
  const applied: AppliedFill[] = [];
  const rejected: FillRejection[] = [];

  const use = (field: string, table: AppliedFill["table"], column: string, from: unknown, to: string | number, target: Record<string, unknown>) => {
    if (same(from, to)) return;
    target[column] = to;
    applied.push({ field, table, column, from: from == null || from === "" ? null : typeof from === "number" ? from : String(from), to });
  };

  const name = opt(fills.fullName);
  if (name && blank(app.full_name)) {
    if (name.split(/\s+/).filter(Boolean).length < 2)
      rejected.push({ field: "driver_name", label: "Driver's Full Legal Name", why: "Enter the first and last name, as on the licence." });
    else use("driver_name", "applications", "full_name", app.full_name, name.replace(/\s+/g, " "), app);
  }

  const email = opt(fills.email)?.toLowerCase();
  if (email && blank(app.email)) {
    if (!EMAIL.test(email)) rejected.push({ field: "driver_email", label: "Driver Email", why: "Enter a complete email address. The signing link is sent there." });
    else use("driver_email", "applications", "email", app.email, email, app);
  }

  const phone = opt(fills.phone);
  if (phone && blank(app.phone)) {
    if ((phone.match(/\d/g) ?? []).length < 7)
      rejected.push({ field: "driver_phone", label: "Driver Phone", why: "Enter a phone number with at least 7 digits." });
    else use("driver_phone", "applications", "phone", app.phone, phone, app);
  }

  const addressGap = blank(app.address) || blank(app.city) || blank(app.state) || blank(app.zip);
  if (addressGap) {
    const street = opt(fills.address);
    const city = opt(fills.city);
    const state = opt(fills.state)?.toUpperCase();
    const zip = opt(fills.zip);
    if (street && !same(street, app.address)) {
      if (street.length < 2) rejected.push({ field: "driver_address", label: "Street Address", why: "Enter the street address." });
      else use("driver_address", "applications", "address", app.address, street, app);
    }
    if (city && !same(city, app.city)) {
      if (city.length < 2) rejected.push({ field: "driver_address", label: "City", why: "Enter the city." });
      else use("driver_address", "applications", "city", app.city, city, app);
    }
    if (state && !same(state, app.state)) {
      if (!/^[A-Z]{2}$/.test(state)) rejected.push({ field: "driver_address", label: "State", why: "Use the two-letter state." });
      else use("driver_address", "applications", "state", app.state, state, app);
    }
    if (zip && !same(zip, app.zip)) {
      if (!/^\d{5}(-\d{4})?$/.test(zip)) rejected.push({ field: "driver_address", label: "ZIP", why: "Enter a 5-digit ZIP, or ZIP+4." });
      else use("driver_address", "applications", "zip", app.zip, zip, app);
    }
  }

  const lic = opt(fills.licenseNumber);
  if (lic && blank(app.license_number)) use("license_number", "applications", "license_number", app.license_number, lic, app);
  const licState = opt(fills.licenseState)?.toUpperCase();
  if (licState && blank(app.license_state)) {
    if (!/^[A-Z]{2}$/.test(licState)) rejected.push({ field: "license_state", label: "Licence Issuing State", why: "Use the two-letter state that issued the licence." });
    else use("license_state", "applications", "license_state", app.license_state, licState, app);
  }
  const start = ctx.startIso ? iso(ctx.startIso) : "";
  const licExp = opt(fills.licenseExpiration);
  const expGap = blank(app.license_expiration) || (start && iso(app.license_expiration) && iso(app.license_expiration) < start);
  if (licExp && expGap && !same(licExp, iso(app.license_expiration))) {
    if (!DATE.test(licExp)) rejected.push({ field: "license_expiration", label: "Licence Expiry Date", why: "Enter the expiry as a date." });
    else if (start && licExp < start) rejected.push({ field: "license_expiration", label: "A Licence Valid On The Start Date", why: `The licence would expire ${licExp}, before the rental starts ${start}.` });
    else use("license_expiration", "applications", "license_expiration", iso(app.license_expiration) || null, licExp, app);
  }

  const dob = opt(fills.dob);
  if (dob && blank(app.dob)) {
    if (!DATE.test(dob) || dob > todayIso()) rejected.push({ field: "driver_dob", label: "Date Of Birth", why: "Enter a date of birth that is not in the future." });
    else use("driver_dob", "applications", "dob", app.dob, dob, app);
  }

  const weeklyKnown = Number(app.weekly_rent ?? vehicle?.weekly_rate) > 0;
  if (fills.weeklyRent != null && !weeklyKnown) {
    const amount = Math.round(fills.weeklyRent * 100) / 100;
    if (!(amount > 0) || amount > 10000) rejected.push({ field: "weekly_rate", label: "Weekly Rate", why: "Enter the weekly rent, greater than zero." });
    else use("weekly_rate", "applications", "weekly_rent", app.weekly_rent ?? null, amount, app);
  }

  const dateKeys = opt(fills.contractStart) || opt(fills.contractEnd);
  if (dateKeys && ctx.datesFromRental) {
    // Seeded dates match the rental. Ignore them. A live rental's dates are
    // not overwritten from this screen.
  } else if (!ctx.datesFromRental) {
    const startGap = !iso(ctx.startIso);
    const endGap = !iso(ctx.endIso) || (iso(ctx.startIso) && iso(ctx.endIso) <= iso(ctx.startIso));
    const nextStart = opt(fills.contractStart);
    const nextEnd = opt(fills.contractEnd);
    if ((startGap || endGap) && (nextStart || nextEnd)) {
      const startVal = nextStart && DATE.test(nextStart) ? nextStart : iso(ctx.startIso);
      const endVal = nextEnd && DATE.test(nextEnd) ? nextEnd : iso(ctx.endIso);
      if (nextStart && !DATE.test(nextStart)) rejected.push({ field: "contract_start_date", label: "Contract Start Date", why: "Enter the agreed start date." });
      if (nextEnd && !DATE.test(nextEnd)) rejected.push({ field: "contract_end_date", label: "Scheduled End Date", why: "Enter the agreed end date." });
      if (startVal && endVal && endVal <= startVal)
        rejected.push({ field: "contract_end_date", label: "A Scheduled End Date After The Start Date", why: `The agreement would run from ${startVal} to ${endVal}, which ends on or before it begins.` });
      else {
        if (nextStart && DATE.test(nextStart) && startGap) use("contract_start_date", "applications", "contract_start_date", iso(app.contract_start_date) || null, nextStart, app);
        if (nextEnd && DATE.test(nextEnd) && (endGap || (startVal && nextEnd > startVal && iso(ctx.endIso) !== nextEnd)))
          use("contract_end_date", "applications", "contract_end_date", iso(app.contract_end_date) || null, nextEnd, app);
      }
    }
  }

  const carrier = opt(fills.insuranceCarrier);
  if (carrier && blank(app.insurance_carrier) && !/^none on file$/i.test(carrier))
    use("insurance_carrier", "applications", "insurance_carrier", app.insurance_carrier, carrier, app);
  const policy = opt(fills.insurancePolicy);
  if (policy && blank(app.insurance_policy_number) && !/^none on file$/i.test(policy))
    use("insurance_policy", "applications", "insurance_policy_number", app.insurance_policy_number, policy, app);

  const wantsVehicle =
    fills.year != null || opt(fills.make) || opt(fills.model) || opt(fills.color) || opt(fills.vin) || opt(fills.licensePlate) || opt(fills.plateState);
  if (wantsVehicle && !vehicle) {
    rejected.push({ field: "vehicle", label: "Vehicle Assignment", why: "Assign a vehicle first. Year, VIN and colour belong to that vehicle." });
  } else if (vehicle) {
    if (fills.year != null && blank(vehicle.year)) use("vehicle", "vehicles", "year", vehicle.year, fills.year, vehicle);
    const make = opt(fills.make);
    if (make && blank(vehicle.make)) use("vehicle", "vehicles", "make", vehicle.make, normalizeDisplayField("make", make), vehicle);
    const model = opt(fills.model);
    if (model && blank(vehicle.model)) use("vehicle", "vehicles", "model", vehicle.model, normalizeDisplayField("model", model), vehicle);
    const color = opt(fills.color);
    if (color && blank(vehicle.color)) {
      const stored = normalizeDisplayField("color", color);
      if (!isStorableColor(stored)) rejected.push({ field: "vehicle_color", label: "Vehicle Colour", why: `"${color}" is not a colour we can store. Type the colour in words.` });
      else use("vehicle_color", "vehicles", "color", vehicle.color, stored, vehicle);
    }
    const vin = opt(fills.vin);
    if (vin && (blank(vehicle.vin) || !checkVin(String(vehicle.vin)).formatValid) && !same(checkVin(vin).normalized, checkVin(String(vehicle.vin ?? "")).normalized)) {
      const checked = checkVin(vin);
      if (!checked.formatValid) rejected.push({ field: "vehicle_vin", label: "A Valid 17-Character VIN", why: checked.problem ?? "That is not a valid VIN." });
      else use("vehicle_vin", "vehicles", "vin", vehicle.vin, checked.normalized, vehicle);
    }
    const plate = opt(fills.licensePlate)?.toUpperCase().replace(/\s+/g, " ");
    if (plate && blank(vehicle.license_plate)) {
      if (!PLATE.test(plate)) rejected.push({ field: "license_plate", label: "Licence Plate", why: "Use letters and numbers only, up to 20 characters." });
      else use("license_plate", "vehicles", "license_plate", vehicle.license_plate, plate, vehicle);
    }
    const plateState = opt(fills.plateState)?.toUpperCase();
    if (plateState && blank(vehicle.plate_state)) {
      if (!/^[A-Z]{2}$/.test(plateState)) rejected.push({ field: "license_plate", label: "Plate State", why: "Use the two-letter plate state." });
      else use("license_plate", "vehicles", "plate_state", vehicle.plate_state, plateState, vehicle);
    }
  }

  return { app, vehicle, applied, rejected };
}
