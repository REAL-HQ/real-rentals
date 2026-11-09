/**
 * Fleet Availability — one group per non-archived car.
 *
 * This is not the vehicles-list Availability label and not vehicle readiness.
 * Those stay on the Vehicles screen. This board only reads the stored status,
 * the live rental, open incidents, and the registration and insurance dates.
 *
 * A car with archived_at set is off the board. Sold, retired, and status
 * `archived` stay on it, under Not Rentable, because those are the existing
 * inactive statuses in fleet-summary.
 *
 * One car, one group:
 * 1. An active rental is Rented, so the driver and next payment stay visible.
 *    Shop and expiry still show on that row.
 * 2. Otherwise an incident In Claim or Repairing, or status `maintenance`,
 *    is In Shop.
 * 3. Otherwise an expired registration or insurance date, or an inactive
 *    status, is Not Rentable.
 * 4. Otherwise Available Now only when the stored status is `available`,
 *    there is no open incident, and both dates are real and not before today.
 * 5. Anything else is Unknown. A missing date is not treated as current or
 *    expired. Status `rented` without an active rental is not Rented.
 *
 * Today is an Eastern calendar day. A date equal to today is not expired.
 * Next payment due is the rental's next_payment_due. It is not derived from
 * the payments ledger.
 */

import { displayPersonName, displayVehicleWord } from "@/lib/display-normalize";
import { fmtDate } from "@/lib/date-format";
import { INACTIVE_VEHICLE_STATUSES } from "@/lib/fleet-summary";
import { tierAllows, type StaffTier } from "@/lib/roles";

/** Compile-time gate. No environment variable can open this. */
export const FLEET_AVAILABILITY_ENABLED = false;

export const FLEET_AVAILABILITY_DISABLED = "Fleet Availability is disabled pending acceptance";

export function assertFleetAvailabilityEnabled(): void {
  if (!FLEET_AVAILABILITY_ENABLED) throw new Error(FLEET_AVAILABILITY_DISABLED);
}

/** Owners, managers, and coordinators. The server enforces this with requireStaff. */
export function fleetAvailabilityTierAllowed(tier: StaffTier | null): boolean {
  return tierAllows(tier, "coordinator");
}

/** #79's Drivers filter. This branch does not render that list. */
export const APPROVED_NOT_RENTING_FILTER = "approved-not-renting";

export const FLEET_TIME_ZONE = "America/New_York";

/** Incident statuses that mean the car is In Shop. `open` is not one of them. */
export const SHOP_INCIDENT_STATUSES = ["in_claim", "repairing"] as const;

/** Incident statuses that keep a car out of Available Now. */
export const BLOCKING_INCIDENT_STATUSES = ["open", "in_claim", "repairing"] as const;

const INACTIVE = new Set<string>(INACTIVE_VEHICLE_STATUSES);

const STATUS_LABEL: Record<string, string> = {
  onboarding: "Needs Setup",
  available: "Available",
  rented: "Rented",
  maintenance: "In Maintenance",
  reserved: "Reserved",
  archived: "Archived",
  sold: "Sold",
  retired: "Retired",
};

export const FLEET_GROUPS = ["available_now", "rented", "in_shop", "not_rentable", "unknown"] as const;
export type FleetGroup = (typeof FLEET_GROUPS)[number];

export const FLEET_GROUP_LABEL: Record<FleetGroup, string> = {
  available_now: "Available Now",
  rented: "Rented",
  in_shop: "In Shop",
  not_rentable: "Not Rentable",
  unknown: "Unknown",
};

export type FleetVehicleInput = {
  id: string;
  unitNumber: string | null;
  year: number | string | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  status: string | null;
  archivedAt: string | null;
  registrationExpiresOn: string | null;
  insuranceExpiresOn: string | null;
};

export type FleetRentalInput = {
  id: string;
  vehicleId: string | null;
  applicationId: string | null;
  driverName: string | null;
  nextPaymentDue: string | null;
  status: string | null;
};

export type FleetIncidentInput = {
  vehicleId: string | null;
  status: string | null;
};

export type FleetAvailabilityRow = {
  id: string;
  unit: string;
  vehicle: string;
  plate: string;
  statusLabel: string;
  group: FleetGroup;
  driver: string;
  nextPaymentDue: string;
  facts: string[];
};

export type FleetAvailabilityBoard = {
  todayEt: string;
  total: number;
  counts: Record<FleetGroup, number>;
  groups: Array<{ id: FleetGroup; label: string; rows: FleetAvailabilityRow[] }>;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function etCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FLEET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month").padStart(2, "0")}-${pick("day").padStart(2, "0")}`;
}

function isRealDate(iso: string): boolean {
  const m = DATE_ONLY.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A date-only value, or the date prefix of a date column. Invalid input is null. */
export function calendarDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m || !isRealDate(m[1])) return null;
  return m[1];
}

export type DocState = "current" | "expired" | "unknown";

/** Before today is expired. Today is current. Missing or unreadable is unknown. */
export function docState(raw: string | null | undefined, todayEt: string): DocState {
  const day = calendarDate(raw);
  if (!day) return "unknown";
  return day < todayEt ? "expired" : "current";
}

function norm(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase();
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? "Unknown";
}

function vehicleLabel(v: FleetVehicleInput): string {
  const yearText = v.year == null ? "" : String(v.year).trim();
  const year = /^\d{4}$/.test(yearText) ? yearText : "";
  const make = clean(v.make);
  const model = clean(v.model);
  const parts = [year, make ? displayVehicleWord(make) : "", model ? displayVehicleWord(model) : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "Unknown";
}

function personLabel(name: string | null | undefined): string {
  const s = clean(name);
  if (!s) return "Unknown";
  return displayPersonName(s) || "Unknown";
}

export function paymentDueLabel(raw: string | null | undefined): string {
  const day = calendarDate(raw);
  if (!day) return "Unknown";
  const label = fmtDate(day);
  return label || "Unknown";
}

function agreed(labels: string[]): string {
  if (labels.length === 0) return "Unknown";
  const first = labels[0];
  if (!first || first === "Unknown") return "Unknown";
  for (const label of labels) if (label !== first) return "Unknown";
  return first;
}

function isArchivedAt(value: string | null | undefined): boolean {
  return clean(value).length > 0;
}

/**
 * Approved applications with no active rental.
 * Same population as #79: status `approved`, not deleted, application id
 * absent from rentals in status `active`. This does not read audit_log.
 */
export function countApprovedNotRenting(
  applicants: { id: string; status: string | null; deletedAt: string | null }[],
  activeRentalApplicationIds: Iterable<string>,
): number {
  const renting = new Set(activeRentalApplicationIds);
  const seen = new Set<string>();
  let count = 0;
  for (const applicant of applicants) {
    const id = clean(applicant.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (clean(applicant.status) !== "approved") continue;
    if (clean(applicant.deletedAt)) continue;
    if (renting.has(id)) continue;
    count++;
  }
  return count;
}

export function buildFleetAvailability(input: {
  vehicles: FleetVehicleInput[];
  rentals: FleetRentalInput[];
  incidents: FleetIncidentInput[];
  todayEt: string;
}): FleetAvailabilityBoard {
  if (!isRealDate(input.todayEt)) throw new Error("Fleet Availability needs an Eastern calendar day.");

  const rentalsByVehicle = new Map<string, FleetRentalInput[]>();
  for (const rental of input.rentals) {
    if (!rental.vehicleId || norm(rental.status) !== "active") continue;
    const list = rentalsByVehicle.get(rental.vehicleId) ?? [];
    list.push(rental);
    rentalsByVehicle.set(rental.vehicleId, list);
  }
  const incidentsByVehicle = new Map<string, FleetIncidentInput[]>();
  for (const incident of input.incidents) {
    if (!incident.vehicleId) continue;
    const list = incidentsByVehicle.get(incident.vehicleId) ?? [];
    list.push(incident);
    incidentsByVehicle.set(incident.vehicleId, list);
  }

  const rows: FleetAvailabilityRow[] = [];
  const seen = new Set<string>();
  for (const vehicle of input.vehicles) {
    if (!vehicle.id || seen.has(vehicle.id)) continue;
    seen.add(vehicle.id);
    if (isArchivedAt(vehicle.archivedAt)) continue;

    const status = norm(vehicle.status);
    const active = rentalsByVehicle.get(vehicle.id) ?? [];
    const incidents = incidentsByVehicle.get(vehicle.id) ?? [];
    let shop = false;
    let openIncident = false;
    for (const incident of incidents) {
      const incidentStatus = norm(incident.status);
      if ((SHOP_INCIDENT_STATUSES as readonly string[]).includes(incidentStatus)) shop = true;
      else if (incidentStatus === "open") openIncident = true;
    }
    const registration = docState(vehicle.registrationExpiresOn, input.todayEt);
    const insurance = docState(vehicle.insuranceExpiresOn, input.todayEt);
    const maintenance = status === "maintenance";

    let group: FleetGroup;
    if (active.length > 0) group = "rented";
    else if (shop || maintenance) group = "in_shop";
    else if (registration === "expired" || insurance === "expired" || INACTIVE.has(status)) group = "not_rentable";
    else if (status === "available" && !openIncident && registration === "current" && insurance === "current") {
      group = "available_now";
    } else group = "unknown";

    const facts: string[] = [];
    if (registration === "expired") facts.push("Registration Expired");
    if (insurance === "expired") facts.push("Insurance Expired");
    if ((shop || maintenance) && group !== "in_shop") facts.push("In Shop");
    if (openIncident) facts.push("Open Incident");

    rows.push({
      id: vehicle.id,
      unit: clean(vehicle.unitNumber) || "Unknown",
      vehicle: vehicleLabel(vehicle),
      plate: clean(vehicle.plate) || "Unknown",
      statusLabel: statusLabel(status),
      group,
      driver: group === "rented" ? agreed(active.map((rental) => personLabel(rental.driverName))) : "",
      nextPaymentDue: group === "rented" ? agreed(active.map((rental) => paymentDueLabel(rental.nextPaymentDue))) : "",
      facts,
    });
  }

  rows.sort((a, b) => {
    if (a.unit === "Unknown" && b.unit !== "Unknown") return 1;
    if (a.unit !== "Unknown" && b.unit === "Unknown") return -1;
    return a.unit.localeCompare(b.unit, undefined, { numeric: true }) || a.id.localeCompare(b.id);
  });

  const counts = Object.fromEntries(FLEET_GROUPS.map((id) => [id, 0])) as Record<FleetGroup, number>;
  for (const row of rows) counts[row.group]++;
  const groups = FLEET_GROUPS.map((id) => ({
    id,
    label: FLEET_GROUP_LABEL[id],
    rows: rows.filter((row) => row.group === id),
  }));
  return { todayEt: input.todayEt, total: rows.length, counts, groups };
}
