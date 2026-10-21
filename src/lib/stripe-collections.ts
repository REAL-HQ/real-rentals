import { tierFromRoles, tierAllows } from "./roles";
import { STRIPE_READER_MAX_PAGES, paginateStripeList } from "./stripe-reader";

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
  const result = await paginateStripeList(read, { label: "Stripe collections", dedupe: true, maxPages: STRIPE_READER_MAX_PAGES });
  if (result.ok) return result.rows;
  if (result.reason === "capped") throw new Error("Stripe report exceeds the safe page limit; no partial totals returned");
  throw new Error("Stripe pagination incomplete");
}

export type CollectionCharge = {
  id: string; customerId: string; created: number; currency: string;
  amount: number; paid: boolean; captured: boolean; status: string; fee: number | null;
};
export type CollectionRefund = {
  id: string; chargeId: string; created: number; currency: string;
  amount: number; status: string | null; fee: number | null;
};
/** One invoice payment after its invoice and subscription customers are read. A null customer means the link did not match. */
export type CollectionInvoicePayment = {
  id: string;
  invoiceId: string | null;
  intentId: string | null;
  chargeId: string | null;
  externalRecord: boolean;
};
export type CollectionInvoiceRef = { id: string; customerId: string | null; subscriptionId: string | null };
export type CollectionSubscriptionRef = { id: string; customerId: string | null };
export type CollectionBalanceEvidence = { created: unknown; currency: unknown; amount: unknown; fee: unknown };
export type UnverifiedCollectionCharge = {
  id: string;
  customerId: string | null;
  paymentIntentId: string | null;
  currency: string;
  amountCaptured: number;
  paid: boolean;
  captured: boolean;
  status: string;
  created: number;
  balance: CollectionBalanceEvidence | null;
};
export type CollectionSubscription = {
  id: string; customerId: string; name: string; status: string;
  cancelAtPeriodEnd: boolean; nextAt: number | null;
  currency: string; scheduledAmount: number | null;
};
type Totals = { currency: string; gross: number; refunds: number; fees: number | null; net: number | null; successful: number; failed: number };
export type CollectionsReport = {
  collectionsComplete: boolean;
  refreshedAt: string; totals: Totals[] | null; successful: number | null; failed: number | null; activeSubscriptions: number;
  customers: (Totals & { id: string; name: string })[];
  verifiedCollections: { scope: "Verified Only"; totals: Totals[]; customers: (Totals & { id: string; name: string })[]; successful: number; failed: number; charges: CollectionCharge[]; refunds: CollectionRefund[] };
  incompletePortions: { source: "InvoicePayment" | "Charge" | "Refund"; id: string; reason: string }[];
  subscriptions: CollectionSubscription[];
  payouts: { currency: string; amount: number; count: number }[] | null;
  warnings: string[];
};

export function aggregateCollections(input: {
  charges: CollectionCharge[]; refunds: CollectionRefund[]; subscriptions: CollectionSubscription[];
  window: { gte: number; lt: number }; now: number;
}): { totals: Totals[]; customers: (Totals & { id: string; name: string })[]; successful: number; failed: number; activeSubscriptions: number; subscriptions: CollectionSubscription[] } {
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

export function formatStripeAmount(minor: number | null | undefined, currency: string | null | undefined) {
  if (minor == null || !currency) return "—";
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}

export function collectionsRefreshState(input: { valid: boolean; fetching: boolean; failed: boolean; refreshedAt?: string; stale: boolean }) {
  return {
    status: !input.valid ? "Invalid Range" : input.fetching ? "Refreshing" : input.failed ? "Refresh Failed" : input.refreshedAt ? input.stale ? "Cached" : "Current" : "Not Refreshed",
    lastSuccessfulAt: input.refreshedAt ?? null,
    cached: Boolean(input.refreshedAt) && (!input.valid || input.fetching || input.failed || input.stale),
  };
}
/**
 * Local calendar days (YYYY-MM-DD, browser timezone) → the exact instants the
 * Collections endpoint takes: local midnight of `from` to local midnight after
 * `to`. Shared by the Collections section and the Revenue card so both send
 * identical requests (and share one cache entry) for the same period.
 */
export function collectionsRequestRange(from: string, to: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * The Revenue card's "Stripe Collected" figure: verified net after fees and
 * refunds, or "—" whenever the report cannot establish it. Display-only; it is
 * never added to the card's revenue total.
 */
export function stripeCollectedLabel(report: CollectionsReport | null | undefined): string {
  if (!report || !report.collectionsComplete || !report.totals) return "—";
  if (report.totals.length === 0) return formatStripeAmount(0, "usd");
  if (report.totals.some(t => t.net === null || !Number.isFinite(t.net))) return "—";
  return report.totals.map(t => formatStripeAmount(t.net, t.currency)).join(" · ");
}

/**
 * The Revenue card's single figure: verified Stripe net (after refunds and
 * fees) plus internal net_collected from rows with neither a Stripe payment
 * intent nor a Stripe invoice id, and from a failed invoice row staff marked
 * paid (failure_reason still set). A later Stripe success clears that reason
 * without changing status or paid date. Those
 * Stripe-settled charges are already inside the Stripe figure — never counted
 * twice. Deposit rows are not removed here.
 * Returns null whenever Stripe cannot be established (never zero). Coverage
 * is never "Complete": Zelle/Cash App/Venmo/cash/ACH are not verified yet.
 */
/**
 * The same charge and refund verification Overview uses before aggregateCollections.
 * Cash is dated by balance_transaction.created. A charge counts only when one
 * invoice customer owns it and that customer is the charge customer. A collected
 * charge whose balance is missing, undated, or whose balance.amount differs from
 * amount_captured is incomplete. A succeeded refund that is not tied to a verified
 * charge of the same currency makes the whole result incomplete.
 */
export function verifyCollectedCharges(input: {
  charges: UnverifiedCollectionCharge[];
  refunds: CollectionRefund[];
  invoicePayments: CollectionInvoicePayment[];
  invoices: CollectionInvoiceRef[];
  subscriptions: CollectionSubscriptionRef[];
  window: { gte: number; lt: number };
}): {
  charges: CollectionCharge[];
  refunds: CollectionRefund[];
  collectionsComplete: boolean;
  incompletePortions: CollectionsReport["incompletePortions"];
  externalRecords: boolean;
} {
  const invoiceIndex = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const subscriptionIndex = new Map(input.subscriptions.map((subscription) => [subscription.id, subscription]));
  const linkedIntents = new Map<string, Set<string>>();
  const linkedCharges = new Map<string, Set<string>>();
  let externalRecords = false;
  let collectionsComplete = true;
  const incompletePortions: CollectionsReport["incompletePortions"] = [];
  const incomplete = (source: "InvoicePayment" | "Charge" | "Refund", id: string, reason: string) => {
    collectionsComplete = false;
    incompletePortions.push({ source, id, reason });
  };
  const unresolvedIntents = new Set<string>();
  const unresolvedCharges = new Set<string>();
  const addOwner = (map: Map<string, Set<string>>, id: string | null, customer: string) => {
    if (!id) return;
    const owners = map.get(id) || new Set<string>();
    owners.add(customer);
    map.set(id, owners);
  };
  for (const payment of input.invoicePayments) {
    const invoice = payment.invoiceId ? invoiceIndex.get(payment.invoiceId) : undefined;
    const subscription = invoice?.subscriptionId ? subscriptionIndex.get(invoice.subscriptionId) : undefined;
    const customer = subscription?.customerId || null;
    if (!invoice || !subscription || !customer || invoice.customerId !== customer) {
      incomplete("InvoicePayment", payment.id, "Invoice, subscription or matching customer unavailable");
      if (payment.intentId) unresolvedIntents.add(payment.intentId);
      if (payment.chargeId) unresolvedCharges.add(payment.chargeId);
      continue;
    }
    if (payment.externalRecord) externalRecords = true;
    addOwner(linkedIntents, payment.intentId, customer);
    addOwner(linkedCharges, payment.chargeId, customer);
  }
  const verifiedCharges: CollectionCharge[] = [];
  for (const charge of input.charges) {
    const customerId = charge.customerId;
    const balance = charge.balance;
    const collected = charge.paid && charge.captured && charge.status === "succeeded" && charge.amountCaptured > 0;
    const capturedAt = balance && typeof balance.created === "number" && Number.isFinite(balance.created) ? balance.created : null;
    const dated = capturedAt !== null;
    const refundInRange = input.refunds.some((refund) => refund.chargeId === charge.id && refund.status === "succeeded");
    const inWindow = dated && capturedAt >= input.window.gte && capturedAt < input.window.lt;
    const relevant = refundInRange
      || (collected && (!dated || inWindow))
      || (charge.status === "failed" && charge.created >= input.window.gte);
    const owners = new Set<string>([
      ...(linkedCharges.get(charge.id) || []),
      ...(linkedIntents.get(charge.paymentIntentId || "") || []),
    ]);
    if (!customerId || owners.size !== 1 || !owners.has(customerId) || unresolvedCharges.has(charge.id) || unresolvedIntents.has(charge.paymentIntentId || "")) {
      if (relevant) incomplete("Charge", charge.id, "Payment ownership or invoice relationship unverified");
      continue;
    }
    if (collected && (!dated || (balance !== null && balance.currency === charge.currency && balance.amount !== charge.amountCaptured))) {
      if (relevant) incomplete("Charge", charge.id, "Capture date or settlement amount unverified");
      continue;
    }
    const fee = balance !== null && balance.currency === charge.currency && typeof balance.fee === "number" ? balance.fee : null;
    verifiedCharges.push({
      id: charge.id,
      customerId,
      created: collected && capturedAt !== null ? capturedAt : charge.created,
      currency: charge.currency,
      amount: charge.amountCaptured,
      paid: charge.paid,
      captured: charge.captured,
      status: charge.status,
      fee,
    });
  }
  const verifiedRefunds = input.refunds.filter((refund) =>
    verifiedCharges.some((charge) => charge.id === refund.chargeId && charge.captured && charge.paid && charge.amount > 0 && charge.status === "succeeded" && charge.currency === refund.currency)
    && refund.status === "succeeded");
  for (const refund of input.refunds) {
    if (refund.status === "succeeded" && !verifiedRefunds.some((verified) => verified.id === refund.id)) {
      incomplete("Refund", refund.id, "Captured charge relationship or currency unverified");
    }
  }
  return { charges: verifiedCharges, refunds: verifiedRefunds, collectionsComplete, incompletePortions, externalRecords };
}

export function consolidatedRevenue(input: { internalNonStripe: number | null; report: CollectionsReport | null | undefined }):
  { amount: number | null; coverage: "Partial" | "Unavailable" } {
  if(input.internalNonStripe === null || !Number.isFinite(input.internalNonStripe)) return { amount: null, coverage: "Unavailable" };
  const r = input.report;
  if (!r || !r.collectionsComplete || !r.totals) return { amount: null, coverage: "Unavailable" };
  if (r.totals.some(t => t.currency.toLowerCase() !== "usd" || t.net === null || !Number.isFinite(t.net))) return { amount: null, coverage: "Unavailable" };
  const stripeNet = r.totals.reduce((s, t) => s + (t.net as number), 0) / 100;
  return { amount: Math.round((stripeNet + input.internalNonStripe) * 100) / 100, coverage: "Partial" };
}
