// Gap-only record updates from the agreement details the staff already reviewed.
// Client-safe: no database, no contract text. A value is saved only when the
// source field is empty or invalid. A correction of a value already on file
// stays on this agreement (the existing details overlay) and is not written back.
import type { AgreementDetails } from "@/lib/agreement-prep";
import { normalizeDisplayField, isStorableColor } from "@/lib/display-normalize";
import { checkVin } from "@/lib/vin";

export type AppliedFill = {
  table: "applications" | "vehicles";
  id: string;
  column: string;
  value: string | number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATE = /^[A-Z0-9][A-Z0-9 -]{1,19}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function blank(v: unknown): boolean {
  return v == null || !String(v).trim();
}
function clean(v: unknown): string {
  return String(v ?? "").trim();
}
function isoOk(v: string, minYear = 1950, maxYear = 2035): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < minYear || y > maxYear || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}
function money(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Which reviewed details may be written onto the driver or vehicle.
 * Fleet weekly_rate and deposit are never in the result. Card on file and the
 * free-text vehicle description are not columns this screen may invent.
 */
export function recordFillsFromDetails(
  app: Record<string, unknown>,
  vehicle: Record<string, unknown> | null,
  details: Pick<
    AgreementDetails,
    | "driverName"
    | "driverEmail"
    | "driverPhone"
    | "address"
    | "city"
    | "state"
    | "zip"
    | "dob"
    | "licenseNumber"
    | "licenseState"
    | "licenseExpiration"
    | "vehicleColor"
    | "vehicleVin"
    | "licensePlate"
    | "startDate"
    | "endDate"
    | "weeklyRate"
    | "insuranceCarrier"
    | "insurancePolicy"
  >,
  ctx: { datesFromRental: boolean; startIso: string | null; endIso: string | null },
): AppliedFill[] {
  const applied: AppliedFill[] = [];
  const id = String(app.id ?? "");
  const put = (column: string, value: string | number) => {
    if (!id) return;
    applied.push({ table: "applications", id, column, value });
  };
  const same = (column: string, value: string) =>
    clean(app[column]).toLowerCase() === value.toLowerCase();

  const name = clean(details.driverName);
  if (blank(app.full_name) && name.split(/\s+/).length >= 2) put("full_name", name);

  const email = clean(details.driverEmail).toLowerCase();
  if (blank(app.email) && EMAIL.test(email)) put("email", email);

  const phone = clean(details.driverPhone);
  if (blank(app.phone) && phone.replace(/\D/g, "").length >= 7) put("phone", phone);

  const addressMissing =
    blank(app.address) || blank(app.city) || blank(app.state) || blank(app.zip);
  if (addressMissing) {
    const street = clean(details.address);
    const city = clean(details.city);
    const state = clean(details.state).toUpperCase();
    const zip = clean(details.zip);
    if (street && !same("address", street)) put("address", street);
    if (city && !same("city", city)) put("city", city);
    if (/^[A-Z]{2}$/.test(state) && !same("state", state)) put("state", state);
    if (zip && !same("zip", zip)) put("zip", zip);
  }

  const lic = clean(details.licenseNumber);
  if (blank(app.license_number) && lic) put("license_number", lic);
  const licState = clean(details.licenseState).toUpperCase();
  if (blank(app.license_state) && /^[A-Z]{2}$/.test(licState)) put("license_state", licState);
  const licExp = clean(details.licenseExpiration);
  const start = ctx.startIso ?? "";
  const licGap =
    blank(app.license_expiration) || (!!start && String(app.license_expiration) < start);
  if (
    licGap &&
    isoOk(licExp, 2020, 2040) &&
    (!start || licExp >= start) &&
    !same("license_expiration", licExp)
  ) {
    put("license_expiration", licExp);
  }

  const dob = clean(details.dob);
  if (blank(app.dob) && isoOk(dob) && dob <= new Date().toISOString().slice(0, 10)) put("dob", dob);

  const weekly = money(details.weeklyRate);
  const vehicleWeekly = money(vehicle?.weekly_rate);
  if (weekly != null && money(app.weekly_rent) == null && vehicleWeekly == null)
    put("weekly_rent", weekly);

  if (!ctx.datesFromRental) {
    const startDate = clean(details.startDate);
    const endDate = clean(details.endDate);
    const startGap = blank(ctx.startIso) || !isoOk(String(ctx.startIso), 2020, 2035);
    const endGap = blank(ctx.endIso) || !isoOk(String(ctx.endIso), 2020, 2035);
    if (startGap && isoOk(startDate, 2020, 2035) && startDate !== clean(ctx.startIso))
      put("contract_start_date", startDate);
    if (
      endGap &&
      isoOk(endDate, 2020, 2035) &&
      endDate !== clean(ctx.endIso) &&
      (!isoOk(startDate, 2020, 2035) || endDate > startDate)
    ) {
      put("contract_end_date", endDate);
    }
  }

  const carrier = clean(details.insuranceCarrier);
  if (blank(app.insurance_carrier) && carrier && carrier.toLowerCase() !== "none on file")
    put("insurance_carrier", carrier);
  const policy = clean(details.insurancePolicy);
  if (blank(app.insurance_policy_number) && policy && policy.toLowerCase() !== "none on file")
    put("insurance_policy_number", policy);

  if (vehicle?.id) {
    const vid = String(vehicle.id);
    const vput = (column: string, value: string) =>
      applied.push({ table: "vehicles", id: vid, column, value });
    const vin = clean(details.vehicleVin).toUpperCase();
    const currentVin = clean(vehicle.vin).toUpperCase();
    if (vin && vin !== currentVin && !checkVin(currentVin).formatValid && checkVin(vin).formatValid)
      vput("vin", vin);
    const color = normalizeDisplayField("color", clean(details.vehicleColor));
    if (blank(vehicle.color) && color && isStorableColor(color)) vput("color", color);
    const plate = clean(details.licensePlate).toUpperCase();
    if (blank(vehicle.license_plate) && PLATE.test(plate)) vput("license_plate", plate);
  }

  return applied;
}
