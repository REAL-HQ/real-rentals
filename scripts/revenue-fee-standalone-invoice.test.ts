// Overview revenue: a paid fee counts (Regina's $50 one-day rental, Nov 16 2026),
// and a standalone Stripe invoice (no subscription) no longer makes the
// collections report incomplete (which showed Revenue "Unavailable").
// Synthetic data only. Run: bun test scripts/revenue-fee-standalone-invoice.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeeklyBilledCollected, isOverviewRevenueType, OVERVIEW_REVENUE_TYPES } from "../src/lib/overview-weekly-revenue.ts";
import { REVENUE_TYPES } from "../src/lib/revenue-report.ts";
import { verifyCollectedCharges } from "../src/lib/stripe-collections.ts";

describe("overview revenue types", () => {
  it("matches the Revenue report: fee, toll, damage count; deposits do not", () => {
    assert.deepEqual([...OVERVIEW_REVENUE_TYPES].sort(), [...REVENUE_TYPES].sort());
    for (const t of ["rent", "late_fee", "other", "toll", "damage", "fee"]) assert.equal(isOverviewRevenueType(t), true, t);
    assert.equal(isOverviewRevenueType("deposit"), false);
  });

  it("Billed vs Collected includes a paid $50 fee", () => {
    const now = new Date("2026-11-17T07:00:00Z");
    const series = buildWeeklyBilledCollected({
      now, weeks: 2, label: (d) => d.toISOString().slice(0, 10),
      collected: [
        { paid_date: "2026-11-16", net_collected: 50, type: "fee" },
        { paid_date: "2026-11-16", net_collected: 500, type: "deposit" },
      ],
      billed: [{ due_date: "2026-11-16", amount: 50, type: "fee" }],
    });
    const last = series[series.length - 1];
    assert.equal(last.collected, 50);
    assert.equal(last.billed, 50);
  });
});

describe("collections — standalone invoices", () => {
  const window = { gte: 1794200400, lt: 1794900000 };
  const charge = (over: Record<string, unknown> = {}) => ({
    id: "ch_inv1", customerId: "cus_A", paymentIntentId: "pi_inv1", currency: "usd", amountCaptured: 35000,
    paid: true, captured: true, status: "succeeded", created: 1794500000,
    balance: { created: 1794500000, currency: "usd", amount: 35000, fee: 1045 }, ...over,
  });
  const pay = { id: "inpay_1", invoiceId: "in_1", intentId: "pi_inv1", chargeId: "ch_inv1", externalRecord: false };

  it("a paid one-off invoice is owned by its customer and verifies", () => {
    const v = verifyCollectedCharges({ window, refunds: [], subscriptions: [], invoicePayments: [pay], invoices: [{ id: "in_1", customerId: "cus_A", subscriptionId: null }], charges: [charge()] as any });
    assert.equal(v.collectionsComplete, true);
    assert.equal(v.charges.length, 1);
    assert.equal(v.charges[0].customerId, "cus_A");
  });

  it("a standalone invoice whose charge has another customer stays unverified", () => {
    const v = verifyCollectedCharges({ window, refunds: [], subscriptions: [], invoicePayments: [pay], invoices: [{ id: "in_1", customerId: "cus_A", subscriptionId: null }], charges: [charge({ customerId: "cus_B" })] as any });
    assert.equal(v.collectionsComplete, false);
  });

  it("an invoice with no customer, or a subscription invoice with a missing/mismatched subscription, stays incomplete", () => {
    const base = { window, refunds: [], invoicePayments: [pay], charges: [charge()] as any };
    assert.equal(verifyCollectedCharges({ ...base, subscriptions: [], invoices: [{ id: "in_1", customerId: null, subscriptionId: null }] }).collectionsComplete, false);
    assert.equal(verifyCollectedCharges({ ...base, subscriptions: [], invoices: [{ id: "in_1", customerId: "cus_A", subscriptionId: "sub_1" }] }).collectionsComplete, false);
    assert.equal(verifyCollectedCharges({ ...base, subscriptions: [{ id: "sub_1", customerId: "cus_B" }], invoices: [{ id: "in_1", customerId: "cus_A", subscriptionId: "sub_1" }] }).collectionsComplete, false);
    assert.equal(verifyCollectedCharges({ ...base, subscriptions: [{ id: "sub_1", customerId: "cus_A" }], invoices: [{ id: "in_1", customerId: "cus_A", subscriptionId: "sub_1" }] }).collectionsComplete, true);
  });
});
