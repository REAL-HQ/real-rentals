import { describe, expect, it } from "vitest";
import { aggregateCollections, consolidatedRevenue } from "../src/lib/stripe-collections";
import { paymentOverlap } from "../src/lib/payment-overlap";
import { paymentRevenue } from "../src/lib/revenue-state";

const window = { gte: 1_700_000_000, lt: 1_800_000_000 };

function charge(partial: Record<string, unknown>) {
  return {
    id: "ch_1",
    customerId: "cus_1",
    created: window.gte + 10,
    currency: "usd",
    amount: 7500,
    paid: true,
    captured: true,
    status: "succeeded",
    fee: 0,
    ...partial,
  };
}

function reportFrom(charges: ReturnType<typeof charge>[], refunds: Array<Record<string, unknown>> = []) {
  const aggregated = aggregateCollections({
    charges: charges as any,
    refunds: refunds as any,
    subscriptions: [],
    window,
    now: window.gte + 100,
  });
  return {
    collectionsComplete: true,
    totals: aggregated.totals,
    successful: aggregated.successful,
    failed: aggregated.failed,
  };
}

const manual = {
  net_collected: 75,
  stripe_payment_intent_id: null,
  stripe_invoice_id: "in_cash",
  failure_reason: "Weekly rent charge failed",
  notified_status: "paid",
};

describe("double-collection revenue", () => {
  it("counts a manual receipt and the later Stripe collection once", () => {
    const period = [manual, { net_collected: 40, stripe_payment_intent_id: null, stripe_invoice_id: null, failure_reason: null, notified_status: null }];
    const rows = paymentRevenue({ data: period, count: 2, error: null });
    const overlap = paymentOverlap({ data: period, count: 2, error: null });
    expect(rows).toEqual({ total: 115, nonStripe: 115 });
    expect(overlap).toBe(75);
    const stripe = reportFrom([charge({})]);
    expect(stripe.totals[0].net).toBe(7500);
    expect(consolidatedRevenue({ internalNonStripe: rows!.nonStripe, overlap, report: stripe as any }).amount).toBe(115);
    expect(consolidatedRevenue({ internalNonStripe: rows!.nonStripe, overlap: 0, report: stripe as any }).amount).toBe(190);
  });

  it("does not count a failed Stripe attempt, then counts the retry once", () => {
    const failed = reportFrom([charge({ id: "ch_fail", status: "failed", paid: false, captured: false, amount: 7500 })]);
    expect(failed.failed).toBe(1);
    expect(failed.totals[0].gross).toBe(0);
    expect(failed.totals[0].net).toBe(0);
    const retried = reportFrom([
      charge({ id: "ch_fail", status: "failed", paid: false, captured: false, amount: 7500 }),
      charge({ id: "ch_ok", amount: 7500 }),
    ]);
    expect(retried.successful).toBe(1);
    expect(retried.totals[0].net).toBe(7500);
    const settled = { ...manual, failure_reason: null, notified_status: "paid" };
    expect(paymentRevenue({ data: [settled], count: 1, error: null })).toEqual({ total: 75, nonStripe: 0 });
    expect(paymentOverlap({ data: [settled], count: 1, error: null })).toBe(0);
    expect(consolidatedRevenue({ internalNonStripe: 0, overlap: 0, report: retried as any }).amount).toBe(75);
  });

  it("keeps the manual receipt after the duplicate Stripe charge is refunded", () => {
    const refunded = reportFrom(
      [charge({ id: "ch_dup" })],
      [{ id: "re_1", chargeId: "ch_dup", created: window.gte + 20, currency: "usd", amount: 7500, status: "succeeded", fee: 0 }],
    );
    expect(refunded.totals[0].net).toBe(0);
    expect(paymentRevenue({ data: [manual], count: 1, error: null })).toEqual({ total: 75, nonStripe: 75 });
    expect(paymentOverlap({ data: [manual], count: 1, error: null })).toBe(75);
    expect(consolidatedRevenue({ internalNonStripe: 75, overlap: 75, report: refunded as any }).amount).toBe(75);
  });

  it("counts two Stripe charge ids once when they are the same charge", () => {
    const once = reportFrom([charge({ id: "ch_same", amount: 9999 }), charge({ id: "ch_same" })]);
    expect(once.successful).toBe(1);
    expect(once.totals[0].gross).toBe(7500);
  });

  it("leaves Zelle with no invoice in the non-Stripe total", () => {
    const zelle = { net_collected: 30, stripe_payment_intent_id: null, stripe_invoice_id: null, failure_reason: null, notified_status: null };
    expect(paymentRevenue({ data: [zelle], count: 1, error: null })).toEqual({ total: 30, nonStripe: 30 });
    expect(paymentOverlap({ data: [zelle], count: 1, error: null })).toBe(0);
    const stripe = reportFrom([]);
    expect(consolidatedRevenue({ internalNonStripe: 30, overlap: 0, report: stripe as any }).amount).toBe(30);
  });

  it("withholds the headline when the overlap cannot be read", () => {
    const stripe = reportFrom([charge({})]);
    expect(consolidatedRevenue({ internalNonStripe: 75, overlap: null, report: stripe as any })).toEqual({ amount: null, coverage: "Unavailable" });
  });
});
