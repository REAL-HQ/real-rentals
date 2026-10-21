import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStripeFinanceWindow, type ReadOnlyStripeGateway } from "../src/lib/unified-finance-stripe-read.server";
import { buildVerifiedCollections, verifiedCollectionReport, type VerifiedBalance, type VerifiedCharge, type VerifiedPayment, type VerifiedPayout, type VerifiedRefundRow } from "../src/lib/unified-finance-verified";

const period = { from: "2026-10-01", to: "2026-11-01" };
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const oct15 = at("2026-10-15T15:00:00.000Z");
const sep15 = at("2026-09-15T15:00:00.000Z");

const payment = (overrides: Partial<VerifiedPayment> = {}): VerifiedPayment => ({
  id: "pay-1", type: "rent", status: "paid", amount: 100, refundedAmount: 0,
  method: "stripe", paidDate: "2026-10-15", paymentIntentId: "pi_1", ...overrides,
});
const charge = (overrides: Partial<VerifiedCharge> = {}): VerifiedCharge => ({
  id: "ch_1", paymentIntentId: "pi_1", balanceTransactionId: "txn_1",
  amountCents: 10000, currency: "usd", succeeded: true, created: oct15, ...overrides,
});
const balance = (overrides: Partial<VerifiedBalance> = {}): VerifiedBalance => ({
  id: "txn_1", type: "charge", amount: 10000, fee: 300, net: 9700, currency: "usd", created: oct15, sourceId: "ch_1", ...overrides,
});
const payout = (overrides: Partial<VerifiedPayout> = {}): VerifiedPayout => ({
  id: "po_1", amount: 9700, currency: "usd", status: "paid", arrival: oct15, ...overrides,
});

function cards(input: { charges?: VerifiedCharge[]; balances?: VerifiedBalance[]; payouts?: VerifiedPayout[]; payments?: VerifiedPayment[]; refunds?: VerifiedRefundRow[] }) {
  const match = buildVerifiedCollections({
    period, basis: "cash", charges: input.charges ?? [], balances: input.balances ?? [],
    payouts: input.payouts ?? [], payments: input.payments ?? [], refunds: input.refunds ?? [],
  });
  return { match, report: verifiedCollectionReport({ period, basis: "cash", events: match.events, complete: match.complete }) };
}

describe("verified collections from Stripe evidence", () => {
  it("completes gross, fees, net, and payouts when a charge matches one payment", () => {
    const { match, report } = cards({ charges: [charge()], balances: [balance()], payouts: [payout()], payments: [payment()] });
    expect(match.complete).toBe(true);
    expect(match.unmatched).toEqual({ charges: 0, refunds: 0, payouts: 0, payments: 0, balanceTransactions: 0 });
    expect(report.grossCollected).toEqual({ value: 10000, complete: true });
    expect(report.processingFees).toEqual({ value: 300, complete: true });
    expect(report.refunds).toEqual({ value: 0, complete: true });
    expect(report.chargebacksLost).toEqual({ value: 0, complete: true });
    expect(report.netCollections).toEqual({ value: 9700, complete: true });
    expect(report.actualPayouts).toEqual({ value: 9700, complete: true });
    expect(report.payoutDifference).toEqual({ value: 0, complete: true });
    expect(report.depositLiabilityChange).toEqual({ value: 0, complete: true });
    expect(report.earnedRevenue).toEqual({ value: null, complete: false });
    expect(report.operatingExpenses.complete).toBe(false);
    expect(report.customerCompensation.complete).toBe(false);
    expect(report.operatingResult.complete).toBe(false);
    expect(report.openDisputes.complete).toBe(false);
    expect(report.projectedRenewals.complete).toBe(false);
  });

  it("keeps a deposit out of gross and a deposit refund out of refunds", () => {
    const held = cards({
      charges: [charge({ amountCents: 50000 })],
      balances: [balance({ amount: 50000, fee: 150, net: 49850 })],
      payments: [payment({ type: "deposit", amount: 500, paymentIntentId: "pi_1" })],
    });
    expect(held.match.complete).toBe(true);
    expect(held.report.grossCollected).toEqual({ value: 0, complete: true });
    expect(held.report.processingFees).toEqual({ value: 150, complete: true });
    expect(held.report.depositLiabilityChange).toEqual({ value: 50000, complete: true });
    expect(held.report.netCollections).toEqual({ value: -150, complete: true });

    const returned = cards({
      charges: [charge({ amountCents: 50000 })],
      balances: [
        balance({ amount: 50000, fee: 150, net: 49850 }),
        balance({ id: "txn_r", type: "refund", amount: -20000, fee: 0, net: -20000, sourceId: "re_1" }),
      ],
      payments: [payment({ type: "deposit", amount: 500 })],
      refunds: [{ id: "row-1", amount: 200, status: "succeeded", chargeId: "ch_1", paymentIntentId: "pi_1", refundId: "re_1", paymentIds: ["pay-1"] }],
    });
    expect(returned.match.complete).toBe(true);
    expect(returned.report.grossCollected).toEqual({ value: 0, complete: true });
    expect(returned.report.refunds).toEqual({ value: 0, complete: true });
    expect(returned.report.depositLiabilityChange).toEqual({ value: 30000, complete: true });
  });

  it("subtracts a matched rent refund and a fee-free cash refund from collections", () => {
    const stripeRefund = cards({
      charges: [charge()],
      balances: [balance(), balance({ id: "txn_r", type: "refund", amount: -2000, fee: 0, net: -2000, sourceId: "re_1" })],
      payments: [payment()],
      refunds: [{ id: "row-1", amount: 20, status: "succeeded", chargeId: "ch_1", paymentIntentId: "pi_1", refundId: "re_1", paymentIds: ["pay-1"] }],
    });
    expect(stripeRefund.report.grossCollected).toEqual({ value: 10000, complete: true });
    expect(stripeRefund.report.refunds).toEqual({ value: 2000, complete: true });
    expect(stripeRefund.report.processingFees).toEqual({ value: 300, complete: true });
    expect(stripeRefund.report.netCollections).toEqual({ value: 7700, complete: true });

    const cash = cards({
      payments: [payment({ method: "cash", paymentIntentId: null, amount: 40, refundedAmount: 5 })],
    });
    expect(cash.match.complete).toBe(true);
    expect(cash.report.grossCollected).toEqual({ value: 4000, complete: true });
    expect(cash.report.processingFees).toEqual({ value: 0, complete: true });
    expect(cash.report.refunds).toEqual({ value: 500, complete: true });
    expect(cash.report.netCollections).toEqual({ value: 3500, complete: true });
  });

  it("leaves dollars blank and shows a count when an item does not match", () => {
    const missing = cards({ charges: [charge()], balances: [balance()], payouts: [payout()] });
    expect(missing.match.complete).toBe(false);
    expect(missing.match.unmatched.charges).toBe(1);
    expect(missing.report.grossCollected).toEqual({ value: null, complete: false });
    expect(missing.report.processingFees.value).toBeNull();
    expect(missing.report.actualPayouts.value).toBeNull();
    expect(JSON.stringify(missing.report)).not.toContain("10000");

    const adjustment = cards({
      charges: [charge()], balances: [balance(), balance({ id: "txn_a", type: "adjustment", amount: 500, fee: 0, net: 500, sourceId: null })],
      payments: [payment()],
    });
    expect(adjustment.match.complete).toBe(false);
    expect(adjustment.match.unmatched.balanceTransactions).toBe(1);
    expect(adjustment.report.grossCollected.value).toBeNull();
    expect(adjustment.report.chargebacksLost.value).toBeNull();
  });
});

const emptyPage = async () => ({ data: [], has_more: false });
function gateway(overrides: Partial<ReadOnlyStripeGateway> = {}): ReadOnlyStripeGateway {
  return {
    balanceTransactions: { list: emptyPage, retrieve: async () => { throw new Error("unexpected balance retrieve"); } },
    payouts: { list: emptyPage },
    charges: { list: emptyPage, retrieve: async () => { throw new Error("unexpected charge retrieve"); } },
    ...overrides,
  };
}

describe("read-only Stripe window", () => {
  it("pages until has_more is false and discards a timed-out partial read", async () => {
    const seen: string[] = [];
    const listed = gateway({
      balanceTransactions: {
        list: async (params) => {
          seen.push(params.starting_after ?? "");
          expect(params.limit).toBe(100);
          expect(params.created).toEqual({ gte: at("2026-10-01T00:00:00.000Z"), lt: at("2026-11-01T00:00:00.000Z") });
          if (!params.starting_after) return { data: [{ id: "txn_1", amount: -125, fee: 0, net: -125, currency: "usd", created: oct15, type: "stripe_fee", source: null, livemode: true }], has_more: true };
          return { data: [{ id: "txn_2", amount: 0, fee: 40, net: 0, currency: "usd", created: oct15, type: "stripe_fee", source: null, livemode: true }], has_more: false };
        },
        retrieve: async () => { throw new Error("unexpected balance retrieve"); },
      },
    });
    const result = await readStripeFinanceWindow(listed, period);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.balances.map((row) => row.id)).toEqual(["txn_1", "txn_2"]);
    expect(seen).toEqual(["", "txn_1"]);

    let clock = 1_000;
    const stalled = gateway({
      balanceTransactions: {
        list: async () => {
          clock += 30_000;
          return { data: [{ id: "txn_1", amount: -125, fee: 0, net: -125, currency: "usd", created: oct15, type: "stripe_fee", source: null, livemode: true }], has_more: true };
        },
        retrieve: async () => { throw new Error("unexpected balance retrieve"); },
      },
    });
    const timedOut = await readStripeFinanceWindow(stalled, period, { timeoutMs: 20_000, now: () => clock });
    expect(timedOut).toEqual({ ok: false, reason: "Stripe evidence was incomplete or timed out" });
  });

  it("fails closed on a test-mode row, a fractional fee, or a malformed page", async () => {
    const testMode = gateway({
      charges: {
        list: async () => ({ data: [{ id: "ch_1", amount: 100, currency: "usd", status: "succeeded", paid: true, captured: true, created: oct15, livemode: false }], has_more: false }),
        retrieve: async () => { throw new Error("unexpected charge retrieve"); },
      },
    });
    expect((await readStripeFinanceWindow(testMode, period)).ok).toBe(false);
    const fraction = gateway({
      balanceTransactions: {
        list: async () => ({ data: [{ id: "txn_1", amount: 100, fee: 1.5, net: 98.5, currency: "usd", created: oct15, type: "charge", source: "ch_1" }], has_more: false }),
        retrieve: async () => { throw new Error("unexpected balance retrieve"); },
      },
    });
    expect((await readStripeFinanceWindow(fraction, period)).ok).toBe(false);
    const malformed = gateway({ payouts: { list: async () => ({ data: null, has_more: false } as never) } });
    expect((await readStripeFinanceWindow(malformed, period)).ok).toBe(false);
  });

  it("retrieves a prior charge and its fee for an in-period refund without keeping partial rows", async () => {
    const calls: string[] = [];
    const reader = gateway({
      balanceTransactions: {
        list: async () => ({ data: [{ id: "txn_r", amount: -10000, fee: 0, net: -10000, currency: "usd", created: oct15, type: "refund", source: "re_1", livemode: true }], has_more: false }),
        retrieve: async (id) => {
          calls.push(id);
          return { id, amount: 10000, fee: 300, net: 9700, currency: "usd", created: sep15, type: "charge", source: "ch_old", livemode: true };
        },
      },
      charges: {
        list: emptyPage,
        retrieve: async (id) => {
          calls.push(id);
          return { id, amount: 10000, amount_captured: 10000, currency: "usd", status: "succeeded", paid: true, captured: true, created: sep15, payment_intent: "pi_old", balance_transaction: "txn_old", livemode: true };
        },
      },
    });
    const evidence = await readStripeFinanceWindow(reader, period, { retrieveChargeIds: ["ch_old"] });
    expect(calls).toEqual(["ch_old", "txn_old"]);
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    const { match, report } = cards({
      charges: evidence.charges, balances: evidence.balances, payouts: evidence.payouts,
      payments: [payment({ id: "pay-old", paymentIntentId: "pi_old" })],
      refunds: [{ id: "row-1", amount: 100, status: "succeeded", chargeId: "ch_old", paymentIntentId: "pi_old", refundId: "re_1", paymentIds: ["pay-old"] }],
    });
    expect(match.complete).toBe(true);
    expect(report.grossCollected).toEqual({ value: 0, complete: true });
    expect(report.processingFees).toEqual({ value: 0, complete: true });
    expect(report.refunds).toEqual({ value: 10000, complete: true });
    expect(report.netCollections).toEqual({ value: -10000, complete: true });
  });
});

describe("Stripe reader call surface", () => {
  it("fails if a Stripe resource method other than list or retrieve is referenced", () => {
    const files = ["src/lib/unified-finance-stripe-read.server.ts", "src/lib/unified-finance-live.server.ts"];
    const allowed = new Set(["balanceTransactions.list", "balanceTransactions.retrieve", "payouts.list", "charges.list", "charges.retrieve"]);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\.(create|update|del|delete|capture|confirm|cancel|refund|close|approve)\s*\(/);
      const calls = [...source.matchAll(/\b(?:gateway|stripe)\.([A-Za-z]+)\.([A-Za-z]+)/g)].map((match) => `${match[1]}.${match[2]}`);
      if (file.endsWith("unified-finance-stripe-read.server.ts")) expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(allowed.has(call), `${file} references ${call}`).toBe(true);
    }
    const live = readFileSync("src/lib/unified-finance-live.server.ts", "utf8");
    const endpoint = readFileSync("src/lib/unified-finance.functions.ts", "utf8");
    expect(live.indexOf("assertUnifiedFinanceAccess")).toBeLessThan(live.indexOf("createStripeClient"));
    expect(endpoint).not.toContain("readStripeFinanceWindow");
    expect(endpoint).not.toContain("createStripeClient");
    expect(endpoint).toContain("UNIFIED_FINANCE_ENDPOINT_ENABLED");
  });
});
