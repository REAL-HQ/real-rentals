/**
 * Read-only comparison of active rentals and Stripe subscriptions.
 * Display only: nothing here writes a rental, a subscription, or an email.
 */

import { calendarDaysBetween, dateOnly, formatBoardDate, formatWeeklyRate } from "./active-rentals";
import { escapeCsvCell } from "./driver-statement";
import { etYmd } from "./weekly-cash-flow";

export const REASON_NO_SUBSCRIPTION = "This active rental has no Stripe subscription.";
export const REASON_PAST_DUE = "The Stripe subscription is past due while this rental is active.";
export const REASON_UNPAID = "The Stripe subscription is unpaid while this rental is active.";
export const REASON_INCOMPLETE = "The Stripe subscription is incomplete while this rental is active.";
export const REASON_CANCELED = "The Stripe subscription is canceled while this rental is active.";
export const REASON_AMOUNT = "The Stripe subscription amount differs from the rental weekly rate.";
export const REASON_AMOUNT_UNREAD = "The Stripe subscription amount could not be read as a weekly USD price.";
export const REASON_DUE = "The next payment due is more than 1 day off from the subscription period end.";
export const REASON_DUE_UNREAD = "The next payment due or the subscription period end could not be read, so they are not within 1 day.";
export const REASON_OVERBILLING = "This active Stripe subscription has no active rental. Possible overbilling.";
export const REASON_AMBIGUOUS = "This active rental has more than one Stripe subscription.";
export const BILLING_PAGE_CAP = "Stripe Reader Page Cap Reached. Billing Health Is Not Shown.";
export const BILLING_RENTAL_CAP = "Rental Page Cap Reached. Billing Health Is Not Shown.";

const NAMED_STATUS: Record<string, string> = {
  past_due: REASON_PAST_DUE,
  unpaid: REASON_UNPAID,
  incomplete: REASON_INCOMPLETE,
  canceled: REASON_CANCELED,
  cancelled: REASON_CANCELED,
};

export type BillingRental = {
  id: string;
  status: string;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  applicationId: string | null;
  driverName: string;
  vehicleLabel: string;
};

export type BillingSubscription = {
  id: string;
  status: string;
  customerId: string;
  customerName: string | null;
  periodEnd: number | null;
  weeklyAmountCents: number | null;
};

export type BillingDriverLink = {
  customerId: string;
  applicationId: string;
  driverName: string;
};

export type BillingMismatchKind = "no_subscription" | "status" | "amount" | "due_date" | "overbilling" | "ambiguous";

export type BillingMismatch = {
  id: string;
  kind: BillingMismatchKind;
  reason: string;
  rentalId: string | null;
  applicationId: string | null;
  driverName: string;
  vehicleLabel: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  customerId: string | null;
  weeklyRate: string;
  subscriptionAmount: string;
  nextPaymentDue: string;
  periodEnd: string;
};

export type BillingHealthReport = {
  mismatches: BillingMismatch[];
  warnings: string[];
  activeRentals: number | null;
  subscriptions: number | null;
};

export function periodEndDate(unixSeconds: number | null): string | null {
  if (unixSeconds == null || !Number.isSafeInteger(unixSeconds)) return null;
  return etYmd(new Date(unixSeconds * 1000));
}

/** More than one Eastern Time calendar day. Exactly one day stays in tolerance. */
export function dueDatesDiffer(nextPaymentDue: string | null, periodEndUnix: number | null): boolean {
  const days = calendarDaysBetween(dateOnly(nextPaymentDue), periodEndDate(periodEndUnix));
  if (days == null) return true;
  return Math.abs(days) > 1;
}

export function weeklyRateCents(amount: number | null): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function buildBillingHealth(input: {
  rentals: BillingRental[];
  subscriptions: BillingSubscription[];
  driverLinks?: BillingDriverLink[];
}): BillingHealthReport {
  const subsById = new Map<string, BillingSubscription>();
  const subsByCustomer = new Map<string, BillingSubscription[]>();
  for (const sub of input.subscriptions) {
    if (!sub.id || subsById.has(sub.id)) continue;
    subsById.set(sub.id, sub);
    const rows = subsByCustomer.get(sub.customerId) ?? [];
    rows.push(sub);
    subsByCustomer.set(sub.customerId, rows);
  }
  const drivers = driverIndex(input.driverLinks ?? []);
  const claimed = new Set<string>();
  const mismatches: BillingMismatch[] = [];
  let activeRentals = 0;
  for (const rental of input.rentals) {
    if (rental.status.trim().toLowerCase() !== "active") continue;
    activeRentals += 1;
    const subId = text(rental.stripeSubscriptionId);
    const customerId = text(rental.stripeCustomerId);
    if (subId) {
      const matched = subsById.get(subId) ?? null;
      if (!matched) {
        mismatches.push(row(rental, null, "no_subscription", REASON_NO_SUBSCRIPTION));
        continue;
      }
      claimed.add(matched.id);
      mismatches.push(...compare(rental, matched));
      continue;
    }
    if (customerId) {
      const rows = subsByCustomer.get(customerId) ?? [];
      if (rows.length === 0) {
        mismatches.push(row(rental, null, "no_subscription", REASON_NO_SUBSCRIPTION));
        continue;
      }
      if (rows.length > 1) {
        for (const sub of rows) claimed.add(sub.id);
        mismatches.push(row(rental, null, "ambiguous", REASON_AMBIGUOUS));
        continue;
      }
      claimed.add(rows[0].id);
      mismatches.push(...compare(rental, rows[0]));
      continue;
    }
    mismatches.push(row(rental, null, "no_subscription", REASON_NO_SUBSCRIPTION));
  }
  const orphans = [...subsById.values()]
    .filter((sub) => sub.status === "active" && !claimed.has(sub.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const sub of orphans) {
    const driver = drivers.get(sub.customerId) ?? null;
    mismatches.push({
      id: `overbilling:${sub.id}`,
      kind: "overbilling",
      reason: REASON_OVERBILLING,
      rentalId: null,
      applicationId: driver?.applicationId ?? null,
      driverName: driver?.driverName ?? sub.customerName ?? "Stripe Customer",
      vehicleLabel: "No Vehicle",
      subscriptionId: sub.id,
      subscriptionStatus: "active",
      customerId: sub.customerId,
      weeklyRate: "No Rental",
      subscriptionAmount: moneyCents(sub.weeklyAmountCents),
      nextPaymentDue: "No Rental",
      periodEnd: formatBoardDate(periodEndDate(sub.periodEnd)) || "Not Read",
    });
  }
  return { mismatches, warnings: [], activeRentals, subscriptions: subsById.size };
}

export function billingHealthToCsv(report: BillingHealthReport): string {
  const header = ["Driver", "Vehicle", "Reason", "Booking", "Driver Screen", "Subscription", "Subscription Status", "Customer", "Weekly Rate", "Subscription Amount", "Next Payment Due", "Period End"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of report.mismatches) {
    lines.push([
      row.driverName,
      row.vehicleLabel,
      row.reason,
      row.rentalId ? `/admin?tab=bookings&id=${encodeURIComponent(row.rentalId)}` : "",
      row.applicationId ? `/admin?tab=drivers&id=${encodeURIComponent(row.applicationId)}` : "",
      row.subscriptionId ?? "",
      row.subscriptionStatus ?? "",
      row.customerId ?? "",
      row.weeklyRate,
      row.subscriptionAmount,
      row.nextPaymentDue,
      row.periodEnd,
    ].map(escapeCsvCell).join(","));
  }
  for (const warning of report.warnings) lines.push([warning, "", "", "", "", "", "", "", "", "", "", ""].map(escapeCsvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function compare(rental: BillingRental, sub: BillingSubscription): BillingMismatch[] {
  const found: BillingMismatch[] = [];
  if (sub.status !== "active") found.push(row(rental, sub, "status", statusReason(sub.status)));
  const rentalCents = weeklyRateCents(rental.weeklyRate);
  if (rentalCents === null || sub.weeklyAmountCents === null) {
    found.push(row(rental, sub, "amount", sub.weeklyAmountCents === null ? REASON_AMOUNT_UNREAD : REASON_AMOUNT));
  } else if (rentalCents !== sub.weeklyAmountCents) {
    found.push(row(rental, sub, "amount", REASON_AMOUNT));
  }
  const unread = calendarDaysBetween(dateOnly(rental.nextPaymentDue), periodEndDate(sub.periodEnd)) == null;
  if (dueDatesDiffer(rental.nextPaymentDue, sub.periodEnd)) {
    found.push(row(rental, sub, "due_date", unread ? REASON_DUE_UNREAD : REASON_DUE));
  }
  return found;
}

function statusReason(status: string): string {
  return NAMED_STATUS[status] ?? "The Stripe subscription is not active while this rental is active.";
}

function row(rental: BillingRental, sub: BillingSubscription | null, kind: BillingMismatchKind, reason: string): BillingMismatch {
  return {
    id: `${kind}:${rental.id}:${sub?.id ?? "none"}`,
    kind,
    reason,
    rentalId: rental.id,
    applicationId: text(rental.applicationId),
    driverName: rental.driverName || "Driver",
    vehicleLabel: rental.vehicleLabel || "Vehicle",
    subscriptionId: sub?.id ?? null,
    subscriptionStatus: sub?.status ?? null,
    customerId: sub?.customerId ?? text(rental.stripeCustomerId),
    weeklyRate: formatWeeklyRate(rental.weeklyRate),
    subscriptionAmount: moneyCents(sub?.weeklyAmountCents ?? null),
    nextPaymentDue: formatBoardDate(rental.nextPaymentDue) || "No Due Date",
    periodEnd: formatBoardDate(periodEndDate(sub?.periodEnd ?? null)) || "Not Read",
  };
}

function driverIndex(links: BillingDriverLink[]): Map<string, BillingDriverLink> {
  const counts = new Map<string, number>();
  for (const link of links) {
    const id = text(link.customerId);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const index = new Map<string, BillingDriverLink>();
  for (const link of links) {
    const id = text(link.customerId);
    if (!id || counts.get(id) !== 1 || index.has(id)) continue;
    index.set(id, link);
  }
  return index;
}

function moneyCents(cents: number | null): string {
  if (cents === null) return "Not A Weekly USD Price";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
