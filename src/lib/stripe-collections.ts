import { tierFromRoles, tierAllows } from "./roles";

export const STRIPE_COLLECTIONS_ENABLED = true;
export function assertCollectionsAccess(roles: string[]) {
  if (!tierAllows(tierFromRoles(roles), "manager")) throw new Error("Forbidden");
}

export type CollectionsRange = { from: string; to: string };
export function collectionsWindow(range: CollectionsRange) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new Error("Invalid reporting date");
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error("Invalid reporting date");
    return Math.floor(time / 1000);
  };
  const gte = parse(range.from), lt = parse(range.to);
  if (lt <= gte || lt - gte > 366 * 86400) throw new Error("Choose a range of up to 366 days");
  return { gte, lt };
}

/** Complete pagination or fail closed; never label a truncated total as complete. */
export async function readAllPages<T extends { id: string }>(
  read: (cursor?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const rows = new Map<string, T>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await read(cursor);
    for (const row of result.data) rows.set(row.id, row);
    if (!result.has_more) return [...rows.values()];
    const next = result.data.at(-1)?.id;
    if (!next || next === cursor) throw new Error("Stripe pagination incomplete");
    cursor = next;
  }
  throw new Error("Stripe report exceeds the safe page limit; no partial totals returned");
}

export type CollectionCharge = {
  id: string; customerId: string; created: number; currency: string;
  amount: number; paid: boolean; captured: boolean; status: string; fee: number | null;
};
export type CollectionRefund = {
  id: string; chargeId: string; created: number; currency: string;
  amount: number; status: string | null; fee: number | null;
};
export type CollectionSubscription = {
  id: string; customerId: string; name: string; status: string;
  cancelAtPeriodEnd: boolean; nextAt: number | null;
  currency: string; scheduledAmount: number | null;
};
type Totals = { currency: string; gross: number; refunds: number; fees: number | null; net: number | null; successful: number; failed: number };
export type CollectionsReport = {
  collectionsComplete: boolean;
  refreshedAt: string; totals: Totals[]; successful: number; failed: number; activeSubscriptions: number;
  customers: (Totals & { id: string; name: string })[];
  subscriptions: CollectionSubscription[];
  payouts: { currency: string; amount: number; count: number }[] | null;
  warnings: string[];
};

export function aggregateCollections(input: {
  charges: CollectionCharge[]; refunds: CollectionRefund[]; subscriptions: CollectionSubscription[];
  window: { gte: number; lt: number }; now: number;
}): Omit<CollectionsReport, "refreshedAt" | "payouts" | "warnings" | "collectionsComplete"> {
  const inRange = (n: number) => n >= input.window.gte && n < input.window.lt;
  const totals = new Map<string, Totals>();
  const customers = new Map<string, Totals & { id: string; name: string }>();
  const names = new Map(input.subscriptions.map(s => [s.customerId, s.name]));
  const bucket = (id: string, currency: string) => {
    const key = `${id}:${currency}`;
    if (!totals.has(currency)) totals.set(currency, { currency, gross: 0, refunds: 0, fees: 0, net: 0, successful: 0, failed: 0 });
    if (!customers.has(key)) customers.set(key, { id, name: names.get(id) || id, currency, gross: 0, refunds: 0, fees: 0, net: 0, successful: 0, failed: 0 });
    const total = totals.get(currency), customer = customers.get(key);
    return total && customer ? [total, customer] : [];
  };
  const addFee = (b: Totals, fee: number | null) => { b.fees = b.fees === null || fee === null ? null : b.fees + fee; };
  const charges = new Map(input.charges.map(c => [c.id, c]));
  for (const charge of charges.values()) {
    if (!inRange(charge.created) || (charge.status !== "failed" && !(charge.paid && charge.captured && charge.amount > 0 && charge.status === "succeeded"))) continue;
    for (const b of bucket(charge.customerId, charge.currency)) {
      if (charge.paid && charge.captured && charge.amount > 0 && charge.status === "succeeded") {
        b.gross += charge.amount; b.successful++; addFee(b, charge.fee);
      } else if (charge.status === "failed") b.failed++;
    }
  }
  for (const refund of new Map(input.refunds.map(r => [r.id, r])).values()) {
    const charge = charges.get(refund.chargeId);
    if (!charge || !charge.paid || !charge.captured || charge.amount <= 0 || charge.status !== "succeeded" || refund.status !== "succeeded" || !inRange(refund.created) || refund.currency !== charge.currency) continue;
    for (const b of bucket(charge.customerId, refund.currency)) {
      b.refunds += refund.amount; addFee(b, refund.fee);
    }
  }
  for (const b of [...totals.values(), ...customers.values()]) b.net = b.fees === null ? null : b.gross - b.refunds - b.fees;
  const subscriptions = [...new Map(input.subscriptions.map(s => [s.id, s])).values()];
  return {
    totals: [...totals.values()], customers: [...customers.values()].sort((a, b) => b.gross - a.gross),
    successful: [...totals.values()].reduce((s, b) => s + b.successful, 0),
    failed: [...totals.values()].reduce((s, b) => s + b.failed, 0),
    activeSubscriptions: subscriptions.filter(s => s.status === "active").length,
    subscriptions: subscriptions.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity)),
  };
}

export function formatStripeAmount(minor: number | null | undefined, currency: string) {
  if (minor == null) return "—";
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}