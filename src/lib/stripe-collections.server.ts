import { type StripeEnv } from "./stripe.server";
import { createReadOnlyStripe } from "./stripe-reader.server";
import { STRIPE_READER_PAGE_SIZE } from "./stripe-reader";
import { aggregateCollections, collectionsWindow, readAllPages, verifyCollectedCharges, type CollectionBalanceEvidence, type CollectionSubscription, type CollectionsRange, type CollectionsReport } from "./stripe-collections";

function balanceEvidence(balance: unknown): CollectionBalanceEvidence | null {
  if (!balance || typeof balance !== "object") return null;
  const row = balance as { created?: unknown; currency?: unknown; amount?: unknown; fee?: unknown };
  return { created: row.created, currency: row.currency, amount: row.amount, fee: row.fee };
}

const idOf = (v: string | { id: string } | null | undefined) => typeof v === "string" ? v : v?.id;

/** GET/list/retrieve only. Invoices prove linkage, but never contribute money. */
export async function loadStripeCollections(environment: StripeEnv, range: CollectionsRange): Promise<CollectionsReport> {
  const window = collectionsWindow(range);
  // Live collections stay uncached. A payment must show on the next refresh.
  const stripe = createReadOnlyStripe(environment);
  const [subscriptions, invoices, invoicePayments, charges, refunds] = await Promise.all([
    readAllPages(cursor => stripe.subscriptions.list({ status: "all", limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.customer"] })),
    readAllPages(cursor => stripe.invoices.list({ limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor })),
    readAllPages(cursor => stripe.invoicePayments.list({ limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor })),
    // Capture may occur after authorization; date cash by settlement below.
    readAllPages(cursor => stripe.charges.list({ created: { lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] })),
    readAllPages(cursor => stripe.refunds.list({ created: window, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] })),
  ]);
  // Refunds in this range can relate to collections from an earlier range.
  const chargeIndex = new Map(charges.map(c => [c.id, c]));
  for (const refund of refunds) {
    const chargeId = idOf(refund.charge);
    if (chargeId && !chargeIndex.has(chargeId)) chargeIndex.set(chargeId, await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] }));
  }
  const normalizedRefunds = refunds.map(r => ({
    id: r.id, chargeId: idOf(r.charge) || "", created: r.created, amount: r.amount, currency: r.currency, status: r.status,
    fee: r.balance_transaction && typeof r.balance_transaction !== "string" && r.balance_transaction.currency === r.currency ? r.balance_transaction.fee : null,
  }));
  const verified = verifyCollectedCharges({
    window,
    invoicePayments: invoicePayments.map(payment => ({
      id: payment.id,
      invoiceId: idOf(payment.invoice) || null,
      intentId: idOf(payment.payment.payment_intent) || null,
      chargeId: idOf(payment.payment.charge) || null,
      externalRecord: payment.payment.type === "payment_record",
    })),
    invoices: invoices.map(invoice => ({
      id: invoice.id,
      customerId: idOf(invoice.customer) || null,
      subscriptionId: idOf(invoice.parent?.subscription_details?.subscription) || null,
    })),
    subscriptions: subscriptions.map(subscription => ({
      id: subscription.id,
      customerId: idOf(subscription.customer) || null,
    })),
    charges: [...chargeIndex.values()].map(charge => ({
      id: charge.id,
      customerId: idOf(charge.customer) || null,
      paymentIntentId: idOf(charge.payment_intent) || null,
      currency: charge.currency,
      amountCaptured: charge.amount_captured,
      paid: charge.paid,
      captured: charge.captured,
      status: charge.status,
      created: charge.created,
      balance: balanceEvidence(charge.balance_transaction),
    })),
    refunds: normalizedRefunds,
  });
  const { collectionsComplete, incompletePortions, externalRecords } = verified;
  const verifiedCharges = verified.charges;
  const verifiedRefunds = verified.refunds;
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
  const report = aggregateCollections({ charges: verifiedCharges, refunds: verifiedRefunds, subscriptions: normalizedSubs, window, now: Math.floor(Date.now() / 1000) });
  const warnings: string[] = ["Linked Failures covers verified invoice-linked Charge attempts only; attempts without a Charge or unavailable retry links are not included."];
  if (!collectionsComplete) warnings.push("Some payment history or capture evidence could not be verified. Complete collection totals are unavailable. Verified Only amounts exclude incomplete portions and must not be treated as complete totals.");
  if (normalizedSubs.some(s => s.scheduledAmount === null)) warnings.push("Some base rates are unavailable because subscription items are incomplete or use different billing periods.");
  warnings.push("Base Rate excludes discounts, tax and prorations; Next Billing is a renewal boundary, not a promised collection.");
  if (externalRecords) warnings.push("External payment records are excluded from Stripe collections.");
  if (report.totals.some(t => t.fees === null)) warnings.push("Some Stripe fees are unavailable; net collections remain unknown.");
  let payouts: CollectionsReport["payouts"] = null;
  try {
    const rows = await readAllPages(cursor => stripe.payouts.list({ arrival_date: window, status: "paid", limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor }));
    const sums = new Map<string, { currency: string; amount: number; count: number }>();
    for (const p of rows) {
      const b = sums.get(p.currency) || { currency: p.currency, amount: 0, count: 0 }; b.amount += p.amount; b.count++; sums.set(p.currency, b);
    }
    payouts = [...sums.values()];
  } catch { warnings.push("Account payouts are unavailable."); }
  return { ...report, totals: collectionsComplete ? report.totals : null, customers: collectionsComplete ? report.customers : [], successful: collectionsComplete ? report.successful : null, failed: collectionsComplete ? report.failed : null,
    verifiedCollections: { scope: "Verified Only", totals: report.totals, customers: report.customers, successful: report.successful, failed: report.failed, charges: verifiedCharges, refunds: verifiedRefunds },
    incompletePortions, collectionsComplete, payouts, warnings, refreshedAt: new Date().toISOString() };
}