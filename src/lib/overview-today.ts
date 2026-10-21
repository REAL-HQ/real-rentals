import { leadBucket, leadToday, type LeadRow } from "@/lib/lead-priorities";

/**
 * Overview Today is dark. This is a constant, not an environment variable.
 * Leaving it false keeps the live dashboard on its current reads.
 */
export const OVERVIEW_TODAY_ENABLED: boolean = false;

export const OVERVIEW_TODAY_LIMIT = 25;

/** Due and not received. Matches the Overview overdue strip. `current` is issued and not yet due. */
export const OVERVIEW_TODAY_OVERDUE_STATUSES = [
  "late",
  "past_due",
  "collections",
  "overdue",
  "failed",
  "unpaid",
] as const;

/** Rentals that can still go out today. Ended and cancelled rows are not pickups. */
export const PICKUP_STATUSES = ["active", "reserved", "pending", "upcoming"] as const;

/** Still out, or already brought back on this calendar day. Cancelled rows are not returns. */
export const RETURN_STATUSES = [
  ...PICKUP_STATUSES,
  "ended",
  "completed",
  "closed",
  "returned",
  "finished",
] as const;

export type TodayRental = {
  id: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  application_id: string | null;
  vehicle_id: string | null;
};

export type TodayPayment = {
  id: string;
  status: string | null;
  type: string | null;
  amount: number | null;
  due_date: string | null;
  application_id: string | null;
};

export type TodayLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string;
  created_at: string | null;
  contact_status: string;
  contact_follow_up_on: string | null;
};

export type TodayVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  unit_number: string | null;
};

export type TodayName = { id: string; full_name: string | null };

export type OverviewTodayItem = {
  id: string;
  title: string;
  detail: string;
  href: string | null;
};

export type OverviewTodaySection = {
  total: number;
  truncated: boolean;
  rows: OverviewTodayItem[];
};

export type OverviewTodayResult = {
  enabled: false;
  today: string;
} | {
  enabled: true;
  today: string;
  pickups: OverviewTodaySection;
  returns: OverviewTodaySection;
  overduePayments: OverviewTodaySection;
  newLeads: OverviewTodaySection;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function overviewToday(now = new Date()): string {
  return leadToday(now);
}

export function dateOnly(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DATE_ONLY.test(trimmed) ? trimmed : null;
}

function statusIn(status: string | null | undefined, allowed: readonly string[]): boolean {
  return allowed.includes(String(status ?? "").trim().toLowerCase());
}

export function isTodayPickup(row: Pick<TodayRental, "status" | "start_date">, today: string): boolean {
  return dateOnly(row.start_date) === today && statusIn(row.status, PICKUP_STATUSES);
}

export function isTodayReturn(row: Pick<TodayRental, "status" | "end_date">, today: string): boolean {
  return dateOnly(row.end_date) === today && statusIn(row.status, RETURN_STATUSES);
}

export function isOverduePayment(status: string | null | undefined): boolean {
  return statusIn(status, OVERVIEW_TODAY_OVERDUE_STATUSES);
}

export function isNewLead(
  row: Pick<TodayLead, "status" | "contact_status" | "contact_follow_up_on">,
  today: string,
): boolean {
  const lead: LeadRow = {
    id: "",
    full_name: null,
    phone: null,
    status: row.status,
    created_at: null,
    contact_status: row.contact_status,
    contact_status_note: null,
    contact_follow_up_on: row.contact_follow_up_on,
    contact_status_at: null,
    contact_status_by: null,
  };
  return leadBucket(lead, today) === "new";
}

/** A missing or negative amount stays unknown. Zero is a real recorded amount. */
export function recordedAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function vehicleLabel(row: Pick<TodayVehicle, "year" | "make" | "model" | "unit_number"> | null | undefined): string {
  if (!row) return "Vehicle";
  const name = [row.year, row.make, row.model]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ");
  const unit = row.unit_number?.trim() ?? "";
  if (name && unit) return `${name} · ${unit}`;
  return name || unit || "Vehicle";
}

export function disabledOverviewToday(today = overviewToday()): OverviewTodayResult {
  return { enabled: false, today };
}

function section(rows: OverviewTodayItem[], total: number): OverviewTodaySection {
  const shown = rows.slice(0, OVERVIEW_TODAY_LIMIT);
  return { total, truncated: total > shown.length, rows: shown };
}

function personTitle(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  return trimmed || "Unnamed";
}

export function assembleOverviewToday(input: {
  today: string;
  pickups: { rows: TodayRental[]; total: number };
  returns: { rows: TodayRental[]; total: number };
  overduePayments: { rows: TodayPayment[]; total: number };
  newLeads: { rows: TodayLead[]; total: number };
  names: TodayName[];
  vehicles: TodayVehicle[];
}): OverviewTodayResult {
  const names = new Map(input.names.map((row) => [row.id, row.full_name]));
  const vehicles = new Map(input.vehicles.map((row) => [row.id, row]));
  const rentalItem = (row: TodayRental, when: string | null): OverviewTodayItem => ({
    id: row.id,
    title: personTitle(row.application_id ? names.get(row.application_id) : null),
    detail: `${vehicleLabel(row.vehicle_id ? vehicles.get(row.vehicle_id) : null)} · ${when ?? "Date Unavailable"}`,
    href: null,
  });
  const pickups = input.pickups.rows.filter((row) => isTodayPickup(row, input.today));
  const returns = input.returns.rows.filter((row) => isTodayReturn(row, input.today));
  const overdue = input.overduePayments.rows.filter((row) => isOverduePayment(row.status));
  const leads = input.newLeads.rows.filter((row) => isNewLead(row, input.today));
  return {
    enabled: true,
    today: input.today,
    pickups: section(
      pickups.map((row) => rentalItem(row, dateOnly(row.start_date))),
      input.pickups.total,
    ),
    returns: section(
      returns.map((row) => rentalItem(row, dateOnly(row.end_date))),
      input.returns.total,
    ),
    overduePayments: section(
      overdue.map((row) => ({
        id: row.id,
        title: personTitle(row.application_id ? names.get(row.application_id) : null),
        detail: `${row.type?.trim() || "Payment"} · ${recordedAmount(row.amount) === null ? "Amount Unavailable" : String(recordedAmount(row.amount))} · ${dateOnly(row.due_date) ?? "No Due Date"}`,
        href: null,
      })),
      input.overduePayments.total,
    ),
    newLeads: section(
      leads.map((row) => ({
        id: row.id,
        title: personTitle(row.full_name),
        detail: row.phone?.trim() || "No Phone",
        href: `/admin?tab=drivers&id=${encodeURIComponent(row.id)}`,
      })),
      input.newLeads.total,
    ),
  };
}
