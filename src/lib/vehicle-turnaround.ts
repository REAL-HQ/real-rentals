// Vehicle Turnaround rules. No database access.

import { PHASE_STATUSES } from "@/lib/bookings-list";
import {
  vehicleReadinessChecks,
  type CheckStatus,
  type ReadinessFacts,
} from "@/lib/vehicle-readiness";

export const TURNAROUND_TIME_ZONE = "America/New_York";
export const TURNAROUND_FETCH_LIMIT = 1000;
export const PICKUP_STATUSES = ["new", "reviewing", "approved"] as const;
export const OPEN_SERVICE_STATUSES = ["scheduled", "in_progress"] as const;
/** Spellings end_rental and the bookings list already treat as a finished rental. */
export const ENDED_RENTAL_STATUSES = PHASE_STATUSES.completed;
const RETIRED_STATUSES = new Set(["retired", "sold", "archived"]);

export const VEHICLE_TURNAROUND_OMITTED = [
  "There is no turnaround queue. A vehicle is listed only when it has no active rental and at least one of these is true: it was returned or ended on or before today, its status is maintenance, or its status is available.",
  "There is no recently window and no about-to-return column. Every returned or ended rental with an end date on or before the Eastern today is included. A vehicle that still has an active rental is omitted, even when that rental's end date is soon.",
  "Returned or ended means the rental status is ended, completed, closed, returned, or finished. Cancelled, void, reserved, pending, and upcoming rentals are not a return.",
  "Active means rentals.status is active, the spelling activate_rental_tx writes. There is no idle-since column. Idle days are the Eastern calendar today minus the latest qualifying end date. A vehicle with no such date has unknown idle days, sorts last, and is left out of the total.",
  "There is no scheduled-pickup column on vehicles. The next pickup is the earliest applications.pickup_date on or after today for a new, reviewing, or approved application that names the vehicle and is not deleted. A pickup date before today is omitted.",
  "Open service is maintenance_records with status scheduled or in_progress. Completed records are omitted. The table default status upcoming is omitted. vehicles.maintenance_status is a free-text note and is not an open service item.",
  "The Service screen has no record deep link, so each service link opens the Service list.",
  "Registration and insurance are the registration and insurance checks from vehicleReadinessChecks, using registration_expires_on and insurance_expires_on, with today set to the Eastern calendar date. Document slots, inspections, service schedules, issues, and incidents are not loaded, so those checks are not shown. A missing date reads as Not Verified.",
  "Archived vehicles are omitted. Retired, sold, and archived statuses are omitted. Reserved, onboarding, and rented vehicles are omitted unless they were returned or ended and have no active rental.",
  "There is no cleaning, detailing, or promised-ready column.",
  "Stripe is not read. This board does not write.",
  "Each read is capped at 1000 rows. Ended rentals keep the newest end dates. An older end past that cap is not used, so that vehicle's idle days stay unknown.",
] as const;

const EMPTY_FACTS: ReadinessFacts = {
  lastPreDeliveryPassedAt: null,
  schedules: [],
  openIssues: [],
  openIncidents: [],
  hasActiveRental: false,
};

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TURNAROUND_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

/** Local midnight of a calendar date, so vehicleReadinessChecks uses that date as today. */
export function calendarDateAsLocal(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function calendarDaysBetween(earlier: string, later: string): number {
  const start = utcDate(earlier).getTime();
  const end = utcDate(later).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Expected a calendar date");
  return Math.round((end - start) / 86400_000);
}

export function formatTurnaroundDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(isoDate.slice(0, 10)));
}

export function formatTurnaroundHeading(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(isoDate.slice(0, 10)));
}

function utcDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function vehicleTurnaroundLabel(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
  unit_number?: string | null;
}): string {
  const unit = vehicle.unit_number ? `#${vehicle.unit_number}` : "No Unit";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const plate = vehicle.license_plate ? ` · ${vehicle.license_plate}` : "";
  return `${unit}${name ? ` · ${name}` : ""}${plate}`;
}

export type TurnaroundSearch = { tab: "vehicles"; id: string } | { tab: "maintenance" };

export type TurnaroundVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  unit_number: string | null;
  status: string | null;
  archived_at: string | null;
  registration_expires_on: string | null;
  insurance_expires_on: string | null;
};

export type TurnaroundRental = {
  id: string;
  vehicle_id: string;
  status: string | null;
  end_date: string | null;
};

export type TurnaroundPickup = {
  id: string;
  vehicle_id: string | null;
  full_name: string | null;
  status: string | null;
  pickup_date: string | null;
  deleted_at: string | null;
};

export type TurnaroundService = {
  id: string;
  vehicle_id: string;
  status: string | null;
  item: string | null;
  performed_on: string | null;
  due_date: string | null;
};

export type TurnaroundFlag = {
  status: CheckStatus;
  value: string;
  reason: string;
};

export type TurnaroundServiceItem = {
  id: string;
  item: string;
  due: string | null;
};

export type TurnaroundRow = {
  vehicleId: string;
  label: string;
  reasons: string[];
  idleDays: number | null;
  lastRentalEnd: string | null;
  nextPickup: { date: string; name: string | null } | null;
  openService: TurnaroundServiceItem[];
  registration: TurnaroundFlag;
  insurance: TurnaroundFlag;
  vehicleSearch: { tab: "vehicles"; id: string };
  serviceSearch: { tab: "maintenance" };
};

export type VehicleTurnaroundInput = {
  today: string;
  vehicles: TurnaroundVehicle[];
  rentals: TurnaroundRental[];
  pickups: TurnaroundPickup[];
  services: TurnaroundService[];
  vehiclesTruncated?: boolean;
  activeRentalsTruncated?: boolean;
  endedRentalsTruncated?: boolean;
  pickupsTruncated?: boolean;
  servicesTruncated?: boolean;
};

export type VehicleTurnaroundBoard = {
  today: string;
  heading: string;
  rows: TurnaroundRow[];
  totalIdleDays: number;
  unknownIdleCount: number;
  vehiclesTruncated: boolean;
  activeRentalsTruncated: boolean;
  endedRentalsTruncated: boolean;
  pickupsTruncated: boolean;
  servicesTruncated: boolean;
  omitted: readonly string[];
};

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

function isEnded(status: string | null | undefined): boolean {
  return (ENDED_RENTAL_STATUSES as readonly string[]).includes(String(status ?? "").toLowerCase());
}

export function buildVehicleTurnaround(input: VehicleTurnaroundInput): VehicleTurnaroundBoard {
  const today = input.today;
  const activeVehicles = new Set(
    input.rentals.filter((row) => String(row.status ?? "").toLowerCase() === "active").map((row) => row.vehicle_id),
  );

  const lastEnd = new Map<string, string>();
  for (const rental of input.rentals) {
    if (!isEnded(rental.status)) continue;
    const end = dateOnly(rental.end_date);
    if (!end || end > today) continue;
    const previous = lastEnd.get(rental.vehicle_id);
    if (!previous || end > previous) lastEnd.set(rental.vehicle_id, end);
  }

  const rows: TurnaroundRow[] = [];
  for (const vehicle of input.vehicles) {
    if (vehicle.archived_at) continue;
    if (RETIRED_STATUSES.has(String(vehicle.status ?? "").toLowerCase())) continue;
    if (activeVehicles.has(vehicle.id)) continue;

    const status = String(vehicle.status ?? "").toLowerCase();
    const end = lastEnd.get(vehicle.id) ?? null;
    const returned = end != null;
    const maintenance = status === "maintenance";
    const available = status === "available";
    if (!returned && !maintenance && !available) continue;

    const reasons: string[] = [];
    if (returned) reasons.push("Returned");
    if (maintenance) reasons.push("In Maintenance");
    if (available) reasons.push("Available");

    const checks = vehicleReadinessChecks(
      {
        registration_expires_on: vehicle.registration_expires_on,
        insurance_expires_on: vehicle.insurance_expires_on,
      },
      EMPTY_FACTS,
      [],
      calendarDateAsLocal(today),
    );
    const registration = checks.find((check) => check.key === "registration");
    const insurance = checks.find((check) => check.key === "insurance");
    if (!registration || !insurance) throw new Error("Readiness checks did not include registration and insurance");

    const pickup = input.pickups
      .filter((row) => {
        const when = dateOnly(row.pickup_date);
        return (
          row.vehicle_id === vehicle.id &&
          !row.deleted_at &&
          !!when &&
          when >= today &&
          (PICKUP_STATUSES as readonly string[]).includes(String(row.status ?? "").toLowerCase())
        );
      })
      .sort((a, b) => dateOnly(a.pickup_date)!.localeCompare(dateOnly(b.pickup_date)!))[0];

    const openService = input.services
      .filter(
        (row) =>
          row.vehicle_id === vehicle.id &&
          (OPEN_SERVICE_STATUSES as readonly string[]).includes(String(row.status ?? "").toLowerCase()),
      )
      .map((row) => ({
        id: row.id,
        item: row.item?.trim() || "Service Item",
        due: dateOnly(row.due_date) ?? dateOnly(row.performed_on),
      }));

    rows.push({
      vehicleId: vehicle.id,
      label: vehicleTurnaroundLabel(vehicle),
      reasons,
      idleDays: end ? calendarDaysBetween(end, today) : null,
      lastRentalEnd: end,
      nextPickup: pickup
        ? { date: dateOnly(pickup.pickup_date)!, name: pickup.full_name?.trim() || null }
        : null,
      openService,
      registration: { status: registration.status, value: registration.value, reason: registration.reason },
      insurance: { status: insurance.status, value: insurance.value, reason: insurance.reason },
      vehicleSearch: { tab: "vehicles", id: vehicle.id },
      serviceSearch: { tab: "maintenance" },
    });
  }

  rows.sort((a, b) => {
    if (a.idleDays == null && b.idleDays == null) return a.label.localeCompare(b.label);
    if (a.idleDays == null) return 1;
    if (b.idleDays == null) return -1;
    if (b.idleDays !== a.idleDays) return b.idleDays - a.idleDays;
    return a.label.localeCompare(b.label);
  });

  const known = rows.filter((row) => row.idleDays != null);
  return {
    today,
    heading: formatTurnaroundHeading(today),
    rows,
    totalIdleDays: known.reduce((sum, row) => sum + (row.idleDays ?? 0), 0),
    unknownIdleCount: rows.length - known.length,
    vehiclesTruncated: !!input.vehiclesTruncated,
    activeRentalsTruncated: !!input.activeRentalsTruncated,
    endedRentalsTruncated: !!input.endedRentalsTruncated,
    pickupsTruncated: !!input.pickupsTruncated,
    servicesTruncated: !!input.servicesTruncated,
    omitted: VEHICLE_TURNAROUND_OMITTED,
  };
}
