// Fleet Calendar rules. No database access.

export const FLEET_TIME_ZONE = "America/New_York";
export const FLEET_ROW_LIMIT = 100;
export const PICKUP_STATUSES = ["new", "reviewing", "approved"] as const;
export const OPEN_MAINTENANCE_STATUSES = ["scheduled", "in_progress"] as const;

export const FLEET_CALENDAR_OMITTED = [
  "There is no separate bookings table. Active rentals are the booking blocks.",
  "Rentals that are not active are omitted.",
  "Scheduled pickups with no vehicle are omitted from the grid.",
  "There are no out-of-service start or end columns. A vehicle with status maintenance is drawn across the visible week.",
  "A maintenance record is a day, using performed_on when it falls in the week, otherwise due_date. It is not a period.",
  "Maintenance schedules and their next due dates are omitted. The Service screen owns due work.",
  "Completed maintenance records are omitted.",
  "Archived vehicles are omitted.",
  "Maintenance rows open the Service list. That screen has no record deep link.",
] as const;

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FLEET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return next.toISOString().slice(0, 10);
}

/** Monday of the Eastern calendar week that contains isoDate. */
export function mondayOf(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(isoDate, delta);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));
}

export function formatDayHeading(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatWeekHeading(weekStart: string): string {
  const end = addCalendarDays(weekStart, 6);
  const startLabel = formatDayHeading(weekStart);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(end));
  return `${startLabel} – ${endLabel}`;
}

function utcDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export type FleetSearch = { tab: string; id?: string };

export type FleetBlock = {
  id: string;
  kind: "rental" | "pickup" | "maintenance" | "in_maintenance";
  label: string;
  detail: string;
  start: string;
  end: string;
  search: FleetSearch;
};

export type FleetVehicle = {
  id: string;
  label: string;
  status: string;
  archived_at: string | null;
};

export type FleetRental = {
  id: string;
  vehicle_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  driver_name: string | null;
};

export type FleetPickup = {
  id: string;
  vehicle_id: string | null;
  full_name: string | null;
  status: string;
  pickup_date: string | null;
  deleted_at: string | null;
};

export type FleetService = {
  id: string;
  vehicle_id: string;
  status: string;
  item: string | null;
  performed_on: string | null;
  due_date: string | null;
};

export type FleetCalendarInput = {
  weekStart: string;
  vehicles: FleetVehicle[];
  rentals: FleetRental[];
  pickups: FleetPickup[];
  services: FleetService[];
  vehiclesTruncated?: boolean;
};

export type FleetCalendarBoard = {
  weekStart: string;
  weekEnd: string;
  days: string[];
  heading: string;
  rows: Array<{ vehicleId: string; label: string; blocks: FleetBlock[] }>;
  omitted: readonly string[];
  vehiclesTruncated: boolean;
};

export function vehicleCalendarLabel(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
  unit_number?: string | null;
} | null | undefined): string {
  if (!vehicle) return "Vehicle";
  const title = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part != null && String(part).trim() !== "").join(" ");
  const unit = vehicle.unit_number?.trim() ? `#${vehicle.unit_number.trim()}` : "";
  const plate = vehicle.license_plate?.trim() ?? "";
  return [unit, title, plate].filter(Boolean).join(" · ") || "Vehicle";
}

export function coversDay(blockStart: string, blockEnd: string, day: string): boolean {
  return blockStart <= day && blockEnd >= day;
}

export function activeRentalSpan(rental: Pick<FleetRental, "status" | "start_date" | "end_date">, weekStart: string, weekEnd: string): { start: string; end: string } | null {
  if (rental.status !== "active" || !rental.start_date) return null;
  const close = rental.end_date ?? "9999-12-31";
  if (rental.start_date > weekEnd || close < weekStart) return null;
  const start = rental.start_date > weekStart ? rental.start_date : weekStart;
  const endCap = rental.end_date ?? weekEnd;
  const end = endCap < weekEnd ? endCap : weekEnd;
  return { start, end };
}

export function isScheduledPickup(row: Pick<FleetPickup, "status" | "pickup_date" | "deleted_at" | "vehicle_id">, weekStart: string, weekEnd: string): boolean {
  return (
    row.deleted_at == null &&
    Boolean(row.vehicle_id) &&
    Boolean(row.pickup_date) &&
    row.pickup_date! >= weekStart &&
    row.pickup_date! <= weekEnd &&
    (PICKUP_STATUSES as readonly string[]).includes(row.status)
  );
}

export function serviceDay(row: Pick<FleetService, "status" | "performed_on" | "due_date">, weekStart: string, weekEnd: string): string | null {
  if (!(OPEN_MAINTENANCE_STATUSES as readonly string[]).includes(row.status)) return null;
  if (row.performed_on && row.performed_on >= weekStart && row.performed_on <= weekEnd) return row.performed_on;
  if (row.due_date && row.due_date >= weekStart && row.due_date <= weekEnd) return row.due_date;
  return null;
}

function person(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || "Unnamed Driver";
}

export function buildFleetCalendar(input: FleetCalendarInput): FleetCalendarBoard {
  const weekStart = mondayOf(input.weekStart);
  const days = weekDays(weekStart);
  const weekEnd = days[6];
  const vehicles = input.vehicles.filter((vehicle) => vehicle.archived_at == null).slice(0, FLEET_ROW_LIMIT);

  const rows = vehicles.map((vehicle) => {
    const blocks: FleetBlock[] = [];
    if (vehicle.status === "maintenance") {
      blocks.push({
        id: `status:${vehicle.id}`,
        kind: "in_maintenance",
        label: "In Maintenance",
        detail: "Current Status",
        start: weekStart,
        end: weekEnd,
        search: { tab: "vehicles", id: vehicle.id },
      });
    }
    for (const rental of input.rentals) {
      if (rental.vehicle_id !== vehicle.id) continue;
      const span = activeRentalSpan(rental, weekStart, weekEnd);
      if (!span) continue;
      blocks.push({
        id: rental.id,
        kind: "rental",
        label: person(rental.driver_name),
        detail: rental.end_date ? "Active Rental" : "Open Rental",
        start: span.start,
        end: span.end,
        search: { tab: "bookings", id: rental.id },
      });
    }
    for (const pickup of input.pickups) {
      if (pickup.vehicle_id !== vehicle.id || !isScheduledPickup(pickup, weekStart, weekEnd) || !pickup.pickup_date) continue;
      blocks.push({
        id: pickup.id,
        kind: "pickup",
        label: person(pickup.full_name),
        detail: "Scheduled Pickup",
        start: pickup.pickup_date,
        end: pickup.pickup_date,
        search: { tab: "drivers", id: pickup.id },
      });
    }
    for (const service of input.services) {
      if (service.vehicle_id !== vehicle.id) continue;
      const day = serviceDay(service, weekStart, weekEnd);
      if (!day) continue;
      blocks.push({
        id: service.id,
        kind: "maintenance",
        label: (service.item ?? "").trim() || "Service",
        detail: service.performed_on && service.performed_on >= weekStart && service.performed_on <= weekEnd ? "Performed" : "Due",
        start: day,
        end: day,
        search: { tab: "maintenance" },
      });
    }
    return { vehicleId: vehicle.id, label: vehicle.label, blocks };
  });

  return {
    weekStart,
    weekEnd,
    days,
    heading: formatWeekHeading(weekStart),
    rows,
    omitted: FLEET_CALENDAR_OMITTED,
    vehiclesTruncated: Boolean(input.vehiclesTruncated) || input.vehicles.filter((vehicle) => vehicle.archived_at == null).length > FLEET_ROW_LIMIT,
  };
}

export function blockOnDay(blocks: FleetBlock[], day: string): FleetBlock[] {
  return blocks.filter((block) => coversDay(block.start, block.end, day));
}
