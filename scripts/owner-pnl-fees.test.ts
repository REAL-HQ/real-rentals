import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOwnerPnl, monthWindow, ownerPnlCsv, type OwnerCharge, type OwnerPnlDirectory } from "../src/lib/owner-pnl";
import { stripeFeeCostCents, type OwnerFeeTxn } from "../src/lib/owner-pnl-fees";
import { readOwnerPnlFees, type OwnerFeeStripeGateway } from "../src/lib/owner-pnl-fees-read.server";
import { runOwnerPnl } from "../src/lib/owner-pnl.server";
import { STRIPE_READER_MAX_PAGES } from "../src/lib/stripe-reader";

const NOW = new Date("2026-10-21T15:00:00Z");
const OCTOBER = monthWindow("2026-10")!;

function directory(): OwnerPnlDirectory {
  return {
    payments: [{
      id: "pay1", vehicleId: "v1", type: "rent", status: "paid", paymentMethod: "stripe",
      amount: "80.00", paidDate: "2026-10-15", paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null,
    }],
    rentals: [],
    expenses: [],
    maintenance: [],
    refunds: [],
    vehicles: [{ id: "v1", year: 2020, make: "Ada", model: "One", licensePlate: "PL1" }],
  };
}

function charge(): OwnerCharge {
  return {
    id: "ch1", customerId: null, paymentIntentId: "pi_v1", invoiceId: null, subscriptionId: null,
    amountCents: 8000, currency: "usd", succeeded: true, created: OCTOBER.gte + 10,
  };
}

function txn(input: Partial<OwnerFeeTxn> & Pick<OwnerFeeTxn, "id" | "type" | "amount" | "fee" | "net">): OwnerFeeTxn {
  return {
    currency: "usd",
    created: OCTOBER.gte + 10,
    ...input,
  };
}

function reportWith(feesCents: number) {
  return buildOwnerPnl({
    ...directory(),
    month: "2026-10",
    currentCharges: [charge()],
    previousCharges: [],
    currentFees: { ok: true, feesCents },
    previousFees: { ok: true, feesCents: 0 },
  });
}

describe("monthly owner p&l stripe fees", () => {
  it("sums processing fees and subtracts the cost from net", () => {
    const txns = [
      txn({ id: "ch_a", type: "charge", amount: 5000, fee: 200, net: 4800 }),
      txn({ id: "ch_b", type: "charge", amount: 2500, fee: 105, net: 2395 }),
      txn({ id: "fee_1", type: "stripe_fee", amount: -15, fee: 0, net: -15 }),
      txn({ id: "po_1", type: "payout", amount: -10000, fee: 999, net: -10999 }),
    ];
    expect(stripeFeeCostCents(txns, OCTOBER)).toEqual({ ok: true, feesCents: 320 });
    const report = reportWith(320);
    expect(report?.current.revenueCents).toBe(8000);
    expect(report?.current.feesCents).toBe(320);
    expect(report?.current.feesComplete).toBe(true);
    expect(report?.current.netCents).toBe(7680);
    expect(report?.current.vehicles[0]?.netCents).toBe(8000);
    expect(report?.current.coverage).toBe("complete");
  });

  it("reduces the fee cost when a refund returns part of the fee", () => {
    const txns = [
      txn({ id: "ch_a", type: "charge", amount: 10000, fee: 300, net: 9700 }),
      txn({ id: "re_1", type: "refund", amount: -10000, fee: -50, net: -9950 }),
    ];
    expect(stripeFeeCostCents(txns, OCTOBER)).toEqual({ ok: true, feesCents: 250 });
    const report = reportWith(250);
    expect(report?.current.feesCents).toBe(250);
    expect(report?.current.netCents).toBe(7750);
    expect(ownerPnlCsv(report!)).toContain("Fees,2.50,0.00,2.50");
    expect(ownerPnlCsv(report!)).toContain("Net,77.50,0.00,77.50");
  });

  it("keeps revenue and marks fees Unavailable when the read fails", async () => {
    let feeReads = 0;
    const failed = await runOwnerPnl({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      month: "2026-10",
      now: NOW,
      load: async () => directory(),
      readCharges: async (window) => ({ ok: true, charges: window.gte === OCTOBER.gte ? [charge()] : [] }),
      readFees: async () => { feeReads += 1; return { ok: false }; },
    });
    expect(failed.status).toBe("ready");
    if (failed.status !== "ready") return;
    expect(feeReads).toBe(2);
    expect(failed.report.current.revenueCents).toBe(8000);
    expect(failed.report.current.feesCents).toBeNull();
    expect(failed.report.current.feesComplete).toBe(false);
    expect(failed.report.current.netCents).toBeNull();
    expect(failed.report.current.coverage).toBe("partial");
    expect(failed.report.previous.revenueCents).toBe(0);
    expect(failed.report.previous.netCents).toBeNull();
    expect(failed.report.change.feesCents).toBeNull();
    expect(failed.report.change.netCents).toBeNull();
    const csv = ownerPnlCsv(failed.report);
    expect(csv).toContain("Fees,Unavailable,Unavailable,");
    expect(csv).toContain("Net,Partial,Partial,");
    expect(csv).toContain("Revenue,80.00,0.00,80.00");

    let feesAfterChargeFailure = 0;
    const chargesFailed = await runOwnerPnl({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      month: "2026-10",
      now: NOW,
      load: async () => directory(),
      readCharges: async () => ({ ok: false, reason: "Stripe evidence was incomplete or timed out" }),
      readFees: async () => { feesAfterChargeFailure += 1; return { ok: true, feesCents: 0 }; },
    });
    expect(chargesFailed).toMatchObject({ status: "unavailable", report: null });
    expect(feesAfterChargeFailure).toBe(0);

    const thrown = await runOwnerPnl({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      month: "2026-10",
      now: NOW,
      load: async () => directory(),
      readCharges: async () => ({ ok: true, charges: [] }),
      readFees: async () => { throw new Error("stripe down"); },
    });
    expect(thrown.status).toBe("ready");
    if (thrown.status !== "ready") return;
    expect(thrown.report.current.feesComplete).toBe(false);
    expect(thrown.report.current.coverage).toBe("partial");
    expect(thrown.report.current.revenueCents).toBe(0);
  });

  it("includes a balance transaction at the Eastern month start and excludes the next month", async () => {
    const boundary = [
      txn({ id: "start", type: "charge", amount: 1000, fee: 125, net: 875, created: OCTOBER.gte }),
      txn({ id: "before", type: "charge", amount: 1000, fee: 50, net: 950, created: OCTOBER.gte - 1 }),
      txn({ id: "end", type: "charge", amount: 1000, fee: 400, net: 600, created: OCTOBER.lt }),
      txn({ id: "eur", type: "charge", amount: 100, fee: 999, net: -899, currency: "eur", created: OCTOBER.lt }),
    ];
    expect(stripeFeeCostCents(boundary, OCTOBER)).toEqual({ ok: true, feesCents: 125 });
    const calls: { created?: { gte: number; lt: number } }[] = [];
    const read = await readOwnerPnlFees({
      balanceTransactions: {
        list: async (params) => {
          calls.push(params);
          return {
            data: boundary.map((row) => ({ ...row, livemode: true })),
            has_more: false,
          };
        },
      },
    }, { gte: OCTOBER.gte, lt: OCTOBER.lt });
    expect(calls[0]?.created).toEqual({ gte: OCTOBER.gte, lt: OCTOBER.lt });
    expect(read).toEqual({ ok: true, feesCents: 125 });
    const report = reportWith(125);
    expect(report?.current.netCents).toBe(7875);
    expect(OCTOBER.lt).toBe(monthWindow("2026-11")!.gte);
  });
});

describe("stripe fee sign convention", () => {
  it("turns a negative stripe_fee net and a positive charge fee into one positive cost, then reverses a refund fee once", async () => {
    const created = OCTOBER.gte + 10;
    const chargeTxn = {
      id: "txn_charge",
      object: "balance_transaction",
      amount: 10000,
      fee: 320,
      net: 9680,
      currency: "usd",
      created,
      type: "charge",
      status: "available",
      livemode: true,
      fee_details: [
        { amount: 290, currency: "usd", type: "stripe_fee", description: "Stripe processing fees" },
        { amount: 30, currency: "usd", type: "stripe_fee", description: "Stripe processing fees" },
      ],
    };
    const stripeFee = {
      id: "txn_stripe_fee",
      object: "balance_transaction",
      amount: -150,
      fee: 0,
      net: -150,
      currency: "usd",
      created: created + 1,
      type: "stripe_fee",
      status: "available",
      livemode: true,
      fee_details: [],
    };
    const refundTxn = {
      id: "txn_refund",
      object: "balance_transaction",
      amount: -10000,
      fee: -320,
      net: -9680,
      currency: "usd",
      created: created + 2,
      type: "refund",
      status: "available",
      livemode: true,
      fee_details: [{ amount: -320, currency: "usd", type: "stripe_fee", description: "Stripe processing fees" }],
    };
    expect(stripeFee.net).toBeLessThan(0);
    expect(chargeTxn.fee).toBeGreaterThan(0);
    expect(refundTxn.fee).toBeLessThan(0);
    const read = await readOwnerPnlFees({
      balanceTransactions: { list: async () => ({ data: [chargeTxn, stripeFee, refundTxn], has_more: false }) },
    }, OCTOBER);
    expect(read).toEqual({ ok: true, feesCents: 150 });
    const report = buildOwnerPnl({
      ...directory(),
      month: "2026-10",
      currentCharges: [{ ...charge(), amountCents: 10000 }],
      previousCharges: [],
      currentFees: read,
      previousFees: { ok: true, feesCents: 0 },
    });
    expect(report?.current.revenueCents).toBe(10000);
    expect(report?.current.feesCents).toBe(150);
    expect(report?.current.netCents).toBe(9850);
    expect(report?.current.netCents).toBe((report?.current.revenueCents ?? 0) - (report?.current.feesCents ?? 0));
    expect(report?.current.vehicles[0]?.netCents).toBe(10000);
    expect(report?.current.netCents).toBe((report?.current.vehicles[0]?.netCents ?? 0) - (report?.current.feesCents ?? 0));
    const csv = ownerPnlCsv(report!);
    expect(csv).toContain("Fees,1.50,0.00,1.50");
    expect(csv).toContain("Net,98.50,0.00,98.50");
    expect(csv).toContain("Revenue,100.00,0.00,100.00");
  });
});

describe("owner pnl fee reader", () => {
  it("returns no cost when the list fails, is truncated, or is not USD", async () => {
    const thrown = await readOwnerPnlFees({
      balanceTransactions: { list: async () => { throw new Error("stripe down"); } },
    }, OCTOBER);
    expect(thrown).toEqual({ ok: false });

    let pages = 0;
    const capped = await readOwnerPnlFees({
      balanceTransactions: {
        list: async () => {
          pages += 1;
          return { data: [{ id: `txn_${pages}` }], has_more: true };
        },
      },
    }, OCTOBER);
    expect(capped).toEqual({ ok: false });
    expect(pages).toBe(STRIPE_READER_MAX_PAGES);

    const foreign = await readOwnerPnlFees(listOf([
      txn({ id: "eur", type: "charge", amount: 100, fee: 30, net: 70, currency: "eur" }),
    ]), OCTOBER);
    expect(foreign).toEqual({ ok: false });

    const broken = await readOwnerPnlFees(listOf([
      txn({ id: "bad", type: "charge", amount: 100, fee: 30, net: 71 }),
    ]), OCTOBER);
    expect(broken).toEqual({ ok: false });

    const testMode = await readOwnerPnlFees({
      balanceTransactions: {
        list: async () => ({
          data: [
            { id: "test", livemode: false, type: "charge", amount: 1, fee: 999, net: -998, currency: "usd", created: OCTOBER.gte },
            { id: "live", livemode: true, type: "charge", amount: 1000, fee: 40, net: 960, currency: "usd", created: OCTOBER.gte },
          ],
          has_more: false,
        }),
      },
    }, OCTOBER);
    expect(testMode).toEqual({ ok: true, feesCents: 40 });

    const reader = readFileSync(new URL("../src/lib/stripe-reader.server.ts", import.meta.url), "utf8");
    expect(reader).toContain("list");
    expect(reader).toContain("retrieve");
  });
});

function listOf(rows: OwnerFeeTxn[]): OwnerFeeStripeGateway {
  return {
    balanceTransactions: {
      list: async () => ({
        data: rows.map((row) => ({ ...row, livemode: true })),
        has_more: false,
      }),
    },
  };
}
