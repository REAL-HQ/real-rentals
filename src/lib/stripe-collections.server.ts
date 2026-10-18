import { createStripeClient, type StripeEnv } from "./stripe.server";
import { aggregateCollections, collectionsWindow, readAllPages, type CollectionCharge, type CollectionSubscription, type CollectionsRange, type CollectionsReport } from "./stripe-collections";

const idOf = (v: string | { id: string } | null | undefined) => typeof v === "string" ? v : v?.id;

/** GET/list/retrieve only. Invoices prove linkage, but never contribute money. */
export async function loadStripeCollections(environment: StripeEnv, range: CollectionsRange): Promise<CollectionsReport> {
  const window = collectionsWindow(range);
  const stripe = createStripeClient(environment);
  const [subscriptions, invoices, invoicePayments, charges, refunds] = await Promise.all([
    readAllPages(cursor => stripe.subscriptions.list({ status: "all", limit: 100, starting_after: cursor, expand: ["data.customer"] })),
    readAllPages(cursor => stripe.invoices.list({ limit: 100, starting_after: cursor })),
    readAllPages(cursor => stripe.invoicePayments.list({ limit: 100, starting_after: cursor })),
    // Capture may occur after authorization; date cash by settlement below.
    readAllPages(cursor => stripe.charges.list({ created: { lt: window.lt }, limit: 100, starting_after: cursor, expand: ["data.balance_transaction"] })),
    readAllPages(cursor => stripe.refunds.list({ created: window, limit: 100, starting_after: cursor, expand: ["data.balance_transaction"] })),
  ]);
  const subscriptionIndex = new Map(subscriptions.map(s => [s.id, s]));
  const invoiceIndex = new Map(invoices.map(i => [i.id, i]));
  const linkedIntents = new Map<string, Set<string>>();
  const linkedCharges = new Map<string, Set<string>>();
  let externalRecords = false;
  let collectionsComplete = true;
  for (const payment of invoicePayments) {
    const invoice = invoiceIndex.get(idOf(payment.invoice) || "");
    const subId = idOf(invoice?.parent?.subscription_details?.subscription);
    const subscription = subscriptionIndex.get(subId || "");
    const customer = idOf(subscription?.customer);
    if (!invoice || !subscription || !customer || idOf(invoice.customer) !== customer) {
      collectionsComplete = false;
      continue;
    }
    if (payment.payment.type === "payment_record") externalRecords = true;
    const intent = idOf(payment.payment.payment_intent), charge = idOf(payment.payment.charge);
    const add = (map: Map<string, Set<string>>, id: string | undefined) => {
      if (!id) return;
      const owners = map.get(id) || new Set<string>(); owners.add(customer); map.set(id, owners);
    };
    add(linkedIntents, intent); add(linkedCharges, charge);
  }
  // Refunds in this range can relate to collections from an earlier range.
  const chargeIndex = new Map(charges.map(c => [c.id, c]));
  for (const refund of refunds) {
    const chargeId = idOf(refund.charge);
    if (chargeId && !chargeIndex.has(chargeId)) chargeIndex.set(chargeId, await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] }));
  }
  const verifiedCharges: CollectionCharge[] = [];
  for (const charge of chargeIndex.values()) {
    const customerId = idOf(charge.customer);
    const balance = charge.balance_transaction;
    const collected = charge.paid && charge.captured && charge.status === "succeeded" && charge.amount_captured > 0;
    const capturedAt = balance && typeof balance !== "string" ? balance.created : undefined;
    const dated = typeof capturedAt === "number" && Number.isFinite(capturedAt);
    const refundInRange = refunds.some(r => idOf(r.charge) === charge.id && r.status === "succeeded");
    const relevant = refundInRange || (collected && (!dated || (capturedAt >= window.gte && capturedAt < window.lt))) || (charge.status === "failed" && charge.created >= window.gte);
    const owners = new Set([...(linkedCharges.get(charge.id) || []), ...(linkedIntents.get(idOf(charge.payment_intent) || "") || [])]);
    if (!customerId || owners.size !== 1 || !owners.has(customerId)) {
      // Never guess the ownership of unlinked cash or silently report zero.
      if (relevant) collectionsComplete = false;
      continue;
    }
    if (collected && (!dated || (balance && typeof balance !== "string" && balance.currency === charge.currency && balance.amount !== charge.amount_captured))) {
      collectionsComplete = false;
      continue;
    }
    const fee = balance && typeof balance !== "string" && balance.currency === charge.currency ? balance.fee : null;
    verifiedCharges.push({ id: charge.id, customerId, created: collected && dated ? capturedAt : charge.created, currency: charge.currency, amount: charge.amount_captured, paid: charge.paid, captured: charge.captured, status: charge.status, fee });
  }
  const normalizedSubs: CollectionSubscription[] = subscriptions.map(s => {
    const customer = s.customer;
    const items = s.items.data;
    const cadences = new Set(items.map(i => `${i.price.recurring?.interval}:${i.price.recurring?.interval_count}`));
    const periods = items.map(i => i.current_period_end).filter(n => Number.isFinite(n));
    const complete = !s.items.has_more && items.length > 0 && cadences.size === 1 && new Set(periods).size === 1 && periods.length === items.length && items.every(i => i.price.unit_amount !== null && !i.price.transform_quantity && i.price.recurring?.interval && i.price.recurring.usage_type !== "metered" && i.price.currency === s.currency);
    const nextPeriod = !s.items.has_more && periods.length === items.length && periods.length > 0 ? Math.min(...periods) : null;
    const renews = ["active", "trialing", "past_due"].includes(s.status) && !s.cancel_at_period_end && !s.pause_collection && nextPeriod !== null && (!s.cancel_at || nextPeriod < s.cancel_at);
    return {
      id: s.id, customerId: idOf(customer) || "—", name: typeof customer !== "string" && !customer.deleted ? customer.name || customer.email || customer.id : idOf(customer) || "—",
      status: s.status, cancelAtPeriodEnd: s.cancel_at_period_end || Boolean(s.cancel_at), currency: s.currency,
      nextAt: renews && nextPeriod !== null && nextPeriod > Date.now() / 1000 ? nextPeriod : null,
      scheduledAmount: complete ? items.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0) : null,
    };
  });
  const report = aggregateCollections({ charges: verifiedCharges, refunds: refunds.map(r => ({
    id: r.id, chargeId: idOf(r.charge) || "", created: r.created, amount: r.amount, currency: r.currency, status: r.status,
    fee: r.balance_transaction && typeof r.balance_transaction !== "string" && r.balance_transaction.currency === r.currency ? r.balance_transaction.fee : null,
  })), subscriptions: normalizedSubs, window, now: Math.floor(Date.now() / 1000) });
  if (refunds.some(r => r.status === "succeeded" && !verifiedCharges.some(c => c.id === idOf(r.charge) && c.captured && c.paid && c.amount > 0 && c.status === "succeeded" && c.currency === r.currency))) collectionsComplete = false;
  const warnings: string[] = ["Linked Failures covers verified invoice-linked Charge attempts only; attempts without a Charge or unavailable retry links are not included."];
  if (!collectionsComplete) warnings.push("Some payment history or capture evidence could not be verified. Collection totals are unavailable; no missing amounts have been assumed to be zero.");
  if (normalizedSubs.some(s => s.scheduledAmount === null)) warnings.push("Some base rates are unavailable because subscription items are incomplete or use different billing periods.");
  warnings.push("Base Rate excludes discounts, tax and prorations; Next Billing is a renewal boundary, not a promised collection.");
  if (externalRecords) warnings.push("External payment records are excluded from Stripe collections.");
  if (report.totals.some(t => t.fees === null)) warnings.push("Some Stripe fees are unavailable; net collections remain unknown.");
  let payouts: CollectionsReport["payouts"] = null;
  try {
    const rows = await readAllPages(cursor => stripe.payouts.list({ arrival_date: window, status: "paid", limit: 100, starting_after: cursor }));
    const sums = new Map<string, { currency: string; amount: number; count: number }>();
    for (const p of rows) {
      const b = sums.get(p.currency) || { currency: p.currency, amount: 0, count: 0 }; b.amount += p.amount; b.count++; sums.set(p.currency, b);
    }
    payouts = [...sums.values()];
  } catch { warnings.push("Account payouts are unavailable."); }
  return { ...report, collectionsComplete, payouts, warnings, refreshedAt: new Date().toISOString() };
}