/**
 * Team Collections Plan — pure helpers for the daily due-today / due-tomorrow
 * digest. Method is never assumed to be Zelle: autopay/Stripe if linked, else
 * the last recorded payment_method, else "Not specified".
 *
 * Sources are reconciled: active rental next_payment_due schedule plus unpaid
 * payment rows for the same days, deduped so a rental does not appear twice.
 */
import { UNPAID_STATUSES } from "./payment-reminders";

export const COLLECTIONS_PLAN_METHOD_UNSPECIFIED = "Not specified";
export const COLLECTIONS_PLAN_METHOD_AUTOPAY = "Autopay / Stripe";

export type CollectionsPlanRental = {
  id: string;
  applicationId: string | null;
  status: string;
  nextPaymentDue: string | null;
  weeklyRate: number | null;
  autopayActive: boolean;
  stripeSubscriptionId: string | null;
  stripePaymentMethodId: string | null;
  driverName: string | null;
  vehicleLabel: string | null;
  plate: string | null;
};

export type CollectionsPlanPayment = {
  id: string;
  rentalId: string | null;
  driverId: string | null;
  dueDate: string | null;
  amount: number | null;
  balanceDue: number | null;
  status: string;
  paymentMethod: string | null;
  type: string | null;
  driverName: string | null;
  vehicleLabel: string | null;
  plate: string | null;
};

export type CollectionsPlanItem = {
  key: string;
  dueDate: string;
  bucket: "today" | "tomorrow";
  renterName: string;
  vehicleLabel: string;
  plate: string | null;
  amount: number;
  method: string;
  autopay: boolean;
  applicationId: string | null;
  rentalId: string | null;
  adminPath: string;
};

export type CollectionsPlan = {
  today: string;
  tomorrow: string;
  dueToday: CollectionsPlanItem[];
  dueTomorrow: CollectionsPlanItem[];
};

export function resolveExpectedMethod(input: {
  autopayActive?: boolean | null;
  stripeSubscriptionId?: string | null;
  stripePaymentMethodId?: string | null;
  lastPaymentMethod?: string | null;
}): string {
  if (input.autopayActive || filled(input.stripeSubscriptionId) || filled(input.stripePaymentMethodId)) {
    return COLLECTIONS_PLAN_METHOD_AUTOPAY;
  }
  const last = normalizeMethod(input.lastPaymentMethod);
  return last || COLLECTIONS_PLAN_METHOD_UNSPECIFIED;
}

export function buildCollectionsPlan(input: {
  today: string;
  tomorrow: string;
  rentals: CollectionsPlanRental[];
  unpaidPayments: CollectionsPlanPayment[];
  /** Most recent paid payment_method by rental id or application/driver id. */
  lastMethodByRentalId?: Record<string, string | null | undefined>;
  lastMethodByDriverId?: Record<string, string | null | undefined>;
}): CollectionsPlan {
  const byKey = new Map<string, CollectionsPlanItem>();

  for (const rental of input.rentals) {
    if (rental.status.trim().toLowerCase() !== "active") continue;
    const due = dateOnly(rental.nextPaymentDue);
    if (!due || (due !== input.today && due !== input.tomorrow)) continue;
    const amount = Number(rental.weeklyRate ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const method = resolveExpectedMethod({
      autopayActive: rental.autopayActive,
      stripeSubscriptionId: rental.stripeSubscriptionId,
      stripePaymentMethodId: rental.stripePaymentMethodId,
      lastPaymentMethod:
        (rental.id && input.lastMethodByRentalId?.[rental.id]) ||
        (rental.applicationId && input.lastMethodByDriverId?.[rental.applicationId]) ||
        null,
    });
    const item = makeItem({
      key: `rental:${rental.id}:${due}`,
      dueDate: due,
      bucket: due === input.today ? "today" : "tomorrow",
      renterName: displayName(rental.driverName),
      vehicleLabel: rental.vehicleLabel?.trim() || "Vehicle",
      plate: rental.plate,
      amount,
      method,
      autopay: method === COLLECTIONS_PLAN_METHOD_AUTOPAY,
      applicationId: rental.applicationId,
      rentalId: rental.id,
    });
    byKey.set(item.key, item);
  }

  const dueStatuses = new Set<string>([...UNPAID_STATUSES, "upcoming", "pending", "current"]);
  for (const payment of input.unpaidPayments) {
    if (!dueStatuses.has(payment.status)) continue;
    const due = dateOnly(payment.dueDate);
    if (!due || (due !== input.today && due !== input.tomorrow)) continue;
    if (String(payment.type ?? "rent").toLowerCase() === "deposit") continue;
    const amount = Number(payment.balanceDue ?? 0) || Number(payment.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    // Prefer the rental schedule row when both exist for the same rental + day.
    if (payment.rentalId) {
      const rentalKey = `rental:${payment.rentalId}:${due}`;
      if (byKey.has(rentalKey)) continue;
    }

    const method = resolveExpectedMethod({
      lastPaymentMethod:
        payment.paymentMethod ||
        (payment.rentalId && input.lastMethodByRentalId?.[payment.rentalId]) ||
        (payment.driverId && input.lastMethodByDriverId?.[payment.driverId]) ||
        null,
    });
    const item = makeItem({
      key: payment.rentalId ? `rental:${payment.rentalId}:${due}` : `payment:${payment.id}`,
      dueDate: due,
      bucket: due === input.today ? "today" : "tomorrow",
      renterName: displayName(payment.driverName),
      vehicleLabel: payment.vehicleLabel?.trim() || "Vehicle",
      plate: payment.plate,
      amount,
      method,
      autopay: method === COLLECTIONS_PLAN_METHOD_AUTOPAY,
      applicationId: payment.driverId,
      rentalId: payment.rentalId,
    });
    if (!byKey.has(item.key)) byKey.set(item.key, item);
  }

  const all = [...byKey.values()].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) ||
    a.renterName.localeCompare(b.renterName) ||
    a.key.localeCompare(b.key),
  );
  return {
    today: input.today,
    tomorrow: input.tomorrow,
    dueToday: all.filter((row) => row.bucket === "today"),
    dueTomorrow: all.filter((row) => row.bucket === "tomorrow"),
  };
}

export function collectionsPlanKind(today: string): string {
  return `collections_plan:${today}`;
}

export function collectionsPlanBellBody(plan: CollectionsPlan): string {
  const todayN = plan.dueToday.length;
  const tomorrowN = plan.dueTomorrow.length;
  const todayAmt = plan.dueToday.reduce((s, r) => s + r.amount, 0);
  const tomorrowAmt = plan.dueTomorrow.reduce((s, r) => s + r.amount, 0);
  return `Today ${todayN} ($${todayAmt.toFixed(2)}) · Tomorrow ${tomorrowN} ($${tomorrowAmt.toFixed(2)})`;
}

function makeItem(row: Omit<CollectionsPlanItem, "adminPath">): CollectionsPlanItem {
  const adminPath = row.applicationId
    ? `/admin?tab=drivers&id=${encodeURIComponent(row.applicationId)}`
    : "/admin?tab=payments";
  return { ...row, adminPath };
}

function normalizeMethod(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // Never invent Zelle — only echo what was recorded, title-cased lightly.
  if (/^zelle$/i.test(raw)) return "Zelle";
  if (/^cash\s*app$/i.test(raw)) return "Cash App";
  if (/^venmo$/i.test(raw)) return "Venmo";
  if (/^cash$/i.test(raw)) return "Cash";
  if (/^wire|ach|bank/i.test(raw)) return "Bank Transfer";
  if (/^stripe|card|visa|master|amex/i.test(raw)) return "Card / Stripe";
  return raw.length > 40 ? raw.slice(0, 40) : raw;
}

function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || "Unknown renter";
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function dateOnly(value: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return match ? match[1]! : null;
}
