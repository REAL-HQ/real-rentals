import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { STRIPE_PAYOUT_RECON_ENABLED, STRIPE_PAYOUT_RECON_OFF } from "../src/lib/stripe-payout-recon-flag";
import {
  STRIPE_CHECK_UNAVAILABLE,
  arrivalEt,
  buildPayoutRecon,
  formatCents,
  payoutReconToCsv,
  payoutReconWindow,
  type ReconPayment,
  type ReconTxn,
} from "../src/lib/stripe-payout-recon";
import { runPayoutRecon } from "../src/lib/stripe-payout-recon.server";
import { readPayoutRecon, type PayoutReconGateway } from "../src/lib/stripe-payout-recon-read.server";
import { STRIPE_READER_MAX_PAGES } from "../src/lib/stripe-reader";

const stripeMock = vi.hoisted(() => {
  const payoutCreate = vi.fn();
  const payoutCancel = vi.fn();
  const refundCreate = vi.fn();
  const createStripeClient = vi.fn(() => ({
    payouts: { create: payoutCreate, cancel: payoutCancel, list: vi.fn(async () => ({ data: [], has_more: false })) },
    refunds: { create: refundCreate },
    balanceTransactions: { list: vi.fn(async () => ({ data: [], has_more: false })) },
  }));
  return { payoutCreate, payoutCancel, refundCreate, createStripeClient };
});
vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));
import { createReadOnlyStripe } from "../src/lib/stripe-reader.server";

const NOW = new Date("2026-10-21T15:00:00Z");

function txn(over: Partial<ReconTxn> = {}): ReconTxn {
  return {
    id: "txn_charge",
    type: "charge",
    amount: 10050,
    fee: 320,
    net: 9730,
    currency: "usd",
    chargeId: "ch_match",
    paymentIntentId: "pi_match",
    invoiceId: null,
    subscriptionId: null,
    customerId: null,
    ...over,
  };
}

function payment(over: Partial<ReconPayment> = {}): ReconPayment {
  return {
    id: "pay_match",
    driverId: "app_ada",
    status: "paid",
    amount: 100.5,
    netCollected: 100.5,
    paidDate: "2026-01-01",
    stripePaymentIntentId: "pi_match",
    stripeInvoiceId: null,
    ...over,
  };
}

function emptyLoad() {
  return async () => ({ ok: true as const, directory: { applications: [], payments: [] } });
}

describe("Stripe Payout Reconciliation", () => {
  beforeEach(() => {
    stripeMock.payoutCreate.mockClear();
    stripeMock.payoutCancel.mockClear();
    stripeMock.refundCreate.mockClear();
    stripeMock.createStripeClient.mockClear();
  });

  it("throws while the flag is off, before any read", async () => {
    expect(STRIPE_PAYOUT_RECON_ENABLED).toBe(false);
    const load = vi.fn();
    const readStripe = vi.fn();
    await expect(runPayoutRecon({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      now: NOW,
      load,
      readStripe,
    })).rejects.toThrow(STRIPE_PAYOUT_RECON_OFF);
    expect(load).not.toHaveBeenCalled();
    expect(readStripe).not.toHaveBeenCalled();
  });

  it("lets owners and managers read, and refuses a coordinator before any read", async () => {
    const load = vi.fn(emptyLoad());
    const readStripe = vi.fn(async () => ({ ok: true as const, payouts: [] }));
    await expect(runPayoutRecon({ enabled: true, userId: "coord-1", tier: "coordinator", now: NOW, load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runPayoutRecon({ enabled: true, userId: null, tier: "owner", now: NOW, load, readStripe })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
    expect(readStripe).not.toHaveBeenCalled();
    const owner = await runPayoutRecon({ enabled: true, userId: "owner-1", tier: "owner", now: NOW, load, readStripe });
    const manager = await runPayoutRecon({ enabled: true, userId: "mgr-1", tier: "manager", now: NOW, load, readStripe });
    expect(owner.report.payouts).toEqual([]);
    expect(manager.report.stripeCheck).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses the last 60 Eastern Time days and shows arrival in Eastern Time", () => {
    const window = payoutReconWindow(NOW);
    expect(window).toMatchObject({ from: "2026-08-23", through: "2026-10-21" });
    const evening = payoutReconWindow(new Date("2026-10-21T03:30:00Z"));
    expect(evening).toMatchObject({ from: "2026-08-22", through: "2026-10-20" });
    expect(arrivalEt(Math.floor(Date.parse("2026-10-21T03:30:00Z") / 1000))).toBe("2026-10-20");
    expect(formatCents(10050)).toBe("$100.50");
    expect(formatCents(-320)).toBe("-$3.20");
  });

  it("matches payment intents, lists unmatched charges, and keeps paid Stripe payments that are in no payout", () => {
    const window = payoutReconWindow(NOW)!;
    const report = buildPayoutRecon({
      window,
      applications: [
        { id: "app_ada", name: 'Ada, "Bee"', deleted: false },
        { id: "app_cmd", name: "=cmd", deleted: false },
        { id: "app_gone", name: "Gone", deleted: true },
      ],
      payouts: [
        {
          id: "po_new",
          amount: 9730,
          currency: "usd",
          status: "paid",
          arrival: Math.floor(Date.parse("2026-10-15T16:00:00Z") / 1000),
          transactions: [
            txn(),
            txn({ id: "txn_refund", type: "refund", amount: -2000, fee: -20, net: -1980, chargeId: "ch_match", paymentIntentId: "pi_match" }),
            txn({ id: "txn_open", type: "charge", amount: 123456, fee: 0, net: 123456, chargeId: "ch_open", paymentIntentId: "pi_unknown" }),
            txn({ id: "txn_bare", type: "charge", amount: 500, fee: 0, net: 500, chargeId: "ch_bare", paymentIntentId: null }),
            txn({ id: "txn_adjust", type: "adjustment", amount: -100, fee: 0, net: -100, chargeId: null, paymentIntentId: null }),
            txn({ id: "txn_payout", type: "payout", amount: -9730, fee: 0, net: -9730, chargeId: null, paymentIntentId: null }),
          ],
        },
        {
          id: "po_old",
          amount: 100,
          currency: "eur",
          status: "in_transit",
          arrival: Math.floor(Date.parse("2026-09-01T16:00:00Z") / 1000),
          transactions: [txn({ id: "txn_eur", currency: "eur", amount: 100, fee: 0, net: 100, paymentIntentId: null, chargeId: "ch_eur" })],
        },
      ],
      payments: [
        payment({ driverId: "app_gone", id: "pay_gone" }),
        payment(),
        payment({ id: "pay_loose", driverId: "app_cmd", amount: 1234.56, netCollected: null, paidDate: "2026-09-15", stripePaymentIntentId: "pi_loose", status: "Paid" }),
        payment({ id: "pay_cash", stripePaymentIntentId: null, paidDate: "2026-09-15" }),
        payment({ id: "pay_early", stripePaymentIntentId: "pi_early", paidDate: "2026-08-22" }),
        payment({ id: "pay_late", stripePaymentIntentId: "pi_late", paidDate: "2026-10-22" }),
        payment({ id: "pay_refunded", driverId: null, stripePaymentIntentId: "pi_refunded", status: "refunded", paidDate: "2026-10-21T03:30:00Z", amount: 10, netCollected: 0 }),
      ],
    });
    expect(report.payouts.map((payout) => payout.id)).toEqual(["po_new", "po_old"]);
    const payout = report.payouts[0]!;
    expect(payout.arrivalEt).toBe("2026-10-15");
    expect(payout.status).toBe("Paid");
    expect(payout.amountCents).toBe(9730);
    expect(payout.grossCents).toBe(10050 + 123456 + 500);
    expect(payout.feesCents).toBe(-300);
    expect(payout.refundsCents).toBe(-2000);
    expect(payout.netCents).toBe(9730 - 1980 + 123456 + 500 - 100);
    expect(payout.matched.map((row) => row.id)).toEqual(["pay_gone", "pay_match"]);
    expect(payout.matched[1]).toMatchObject({ driverName: 'Ada, "Bee"', applicationId: "app_ada", amountCents: 10050, paymentIntentId: "pi_match" });
    expect(payout.matched[0]).toMatchObject({ driverName: null, applicationId: null });
    expect(payout.unmatchedCharges.map((row) => row.id)).toEqual(["ch_open", "ch_bare"]);
    expect(report.payouts[1]).toMatchObject({ amountCents: null, grossCents: null, feesCents: null, refundsCents: null, netCents: null });
    expect(report.paidNotInPayout.map((row) => [row.id, row.amountCents, row.driverName, row.status])).toEqual([
      ["pay_loose", 123456, "=cmd", "Paid"],
      ["pay_refunded", 0, null, "Refunded"],
    ]);
    const csv = payoutReconToCsv(report);
    expect(csv).toContain('"Ada, ""Bee"""');
    expect(csv).toContain(`"'=cmd"`);
    expect(csv).toContain('"$1,234.56"');
    expect(csv.startsWith("Stripe Payout Reconciliation\r\n")).toBe(true);
    expect(STRIPE_CHECK_UNAVAILABLE).toBe("Stripe check unavailable");
  });

  it("matches an invoice-recorded payment and does not list it as unmatched", () => {
    const report = buildPayoutRecon({
      window: payoutReconWindow(NOW)!,
      payouts: [{
        id: "po_auto",
        amount: 9000,
        currency: "usd",
        status: "paid",
        arrival: Math.floor(Date.parse("2026-10-15T16:00:00Z") / 1000),
        transactions: [txn({
          id: "txn_auto",
          chargeId: "ch_auto",
          paymentIntentId: "pi_autopay",
          invoiceId: "in_auto",
          subscriptionId: "sub_1",
          customerId: "cus_ABCDEFGH",
          amount: 9000,
          fee: 0,
          net: 9000,
        })],
      }],
      payments: [payment({
        id: "pay_auto",
        stripePaymentIntentId: null,
        stripeInvoiceId: "in_auto",
        paidDate: "2026-10-15",
        amount: 90,
        netCollected: 90,
      })],
      applications: [{ id: "app_ada", name: "Ada", deleted: false }],
      rentals: [{ subscriptionId: "sub_1" }],
    });
    expect(report.payouts[0]?.matched.map((row) => row.id)).toEqual(["pay_auto"]);
    expect(report.payouts[0]?.matched[0]?.fleetLink).toBe("Linked");
    expect(report.payouts[0]?.unmatchedCharges).toEqual([]);
    expect(report.paidNotInPayout).toEqual([]);
  });

  it("keeps a charge unmatched when neither the payment intent nor the invoice id is recorded", () => {
    const report = buildPayoutRecon({
      window: payoutReconWindow(NOW)!,
      payouts: [{
        id: "po_open",
        amount: 500,
        currency: "usd",
        status: "paid",
        arrival: Math.floor(Date.parse("2026-10-15T16:00:00Z") / 1000),
        transactions: [txn({
          id: "txn_open_invoice",
          chargeId: "ch_open_invoice",
          paymentIntentId: "pi_missing",
          invoiceId: "in_missing",
          subscriptionId: "sub_missing",
          customerId: "cus_MISSING",
          amount: 500,
          fee: 0,
          net: 500,
        })],
      }],
      payments: [payment({ id: "pay_other", stripePaymentIntentId: "pi_other", stripeInvoiceId: "in_other" })],
      applications: [],
      applicationLinks: [{ customerId: "cus_OTHER" }],
    });
    expect(report.payouts[0]?.matched).toEqual([]);
    expect(report.payouts[0]?.unmatchedCharges.map((row) => [row.id, row.fleetLink])).toEqual([["ch_open_invoice", "Not Linked"]]);
  });

  it("withholds the payouts when the paid invoice list is capped", async () => {
    const window = payoutReconWindow(NOW)!;
    let pages = 0;
    const read = await readPayoutRecon({
      payouts: { list: async () => ({ data: [{ id: "po_live", amount: 100, currency: "usd", status: "paid", arrival_date: window.gte, livemode: true }], has_more: false }) },
      balanceTransactions: { list: async () => ({ data: [{ id: "txn_1", type: "charge", amount: 100, fee: 0, net: 100, currency: "usd", livemode: true, source: { id: "ch_1", payment_intent: "pi_abc" } }], has_more: false }) },
      invoices: {
        list: async () => {
          pages += 1;
          return { data: [{ id: `in_${pages}`, payments: { data: [], has_more: false } }], has_more: true };
        },
      },
    }, window);
    expect(pages).toBe(STRIPE_READER_MAX_PAGES);
    expect(read).toEqual({ ok: false, capped: true });
  });

  it("withholds every row when Stripe errors or hits the page cap", async () => {
    const window = payoutReconWindow(NOW)!;
    const balances = vi.fn();
    const load = vi.fn();
    const errored = await runPayoutRecon({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      now: NOW,
      load,
      readStripe: () => readPayoutRecon({
        payouts: { list: async () => { throw new Error("stripe down"); } },
        balanceTransactions: { list: balances },
      }, window),
    });
    expect(errored.report).toMatchObject({
      stripeCheck: "unavailable",
      directory: "skipped",
      payouts: [],
      paidNotInPayout: [],
      from: "2026-08-23",
      through: "2026-10-21",
    });
    expect(load).not.toHaveBeenCalled();
    expect(balances).not.toHaveBeenCalled();

    let pages = 0;
    const cappedBalances = vi.fn();
    const capped = await runPayoutRecon({
      enabled: true,
      userId: "owner-1",
      tier: "manager",
      now: NOW,
      load,
      readStripe: () => readPayoutRecon({
        payouts: {
          list: async () => {
            pages += 1;
            return { data: [{ id: `po_${pages}`, amount: 100, arrival_date: window.gte, status: "paid", currency: "usd", livemode: true }], has_more: true };
          },
        },
        balanceTransactions: { list: cappedBalances },
      }, window),
    });
    expect(pages).toBe(STRIPE_READER_MAX_PAGES);
    expect(cappedBalances).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(capped.report.stripeCheck).toBe("unavailable");
    expect(capped.report.payouts).toEqual([]);
  });

  it("refuses payout create, payout cancel, and refund create before the Stripe method runs", async () => {
    const window = payoutReconWindow(NOW)!;
    const payoutCreate = vi.fn();
    const payoutCancel = vi.fn();
    const refundCreate = vi.fn();
    const gateway = {
      payouts: {
        list: async () => ({ data: [], has_more: false }),
        create: payoutCreate,
        cancel: payoutCancel,
      },
      balanceTransactions: { list: async () => ({ data: [], has_more: false }) },
      invoices: { list: async () => ({ data: [], has_more: false }) },
      refunds: { create: refundCreate },
    };
    await readPayoutRecon(gateway as PayoutReconGateway, window);
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(payoutCancel).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();

    const stripe = createReadOnlyStripe("live", { cache: true });
    expect(() => stripe.payouts.create({ amount: 1, currency: "usd" })).toThrow("Stripe reader refuses payouts.create");
    expect(() => stripe.payouts.cancel("po_1")).toThrow("Stripe reader refuses payouts.cancel");
    expect(() => stripe.refunds.create({ charge: "ch_1" })).toThrow("Stripe reader refuses refunds.create");
    expect(stripeMock.payoutCreate).not.toHaveBeenCalled();
    expect(stripeMock.payoutCancel).not.toHaveBeenCalled();
    expect(stripeMock.refundCreate).not.toHaveBeenCalled();
  });

  it("reads an expanded charge payment intent from the payout's balance transactions", async () => {
    const window = payoutReconWindow(NOW)!;
    const payouts = vi.fn(async (params: { arrival_date: { gte: number; lt: number } }) => {
      expect(params.arrival_date).toEqual({ gte: window.gte, lt: window.lt });
      return {
        data: [
          { id: "po_live", amount: 10050, currency: "usd", status: "paid", arrival_date: window.gte, livemode: true },
          { id: "po_test", amount: 100, currency: "usd", status: "paid", arrival_date: window.gte, livemode: false },
        ],
        has_more: false,
      };
    });
    const balances = vi.fn(async (params: { payout: string; expand: string[] }) => {
      expect(params.payout).toBe("po_live");
      expect(params.expand).toEqual(["data.source"]);
      return {
        data: [
          { id: "txn_1", type: "charge", amount: 10050, fee: 320, net: 9730, currency: "usd", livemode: true, source: { id: "ch_1", payment_intent: "pi_abc" } },
          { id: "txn_test", type: "charge", amount: 1, fee: 0, net: 1, currency: "usd", livemode: false, source: "ch_test" },
        ],
        has_more: false,
      };
    });
    const invoices = vi.fn(async () => ({
      data: [{
        id: "in_abc",
        status: "paid",
        livemode: true,
        customer: "cus_abc",
        subscription: "sub_abc",
        payments: { data: [{ payment: { payment_intent: "pi_abc" } }], has_more: false },
      }],
      has_more: false,
    }));
    const read = await readPayoutRecon({ payouts: { list: payouts }, balanceTransactions: { list: balances }, invoices: { list: invoices } }, window);
    expect(read).toEqual({
      ok: true,
      payouts: [{
        id: "po_live",
        amount: 10050,
        currency: "usd",
        status: "paid",
        arrival: window.gte,
        transactions: [{
          id: "txn_1",
          type: "charge",
          amount: 10050,
          fee: 320,
          net: 9730,
          currency: "usd",
          chargeId: "ch_1",
          paymentIntentId: "pi_abc",
          invoiceId: "in_abc",
          subscriptionId: "sub_abc",
          customerId: "cus_abc",
        }],
      }],
    });
    const bad = await readPayoutRecon({
      payouts: { list: async () => ({ data: [{ id: "po_bad", currency: "usd", status: "paid", arrival_date: window.gte, livemode: true }], has_more: false }) },
      balanceTransactions: { list: vi.fn() },
    }, window);
    expect(bad).toEqual({ ok: false, capped: false });
  });

  it("withholds rows when driver records are incomplete", async () => {
    const readStripe = vi.fn(async () => ({
      ok: true as const,
      payouts: [{ id: "po_1", amount: 100, currency: "usd", status: "paid", arrival: 1, transactions: [] }],
    }));
    const result = await runPayoutRecon({
      enabled: true,
      userId: "owner-1",
      tier: "owner",
      now: NOW,
      load: async () => ({ ok: false, capped: true }),
      readStripe,
    });
    expect(result.report.stripeCheck).toBe("ready");
    expect(result.report.directory).toBe("unavailable");
    expect(result.report.payouts).toEqual([]);
    expect(result.report.paidNotInPayout).toEqual([]);
    expect(readStripe).toHaveBeenCalledTimes(1);
  });

  it("stays out of the tab list and throws before the manager check", () => {
    const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
    const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabs).not.toMatch(/id: "stripe_payout_recon"/);
    expect(TABS.some((tab) => tab.id === "stripe_payout_recon")).toBe(false);
    for (const tier of ["owner", "manager", "coordinator"] as const) {
      expect(visibleTabs(tier).some((tab) => tab.id === "stripe_payout_recon")).toBe(false);
      expect(railEntries(tier).some((tab) => tab.id === "stripe_payout_recon")).toBe(false);
    }
    const handler = readFileSync("src/lib/stripe-payout-recon.functions.ts", "utf8");
    const off = handler.indexOf("if (!STRIPE_PAYOUT_RECON_ENABLED) throw new Error(STRIPE_PAYOUT_RECON_OFF)");
    const role = handler.indexOf("await requireManager(context.userId)");
    const directory = handler.indexOf("loadPayoutReconDirectory(");
    const stripe = handler.indexOf("readLivePayoutRecon(");
    expect(off).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(off);
    expect(directory).toBeGreaterThan(role);
    expect(stripe).toBeGreaterThan(role);
    expect(handler.indexOf('await import("./stripe-payout-recon-read.server")')).toBeGreaterThan(role);
    expect(handler.indexOf('await import("@/integrations/supabase/client.server")')).toBeGreaterThan(role);
    expect(handler).toContain(".inputValidator((data: unknown) => data)");
    const admin = readFileSync("src/routes/admin.tsx", "utf8");
    const special = admin.indexOf('urlTab === "stripe_payout_recon"');
    expect(special).toBeGreaterThan(-1);
    expect(special).toBeLessThan(admin.indexOf("TABS.some"));
    expect(admin).toContain('STRIPE_PAYOUT_RECON_ENABLED && tab === "stripe_payout_recon"');
    const panel = readFileSync("src/components/admin/StripePayoutReconPanel.tsx", "utf8");
    expect(panel).toContain("STRIPE_CHECK_UNAVAILABLE");
    expect(panel).toContain("Download CSV");
    const reader = readFileSync("src/lib/stripe-payout-recon-read.server.ts", "utf8");
    expect(reader).toContain('createReadOnlyStripe("live", { cache: true })');
    expect(reader).toContain('expand: ["data.source"]');
    expect(reader).toContain("arrival_date");
    expect(reader).not.toContain(".retrieve(");
    expect(reader).not.toContain("createStripeClient");
    expect(reader).not.toMatch(/payouts\s*\.\s*create\s*\(/);
    expect(reader).not.toMatch(/payouts\s*\.\s*cancel\s*\(/);
    expect(reader).not.toMatch(/refunds\s*\.\s*create\s*\(/);
    for (const file of [
      "src/lib/stripe-payout-recon.ts",
      "src/lib/stripe-payout-recon-flag.ts",
      "src/lib/stripe-payout-recon-read.server.ts",
      "src/lib/stripe-payout-recon.server.ts",
      "src/lib/stripe-payout-recon.functions.ts",
      "src/components/admin/StripePayoutReconPanel.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\.(insert|update|delete|upsert)\(/);
      expect(source, file).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
    }
  });
});
