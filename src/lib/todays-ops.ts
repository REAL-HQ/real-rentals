// Today's Ops board rules. No database access.
import { COLLECTIONS_WATCH_STATUSES } from "./collections-watch";
import { isIssueClosed } from "./driver-issues";

export const OPS_TIME_ZONE = "America/New_York";
export const OPS_ROW_LIMIT = 100;

export const PICKUP_STATUSES = ["new", "reviewing", "approved"] as const;

const WATCH = new Set<string>(COLLECTIONS_WATCH_STATUSES);
const INCIDENT_CLOSED = new Set(["closed", "written_off"]);
const ROADSIDE_KINDS = new Set(["breakdown", "tow"]);

export const TODAYS_OPS_OMITTED = [
  "Stripe Collections is not used. Overdue Payments uses the Collections Watch statuses on payments.",
  "There is no separate return-due column. Returns use rentals.end_date.",
  "There is no approved-ready column. Approved Ready means applications.status is approved and deleted_at is empty.",
  "Incidents have no record deep link. Each row opens the Incidents list.",
  "Open driver issues that are not Breakdown or Tow are omitted from Roadside Issues.",
  "payments.due_date is not a second due-today source. Payments Due Today uses rentals.next_payment_due on active rentals.",
  "Driver licence expiry is not part of the vehicle document helper.",
  "Payment due dates on rentals that are not active are omitted.",
  "Open maintenance records are not listed separately. In Maintenance uses vehicles.status of maintenance.",
  "Document dates use the existing helper's local midnight, not a new Eastern Time cutoff, and include dates that have already lapsed.",
] as const;

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

/** Add calendar days to a YYYY-MM-DD date. The arithmetic is UTC so a DST change cannot skip a day. */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return next.toISOString().slice(0, 10);
}

export function formatOpsDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export type OpsSearch = { tab: string; id?: string; filter?: string };

export type OpsItem = {
  id: string;
  label: string;
  detail: string;
  search: OpsSearch;
};

export type OpsSection = {
  id: string;
  title: string;
  items: OpsItem[];
  truncated: boolean;
};

export type TodaysOpsBoard = {
  today: string;
  tomorrow: string;
  heading: string;
  sections: OpsSection[];
  omitted: readonly string[];
};

export type OpsApplication = {
  id: string;
  full_name: string | null;
  status: string;
  pickup_date: string | null;
  deleted_at: string | null;
};

export type OpsRental = {
  id: string;
  status: string;
  end_date: string | null;
  next_payment_due: string | null;
  driver_name: string | null;
  vehicle_label: string | null;
};

export type OpsPayment = {
  id: string;
  status: string;
  amount: number | null;
  driver_name: string | null;
};

export type OpsDocument = {
  vehicle_id: string;
  label: string;
  what: string;
  expires_on: string;
  days: number;
};

export type OpsIncident = {
  id: string;
  status: string;
  incident_type: string;
  vehicle_label: string | null;
};

export type OpsIssue = {
  id: string;
  kind: string | null;
  status: string | null;
  title: string | null;
};

export type OpsVehicle = {
  id: string;
  status: string;
  archived_at: string | null;
  label: string;
};

export type TodaysOpsInput = {
  today: string;
  tomorrow: string;
  applications: OpsApplication[];
  rentals: OpsRental[];
  payments: OpsPayment[];
  documents: OpsDocument[];
  incidents: OpsIncident[];
  issues: OpsIssue[];
  vehicles: OpsVehicle[];
  /** True when the query found more rows than OPS_ROW_LIMIT and returned a page. */
  truncated?: Partial<Record<OpsSection["id"], boolean>>;
};

export function isScheduledPickup(row: Pick<OpsApplication, "status" | "pickup_date" | "deleted_at">, today: string): boolean {
  return row.deleted_at == null && row.pickup_date === today && (PICKUP_STATUSES as readonly string[]).includes(row.status);
}

export function isApprovedReady(row: Pick<OpsApplication, "status" | "deleted_at">): boolean {
  return row.deleted_at == null && row.status === "approved";
}

export function isReturnWindow(row: Pick<OpsRental, "status" | "end_date">, today: string, tomorrow: string): boolean {
  return row.status === "active" && (row.end_date === today || row.end_date === tomorrow);
}

export function isPaymentDueToday(row: Pick<OpsRental, "status" | "next_payment_due">, today: string): boolean {
  return row.status === "active" && row.next_payment_due === today;
}

export function isCollectionsWatchStatus(status: string | null | undefined): boolean {
  return WATCH.has(String(status ?? ""));
}

export function isOpenIncidentStatus(status: string | null | undefined): boolean {
  return !INCIDENT_CLOSED.has(String(status ?? "").toLowerCase());
}

export function isOpenRoadsideIssue(row: Pick<OpsIssue, "kind" | "status">): boolean {
  return ROADSIDE_KINDS.has(String(row.kind ?? "").toLowerCase()) && !isIssueClosed(row.status);
}

export function isInMaintenance(row: Pick<OpsVehicle, "status" | "archived_at">): boolean {
  return row.status === "maintenance" && row.archived_at == null;
}

export function vehicleOpsLabel(vehicle: {
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

const APP_STATUS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  approved: "Approved",
};

const PAYMENT_STATUS: Record<string, string> = {
  late: "Late",
  past_due: "Past Due",
  collections: "In Collections",
  overdue: "Overdue",
  failed: "Failed",
  unpaid: "Unpaid",
};

const INCIDENT_TYPE: Record<string, string> = {
  accident: "Accident",
  damage: "Damage",
  theft: "Theft",
  vandalism: "Vandalism",
  breakdown: "Breakdown",
  tow: "Tow",
  other: "Other",
};

function person(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || "Unnamed Driver";
}

function money(amount: number | null): string {
  if (amount == null || Number.isNaN(Number(amount))) return "";
  return Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function titled(raw: string | null | undefined, labels: Record<string, string>): string {
  const key = String(raw ?? "").toLowerCase();
  return labels[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function page<T>(rows: T[], truncated: boolean | undefined): { rows: T[]; truncated: boolean } {
  return {
    rows: rows.slice(0, OPS_ROW_LIMIT),
    truncated: Boolean(truncated) || rows.length > OPS_ROW_LIMIT,
  };
}

function section(id: string, title: string, items: OpsItem[], truncated: boolean): OpsSection {
  return { id, title, items, truncated };
}

export function buildTodaysOps(input: TodaysOpsInput): TodaysOpsBoard {
  const { today, tomorrow } = input;
  const caps = input.truncated ?? {};

  const pickups = page(uniqueById(input.applications.filter((row) => isScheduledPickup(row, today))), caps.pickups);
  const approved = page(uniqueById(input.applications.filter((row) => isApprovedReady(row))), caps.approved_ready);
  const returns = page(uniqueById(input.rentals.filter((row) => isReturnWindow(row, today, tomorrow))), caps.returns);
  const due = page(uniqueById(input.rentals.filter((row) => isPaymentDueToday(row, today))), caps.payments_due);
  const overdue = page(uniqueById(input.payments.filter((row) => isCollectionsWatchStatus(row.status))), caps.overdue);
  const documents = page(input.documents, caps.documents);
  const incidents = page(uniqueById(input.incidents.filter((row) => isOpenIncidentStatus(row.status))), caps.incidents);
  const roadside = page(uniqueById(input.issues.filter((row) => isOpenRoadsideIssue(row))), caps.roadside);
  const maintenance = page(uniqueById(input.vehicles.filter((row) => isInMaintenance(row))), caps.maintenance);

  return {
    today,
    tomorrow,
    heading: formatOpsDate(today),
    omitted: TODAYS_OPS_OMITTED,
    sections: [
      section(
        "pickups",
        "Scheduled Pickups",
        pickups.rows.map((row) => ({
          id: row.id,
          label: person(row.full_name),
          detail: APP_STATUS[row.status] ?? row.status,
          search: { tab: "drivers", id: row.id },
        })),
        pickups.truncated,
      ),
      section(
        "approved_ready",
        "Approved Ready",
        approved.rows.map((row) => ({
          id: row.id,
          label: person(row.full_name),
          detail: "Approved",
          search: { tab: "drivers", id: row.id },
        })),
        approved.truncated,
      ),
      section(
        "returns",
        "Returns Today And Tomorrow",
        returns.rows.map((row) => ({
          id: row.id,
          label: `${person(row.driver_name)} · ${row.vehicle_label?.trim() || "Vehicle"}`,
          detail: row.end_date === today ? "Ends Today" : "Ends Tomorrow",
          search: { tab: "bookings", id: row.id },
        })),
        returns.truncated,
      ),
      section(
        "payments_due",
        "Payments Due Today",
        due.rows.map((row) => ({
          id: row.id,
          label: `${person(row.driver_name)} · ${row.vehicle_label?.trim() || "Vehicle"}`,
          detail: "Due Today",
          search: { tab: "bookings", id: row.id },
        })),
        due.truncated,
      ),
      section(
        "overdue",
        "Overdue Payments",
        overdue.rows.map((row) => ({
          id: row.id,
          label: person(row.driver_name),
          detail: [PAYMENT_STATUS[row.status] ?? row.status, money(row.amount)].filter(Boolean).join(" · "),
          search: { tab: "payments", filter: "overdue" },
        })),
        overdue.truncated,
      ),
      section(
        "documents",
        "Documents Expiring",
        documents.rows.map((row) => ({
          id: `${row.vehicle_id}:${row.what}:${row.expires_on}`,
          label: row.label.trim() || "Vehicle",
          detail: documentDetail(row),
          search: { tab: "vehicles", id: row.vehicle_id },
        })),
        documents.truncated,
      ),
      section(
        "incidents",
        "Open Incidents",
        incidents.rows.map((row) => ({
          id: row.id,
          label: row.vehicle_label?.trim() || "Vehicle",
          detail: titled(row.incident_type, INCIDENT_TYPE),
          search: { tab: "incidents" },
        })),
        incidents.truncated,
      ),
      section(
        "roadside",
        "Roadside Issues",
        roadside.rows.map((row) => ({
          id: row.id,
          label: (row.title ?? "").trim() || "Roadside Issue",
          detail: titled(row.kind, { breakdown: "Breakdown", tow: "Tow" }),
          search: { tab: "driver_issues" },
        })),
        roadside.truncated,
      ),
      section(
        "maintenance",
        "In Maintenance",
        maintenance.rows.map((row) => ({
          id: row.id,
          label: row.label.trim() || "Vehicle",
          detail: "In Maintenance",
          search: { tab: "vehicles", id: row.id },
        })),
        maintenance.truncated,
      ),
    ],
  };
}

function documentDetail(row: OpsDocument): string {
  const when = row.days < 0 ? "Already Lapsed" : row.days === 0 ? "Expires Today" : `Expires In ${row.days} ${row.days === 1 ? "Day" : "Days"}`;
  return `${row.what} · ${when}`;
}
