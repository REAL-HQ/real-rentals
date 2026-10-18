import { aggregateCollections, collectionsWindow, type CollectionsReport, type CollectionsRange } from "./stripe-collections";

/**
 * Synthetic Stripe Collections fixture for the isolated dev-server test mode.
 * No Stripe credentials are read and no network calls are made; every value is
 * invented test data and must never be shown as live financial information.
 */
export function syntheticCollectionsReport(range: CollectionsRange): CollectionsReport {
  const window = collectionsWindow(range);
  const now = Math.floor(Date.now() / 1000);
  const base = window.gte + 3600;
  const aggregated = aggregateCollections({
    window,
    now,
    charges: [
      { id: "ch_synthetic_1", customerId: "cus_synthetic_a", created: base, currency: "usd", amount: 35000, paid: true, captured: true, status: "succeeded", fee: 1045 },
      { id: "ch_synthetic_2", customerId: "cus_synthetic_b", created: base + 7200, currency: "usd", amount: 37500, paid: true, captured: true, status: "succeeded", fee: 1116 },
      { id: "ch_synthetic_3", customerId: "cus_synthetic_b", created: base + 10800, currency: "usd", amount: 37500, paid: false, captured: false, status: "failed", fee: null },
    ],
    refunds: [
      { id: "re_synthetic_1", chargeId: "ch_synthetic_1", created: base + 14400, currency: "usd", amount: 10000, status: "succeeded", fee: -300 },
    ],
    subscriptions: [
      { id: "sub_synthetic_a", customerId: "cus_synthetic_a", name: "Synthetic Customer A", status: "active", cancelAtPeriodEnd: false, nextAt: now + 3 * 86400, currency: "usd", scheduledAmount: 35000 },
      { id: "sub_synthetic_b", customerId: "cus_synthetic_b", name: "Synthetic Customer B", status: "active", cancelAtPeriodEnd: true, nextAt: now + 6 * 86400, currency: "usd", scheduledAmount: 37500 },
    ],
  });
  return {
    collectionsComplete: true,
    refreshedAt: new Date().toISOString(),
    totals: aggregated.totals,
    successful: aggregated.successful,
    failed: aggregated.failed,
    activeSubscriptions: aggregated.activeSubscriptions,
    customers: aggregated.customers,
    verifiedCollections: {
      scope: "Verified Only",
      totals: aggregated.totals,
      customers: aggregated.customers,
      successful: aggregated.successful,
      failed: aggregated.failed,
      charges: [
        { id: "ch_synthetic_1", customerId: "cus_synthetic_a", created: base, currency: "usd", amount: 35000, paid: true, captured: true, status: "succeeded", fee: 1045 },
        { id: "ch_synthetic_2", customerId: "cus_synthetic_b", created: base + 7200, currency: "usd", amount: 37500, paid: true, captured: true, status: "succeeded", fee: 1116 },
        { id: "ch_synthetic_3", customerId: "cus_synthetic_b", created: base + 10800, currency: "usd", amount: 37500, paid: false, captured: false, status: "failed", fee: null },
      ],
      refunds: [
        { id: "re_synthetic_1", chargeId: "ch_synthetic_1", created: base + 14400, currency: "usd", amount: 10000, status: "succeeded", fee: -300 },
      ],
    },
    incompletePortions: [],
    subscriptions: aggregated.subscriptions,
    payouts: [{ currency: "usd", amount: 51339, count: 1 }],
    warnings: ["Synthetic test data — not live Stripe data."],
  };
}
