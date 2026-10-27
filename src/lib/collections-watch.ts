import { matchDriver, type DriverMatchApplication, type DriverMatchRental } from "./stripe-driver-match";

/**
 * Read-only collections watch. Upcoming invoice preview is not called:
 * Stripe's preview is not a list or retrieve of an existing invoice.
 * Due dates in the next 7 days come from open invoices and from a
 * subscription's current period end.
 */

export const UPCOMING_INVOICE_NOTE = "Upcoming invoice preview is not listed. That Stripe call is not a list or retrieve.";
export const FAILED_CHARGE_DAYS = 30;
export const DUE_DAYS = 7;

export type WatchCustomer = { id: string; name: string | null; email: string | null; phone: string | null };
export type WatchSubscription = {
  id: string;
  status: "past_due" | "unpaid" | "active";
  customer: WatchCustomer;
  periodEnd: number | null;
  priceCents: number | null;
  amountRemainingCents: number | null;
  currency: string | null;
  dueAt: number | null;
  failureReason: string | null;
  failureAt: number | null;
};
export type WatchFailedCharge = {
  id: string;
  customer: WatchCustomer;
  amountCents: number | null;
  currency: string;
  created: number;
  failureReason: string | null;
};
export type WatchOpenInvoice = {
  id: string;
  customer: WatchCustomer;
  subscriptionId: string | null;
  amountRemainingCents: number | null;
  currency: string;
  dueAt: number;
};

export type WatchMatch = {
  driverId: string | null;
  driverName: string | null;
  phone: string | null;
  confidence: "high" | "medium" | "low" | null;
  reason: string;
};
export type OverdueRow = {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "past_due" | "unpaid";
  amountDueCents: number | null;
  daysOverdue: number | null;
  failureReason: string | null;
  match: WatchMatch;
};
export type FailedChargeRow = {
  id: string;
  createdDate: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amountCents: number | null;
  failureReason: string | null;
  match: WatchMatch;
};
export type DueSoonRow = {
  id: string;
  dueDate: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amountCents: number | null;
  source: "Open Invoice" | "Period End";
  match: WatchMatch;
};
export type CollectionsWatchReport = {
  overdue: OverdueRow[];
  failedCharges: FailedChargeRow[];
  dueSoon: DueSoonRow[];
  upcomingInvoiceNote: typeof UPCOMING_INVOICE_NOTE;
};

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Calendar days from the due instant to now, both in Eastern Time. Future due dates are 0. */
export function daysOverdueEt(dueUnix: number, now: Date): number | null {
  if (!Number.isSafeInteger(dueUnix) || dueUnix <= 0) return null;
  const due = etYmd(new Date(dueUnix * 1000));
  const today = etYmd(now);
  if (!due || !today) return null;
  const dueMs = Date.parse(`${due}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs)) return null;
  const days = Math.round((todayMs - dueMs) / 86400000);
  if (!Number.isSafeInteger(days)) return null;
  return days < 0 ? 0 : days;
}

export function watchWindows(now: Date): { failedGte: number; dueGte: number; dueLt: number } | null {
  const today = etYmd(now);
  if (!today) return null;
  const dueGte = etMidnightUnix(today);
  const dueEnd = addCalendarDays(today, DUE_DAYS);
  const failedStart = addCalendarDays(today, -FAILED_CHARGE_DAYS);
  const dueLt = dueEnd ? etMidnightUnix(dueEnd) : null;
  const failedGte = failedStart ? etMidnightUnix(failedStart) : null;
  if (dueGte === null || dueLt === null || failedGte === null || dueLt <= dueGte) return null;
  return { failedGte, dueGte, dueLt };
}

function addCalendarDays(ymd: string, days: number): string | null {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
}

function etMidnightUnix(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second")) - instant;
  };
  let utc = utcMidnight - offset(utcMidnight);
  const again = offset(utc);
  if (again !== offset(utcMidnight)) utc = utcMidnight - again;
  const seconds = Math.floor(utc / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function inDueWindow(unix: number, now: Date): boolean {
  const windows = watchWindows(now);
  if (!windows || !Number.isSafeInteger(unix)) return false;
  return unix >= windows.dueGte && unix < windows.dueLt;
}

function usd(cents: number | null, currency: string | null): number | null {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return null;
  if (currency && currency.toLowerCase() !== "usd") return null;
  return cents;
}

export function buildCollectionsWatch(input: {
  now: Date;
  applications: DriverMatchApplication[];
  rentals: DriverMatchRental[];
  subscriptions: WatchSubscription[];
  failedCharges: WatchFailedCharge[];
  openInvoices: WatchOpenInvoice[];
}): CollectionsWatchReport | null {
  const windows = watchWindows(input.now);
  if (!windows) return null;
  const match = (customer: WatchCustomer): WatchMatch => {
    const found = matchDriver({ applications: input.applications, rentals: input.rentals, customer });
    return { driverId: found.driverId, driverName: found.driverName, phone: found.phone, confidence: found.confidence, reason: found.reason };
  };
  const overdue: OverdueRow[] = input.subscriptions
    .filter((sub) => sub.status === "past_due" || sub.status === "unpaid")
    .map((sub) => ({
      id: sub.id,
      customerName: sub.customer.name,
      customerEmail: sub.customer.email,
      status: sub.status as "past_due" | "unpaid",
      amountDueCents: usd(sub.amountRemainingCents, sub.currency),
      daysOverdue: sub.dueAt === null ? null : daysOverdueEt(sub.dueAt, input.now),
      failureReason: sub.failureReason,
      match: match(sub.customer),
    }))
    .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || a.id.localeCompare(b.id));
  const failedCharges: FailedChargeRow[] = input.failedCharges
    .filter((charge) => charge.created >= windows.failedGte && charge.created < Math.floor(input.now.getTime() / 1000) + 1)
    .map((charge) => ({
      id: charge.id,
      createdDate: etYmd(new Date(charge.created * 1000)),
      customerName: charge.customer.name,
      customerEmail: charge.customer.email,
      amountCents: usd(charge.amountCents, charge.currency),
      failureReason: charge.failureReason,
      match: match(charge.customer),
    }))
    .sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? "") || a.id.localeCompare(b.id));
  const invoicedSubs = new Set(input.openInvoices.flatMap((invoice) => invoice.subscriptionId ? [invoice.subscriptionId] : []));
  const fromInvoices: DueSoonRow[] = input.openInvoices.filter((invoice) => inDueWindow(invoice.dueAt, input.now)).map((invoice) => ({
    id: invoice.id,
    dueDate: etYmd(new Date(invoice.dueAt * 1000)),
    customerName: invoice.customer.name,
    customerEmail: invoice.customer.email,
    amountCents: usd(invoice.amountRemainingCents, invoice.currency),
    source: "Open Invoice" as const,
    match: match(invoice.customer),
  }));
  const fromPeriods: DueSoonRow[] = input.subscriptions
    .filter((sub) => sub.status === "active" && sub.periodEnd !== null && inDueWindow(sub.periodEnd, input.now) && !invoicedSubs.has(sub.id))
    .map((sub) => ({
      id: sub.id,
      dueDate: etYmd(new Date((sub.periodEnd as number) * 1000)),
      customerName: sub.customer.name,
      customerEmail: sub.customer.email,
      amountCents: usd(sub.priceCents, "usd"),
      source: "Period End" as const,
      match: match(sub.customer),
    }));
  const dueSoon = [...fromInvoices, ...fromPeriods].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.id.localeCompare(b.id));
  return { overdue, failedCharges, dueSoon, upcomingInvoiceNote: UPCOMING_INVOICE_NOTE };
}

/**
 * Payments statuses the Overview card and the Payments overdue filter share.
 * `current` is issued and not yet due, so it is absent. This list does not call Stripe.
 */
export const COLLECTIONS_WATCH_STATUSES = [
  "late",
  "past_due",
  "collections",
  "overdue",
  "failed",
  "unpaid",
] as const;

export type CollectionsWatchPaymentStatus = (typeof COLLECTIONS_WATCH_STATUSES)[number];
