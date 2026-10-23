/**
 * Dark gate for the Overview Today list.
 *
 * false: Overview does not mount the card and the server returns before any
 * role check or read.
 * true: managers see one card of today's Eastern work.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 *
 * Typed as boolean so the enabled branch stays visible to the type checker.
 */
export const OVERVIEW_TODAY_ENABLED: boolean = false;

import { bookingPhase } from "@/lib/bookings-list";
import { isIssueClosed } from "@/lib/driver-issues";
import { leadToday, overdueAge } from "@/lib/lead-priorities";

/** Same charge states as payment collection. Copied here so this module does not import Stripe. */
export const TODAY_OUTSTANDING_STATUSES = [
  "pending",
  "failed",
  "late",
  "overdue",
  "past_due",
  "unpaid",
  "collections",
  "current",
] as const;

const OUTSTANDING = new Set<string>(TODAY_OUTSTANDING_STATUSES);
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const ROW_CAP = 6;

export type TodayKind = "rent_due" | "rent_overdue" | "pickup" | "return" | "document" | "issue";

export type TodayLink = {
  tab: "bookings" | "drivers" | "vehicles" | "driver_issues";
  id?: string;
};

export type TodayItem = {
  kind: TodayKind;
  id: string;
  title: string;
  detail: string | null;
  amount: number | null;
  daysOverdue: number | null;
  link: TodayLink;
};

export type TodaySection = {
  kind: TodayKind;
  title: string;
  count: number;
  items: TodayItem[];
};

export type TodayPayment = {
  id: string;
  type: string | null;
  status: string | null;
  amount: unknown;
  balance_due: unknown;
  due_date: string | null;
  driver_id: string | null;
  rental_id: string | null;
};

export type TodayRental = {
  id: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  application_id: string | null;
};

export type TodayVehicleDate = {
  id: string;
  label: string;
  what: string;
  expires_on: string | null;
};

export type TodayDocument = {
  id: string;
  vehicle_id: string | null;
  label: string;
  what: string;
  expires_on: string | null;
};

export type TodayIssue = {
  id: string;
  title: string | null;
  status: string | null;
  driver_id: string | null;
  rental_id: string | null;
};

export type TodayApplication = {
  id: string;
  full_name: string | null;
  user_id: string | null;
};

export type TodaySources = {
  payments: TodayPayment[];
  rentals: TodayRental[];
  vehicleDates: TodayVehicleDate[];
  documents: TodayDocument[];
  issues: TodayIssue[];
  applications: TodayApplication[];
};

export type TodayDeps = {
  enabled: boolean;
  userId: string;
  now?: Date;
  requireManager: (userId: string) => Promise<void>;
  read: (today: string) => Promise<TodaySources>;
};

/** Calendar day in America/New_York. A date-only string stays that day. */
export function easternDay(value: string | Date): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : leadToday(value);
  if (DATE_ONLY.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return leadToday(parsed);
}

export function addCalendarDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Balance when it is a positive number, otherwise the charge amount. */
export function owedAmount(row: { amount: unknown; balance_due: unknown }): number | null {
  const balance = row.balance_due == null ? NaN : Number(row.balance_due);
  const amount = Number.isFinite(balance) && balance > 0 ? balance : Number(row.amount ?? NaN);
  return Number.isFinite(amount) ? amount : null;
}

function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function section(kind: TodayKind, title: string, items: TodayItem[]): TodaySection {
  return { kind, title, count: items.length, items: items.slice(0, ROW_CAP) };
}

function appName(apps: TodayApplication[], id: string | null): string | null {
  if (!id) return null;
  const row = apps.find((app) => app.id === id);
  const name = row?.full_name?.trim();
  return name || null;
}

function issueDriver(apps: TodayApplication[], userId: string | null): TodayApplication | undefined {
  if (!userId) return undefined;
  return apps.find((app) => app.user_id === userId);
}

export function buildTodayItems(sources: TodaySources, today: string): TodaySection[] {
  const horizon = addCalendarDays(today, 7);
  const rentDue: TodayItem[] = [];
  const rentOverdue: TodayItem[] = [];
  for (const row of sources.payments) {
    if (row.type !== "rent" || !OUTSTANDING.has(String(row.status ?? ""))) continue;
    if (!row.due_date) continue;
    const due = easternDay(row.due_date);
    if (!due) continue;
    const amount = owedAmount(row);
    const name = appName(sources.applications, row.driver_id) ?? "Rent";
    const link: TodayLink = row.rental_id
      ? { tab: "bookings", id: row.rental_id }
      : row.driver_id
        ? { tab: "drivers", id: row.driver_id }
        : { tab: "bookings" };
    if (due === today) {
      rentDue.push({
        kind: "rent_due",
        id: row.id,
        title: name,
        detail: amount === null ? null : money(amount),
        amount,
        daysOverdue: null,
        link,
      });
    } else if (due < today) {
      const age = overdueAge(due, today);
      const days = age ? Number(age.split(" ")[0]) : null;
      rentOverdue.push({
        kind: "rent_overdue",
        id: row.id,
        title: name,
        detail: amount === null ? age : age ? `${money(amount)} · ${age}` : money(amount),
        amount,
        daysOverdue: days,
        link,
      });
    }
  }

  const pickups: TodayItem[] = [];
  const returns: TodayItem[] = [];
  for (const row of sources.rentals) {
    if (bookingPhase(row.status) === "cancelled") continue;
    const name = appName(sources.applications, row.application_id) ?? "Rental";
    const link: TodayLink = { tab: "bookings", id: row.id };
    const start = row.start_date ? easternDay(row.start_date) : null;
    const end = row.end_date ? easternDay(row.end_date) : null;
    if (start === today) {
      pickups.push({ kind: "pickup", id: row.id, title: name, detail: "Pickup", amount: null, daysOverdue: null, link });
    }
    if (end === today) {
      returns.push({ kind: "return", id: `${row.id}:return`, title: name, detail: "Return", amount: null, daysOverdue: null, link });
    }
  }

  const documents: TodayItem[] = [];
  const pushDoc = (id: string, vehicleId: string | null, label: string, what: string, expires: string | null) => {
    if (!expires) return;
    const day = easternDay(expires);
    if (!day || day < today || day > horizon) return;
    documents.push({
      kind: "document",
      id,
      title: label || "Vehicle",
      detail: what,
      amount: null,
      daysOverdue: null,
      link: vehicleId ? { tab: "vehicles", id: vehicleId } : { tab: "vehicles" },
    });
  };
  for (const row of sources.vehicleDates) pushDoc(`${row.id}:${row.what}`, row.id, row.label, row.what, row.expires_on);
  for (const row of sources.documents) pushDoc(row.id, row.vehicle_id, row.label, row.what, row.expires_on);

  const issues: TodayItem[] = [];
  for (const row of sources.issues) {
    if (isIssueClosed(row.status)) continue;
    const driver = issueDriver(sources.applications, row.driver_id);
    const link: TodayLink = driver
      ? { tab: "drivers", id: driver.id }
      : row.rental_id
        ? { tab: "bookings", id: row.rental_id }
        : { tab: "driver_issues" };
    issues.push({
      kind: "issue",
      id: row.id,
      title: row.title?.trim() || "Driver Issue",
      detail: driver?.full_name?.trim() || null,
      amount: null,
      daysOverdue: null,
      link,
    });
  }

  return [
    section("rent_due", "Rent Due Today", rentDue),
    section("rent_overdue", "Rent Overdue", rentOverdue),
    section("pickup", "Pickups Today", pickups),
    section("return", "Returns Today", returns),
    section("document", "Documents Expiring", documents),
    section("issue", "Open Driver Issues", issues),
  ];
}

/** Returns before the role check and before any read while the flag is off. */
export async function loadOverviewToday(deps: TodayDeps): Promise<
  | { ok: false; error: string }
  | { ok: true; today: string; sections: TodaySection[] }
> {
  if (!deps.enabled) return { ok: false, error: "Overview Today is disabled." };
  await deps.requireManager(deps.userId);
  const today = leadToday(deps.now ?? new Date());
  const sources = await deps.read(today);
  return { ok: true, today, sections: buildTodayItems(sources, today) };
}
