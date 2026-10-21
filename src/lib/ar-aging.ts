/**
 * Read-only receivables aging. Money is copied into the result.
 * Collected follows the combined Revenue definition in paymentRevenue and
 * consolidatedRevenue: verified Stripe net after refunds and fees, plus paid
 * or refunded revenue that is not tied to a Stripe payment intent.
 * Rent billed is the rent charge. Deposits are not included.
 * Nothing here writes a payment or calls Stripe.
 */

import { REVENUE_TYPES } from "./revenue-report";

export const AR_PAGE_CAP =
  "Receivables passed the page cap. Totals are withheld so a partial read cannot understate what is owed.";

export const AR_STRIPE_CAP =
  "Stripe checks passed the retrieve cap. Collected amounts that depend on Stripe are unknown.";

export const AR_STRIPE_UNAVAILABLE =
  "Stripe check unavailable. Collected amounts that depend on Stripe are unknown.";

export const AR_STRIPE_RETRIEVE_CAP = 100;

const EXCLUDED = new Set(["void", "waived", "cancelled", "canceled"]);
const COLLECTED_STATUS = new Set(["paid", "refunded"]);

export type AgingDriver = { id: string; name: string; status: string };

export type AgingPayment = {
  id: string;
  driverId: string | null;
  type: string;
  status: string;
  amountCents: number | null;
  netCollectedCents: number | null;
  stripePaymentIntentId: string | null;
  dueDate: string | null;
};

export type AgingStripeNet = { paymentIntentId: string; netCents: number };

export type AgingRow = {
  driverId: string;
  driver: string;
  rentBilledCents: number | null;
  collectedCents: number | null;
  balanceCents: number | null;
  bucket0Cents: number | null;
  bucket8Cents: number | null;
  bucket31Cents: number | null;
  bucket60Cents: number | null;
  notYetDueCents: number | null;
};

export type AgingReport = {
  today: string;
  rows: AgingRow[];
  rentBilledCents: number | null;
  collectedCents: number | null;
  balanceCents: number | null;
  bucket0Cents: number | null;
  bucket8Cents: number | null;
  bucket31Cents: number | null;
  bucket60Cents: number | null;
  notYetDueCents: number | null;
  warnings: string[];
};

export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Dollars to integer cents. Blank, negative, or more than two decimals stays null. Zero stays zero. */
export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function cappedArAging(today: string): AgingReport | null {
  const day = dateOnly(today);
  if (!day) return null;
  return emptyReport(day, [AR_PAGE_CAP], true);
}

export function buildArAging(input: {
  today: string;
  drivers: AgingDriver[];
  payments: AgingPayment[];
  stripeNets: AgingStripeNet[];
  stripeUnavailable?: boolean;
  warnings?: string[];
}): AgingReport | null {
  const today = dateOnly(input.today);
  if (!today) return null;
  const nets = new Map(input.stripeNets.map((net) => [net.paymentIntentId, net.netCents]));
  const active = input.drivers.filter((driver) => driver.status.trim().toLowerCase() === "active");
  const rows = active
    .map((driver) => rowFor(driver, input.payments.filter((payment) => payment.driverId === driver.id), nets, today, input.stripeUnavailable === true))
    .sort((a, b) => a.driver.localeCompare(b.driver) || a.driverId.localeCompare(b.driverId));
  return { today, rows, warnings: input.warnings ?? [], ...totals(rows) };
}

function rowFor(
  driver: AgingDriver,
  payments: AgingPayment[],
  nets: Map<string, number>,
  today: string,
  stripeUnavailable: boolean,
): AgingRow {
  const name = driver.name.trim() || "Driver";
  let rentBilled = 0;
  let billedKnown = true;
  const intentCounts = new Map<string, number>();
  let nonStripe = 0;
  let collectedKnown = true;
  const intentNet = new Map<string, number>();

  for (const payment of payments) {
    if (payment.type === "rent" && !EXCLUDED.has(payment.status.trim().toLowerCase())) {
      if (payment.amountCents == null) billedKnown = false;
      else {
        const next = add(rentBilled, payment.amountCents);
        if (next == null) billedKnown = false;
        else rentBilled = next;
      }
    }
    if (!countsAsCollected(payment)) continue;
    const intent = payment.stripePaymentIntentId;
    if (intent) {
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
      if (stripeUnavailable) {
        collectedKnown = false;
        continue;
      }
      const net = nets.get(intent);
      if (net == null) collectedKnown = false;
      else intentNet.set(intent, net);
      continue;
    }
    if (payment.netCollectedCents == null) collectedKnown = false;
    else {
      const next = add(nonStripe, payment.netCollectedCents);
      if (next == null) collectedKnown = false;
      else nonStripe = next;
    }
  }

  const rentBilledCents = billedKnown ? rentBilled : null;
  let collectedCents: number | null = collectedKnown ? nonStripe : null;
  if (collectedCents != null) {
    for (const net of intentNet.values()) {
      const next: number | null = add(collectedCents, net);
      collectedCents = next;
      if (collectedCents == null) break;
    }
  }
  const balanceCents = rentBilledCents == null || collectedCents == null ? null : add(rentBilledCents, -collectedCents);

  const placed = placeBalance({
    payments,
    nets,
    stripeUnavailable,
    collectedKnown,
    billedKnown,
    collectedCents,
    balanceCents,
    sharedIntent: [...intentCounts.values()].some((count) => count > 1),
    today,
  });

  return {
    driverId: driver.id,
    driver: name,
    rentBilledCents,
    collectedCents,
    balanceCents,
    ...placed,
  };
}

function placeBalance(input: {
  payments: AgingPayment[];
  nets: Map<string, number>;
  stripeUnavailable: boolean;
  collectedKnown: boolean;
  billedKnown: boolean;
  collectedCents: number | null;
  balanceCents: number | null;
  sharedIntent: boolean;
  today: string;
}): Pick<AgingRow, "bucket0Cents" | "bucket8Cents" | "bucket31Cents" | "bucket60Cents" | "notYetDueCents"> {
  const unknown = {
    bucket0Cents: null,
    bucket8Cents: null,
    bucket31Cents: null,
    bucket60Cents: null,
    notYetDueCents: null,
  };
  if (!input.billedKnown || !input.collectedKnown || input.balanceCents == null || input.collectedCents == null || input.sharedIntent) return unknown;
  if (input.balanceCents <= 0) return { bucket0Cents: 0, bucket8Cents: 0, bucket31Cents: 0, bucket60Cents: 0, notYetDueCents: 0 };

  const opens: { remaining: number; days: number | null }[] = [];
  let rentCollected = 0;
  for (const payment of input.payments) {
    if (payment.type !== "rent" || EXCLUDED.has(payment.status.trim().toLowerCase())) continue;
    if (payment.amountCents == null) return unknown;
    const own = ownCollected(payment, input.nets, input.stripeUnavailable);
    if (own == null) return unknown;
    const nextCollected = add(rentCollected, own);
    if (nextCollected == null) return unknown;
    rentCollected = nextCollected;
    const remaining = add(payment.amountCents, -own);
    if (remaining == null) return unknown;
    opens.push({ remaining, days: ageDays(payment.dueDate, input.today) });
  }
  let credit = add(input.collectedCents, -rentCollected);
  if (credit == null) return unknown;
  for (const open of opens) {
    if (open.remaining < 0) {
      const next = add(credit, -open.remaining);
      if (next == null) return unknown;
      credit = next;
      open.remaining = 0;
    }
  }
  const past = opens.filter((open) => open.days != null && open.days >= 0).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  const future = opens.filter((open) => open.days != null && open.days < 0);
  for (const open of [...past, ...future]) {
    if (open.remaining <= 0 || credit <= 0) continue;
    const use = Math.min(credit, open.remaining);
    open.remaining -= use;
    credit -= use;
  }

  const buckets = { bucket0Cents: 0, bucket8Cents: 0, bucket31Cents: 0, bucket60Cents: 0, notYetDueCents: 0 };
  for (const open of opens) {
    if (open.remaining === 0) continue;
    if (open.remaining < 0 || open.days == null) return unknown;
    const key = bucketKey(open.days);
    if (!key) return unknown;
    const next = add(buckets[key], open.remaining);
    if (next == null) return unknown;
    buckets[key] = next;
  }
  return buckets;
}

function ownCollected(payment: AgingPayment, nets: Map<string, number>, stripeUnavailable: boolean): number | null {
  if (!COLLECTED_STATUS.has(payment.status.trim().toLowerCase())) return 0;
  if (payment.stripePaymentIntentId) {
    if (stripeUnavailable) return null;
    return nets.get(payment.stripePaymentIntentId) ?? null;
  }
  return payment.netCollectedCents;
}

function countsAsCollected(payment: AgingPayment): boolean {
  return COLLECTED_STATUS.has(payment.status.trim().toLowerCase()) && (REVENUE_TYPES as readonly string[]).includes(payment.type);
}

function bucketKey(days: number): "bucket0Cents" | "bucket8Cents" | "bucket31Cents" | "bucket60Cents" | "notYetDueCents" | null {
  if (!Number.isSafeInteger(days)) return null;
  if (days < 0) return "notYetDueCents";
  if (days <= 7) return "bucket0Cents";
  if (days <= 30) return "bucket8Cents";
  if (days <= 60) return "bucket31Cents";
  return "bucket60Cents";
}

function totals(rows: AgingRow[]): Omit<AgingReport, "today" | "rows" | "warnings"> {
  return {
    rentBilledCents: sumColumn(rows, "rentBilledCents"),
    collectedCents: sumColumn(rows, "collectedCents"),
    balanceCents: sumColumn(rows, "balanceCents"),
    bucket0Cents: sumColumn(rows, "bucket0Cents"),
    bucket8Cents: sumColumn(rows, "bucket8Cents"),
    bucket31Cents: sumColumn(rows, "bucket31Cents"),
    bucket60Cents: sumColumn(rows, "bucket60Cents"),
    notYetDueCents: sumColumn(rows, "notYetDueCents"),
  };
}

function sumColumn(rows: AgingRow[], key: keyof AgingRow): number | null {
  let total = 0;
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "number") return null;
    const next = add(total, value);
    if (next == null) return null;
    total = next;
  }
  return total;
}

function emptyReport(today: string, warnings: string[], withheld: boolean): AgingReport {
  const blank = withheld ? null : 0;
  return {
    today,
    rows: [],
    rentBilledCents: blank,
    collectedCents: blank,
    balanceCents: blank,
    bucket0Cents: blank,
    bucket8Cents: blank,
    bucket31Cents: blank,
    bucket60Cents: blank,
    notYetDueCents: blank,
    warnings,
  };
}

function add(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function ageDays(dueDate: string | null, today: string): number | null {
  if (dueDate == null || dueDate.trim() === "") return null;
  const due = dueDate.includes("T") ? etDay(dueDate) : dateOnly(dueDate);
  if (!due) return null;
  return signedDays(due, today);
}

function etDay(iso: string): string | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return etToday(instant);
}

function signedDays(due: string, today: string): number | null {
  const [ay, am, ad] = due.split("-").map(Number);
  const [by, bm, bd] = today.split("-").map(Number);
  const days = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  return Number.isSafeInteger(days) ? days : null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1];
}
