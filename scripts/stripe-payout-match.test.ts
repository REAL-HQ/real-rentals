import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fleetLink, paidNotInPayout, unmatchedCharges, type PayoutCharge } from "../src/lib/stripe-payout-match";
import {
  DIRECTORY_MAX_PAGES,
  DIRECTORY_PAGE,
  INVOICE_MAX_PAGES,
} from "../src/lib/stripe-unmatched.server";
import { loadPayoutMatch, PAYOUT_MAX_PAGES, TXN_MAX_PAGES } from "../src/lib/stripe-payout-match.server";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const ARRIVAL = Math.floor(Date.parse("2026-10-16T16:00:00.000Z") / 1000);

describe("payout match links", () => {
  const limits = { directoryComplete: true, invoicesComplete: true };
  const charges: PayoutCharge[] = [
    charge("po_1", "ch_known", "pi_known", "cus_ABCDEFGH", "sub_known", true),
    charge("po_1", "ch_sub", "pi_sub", "cus_OTHER999", "sub_known", true),
    charge("po_1", "ch_app", "pi_app", "cus_APP12345", null, false),
    charge("po_1", "ch_none", "pi_none", "cus_ZZZZZZZZ", null, false),
  ];

  it("keeps a payment-intent match out of the unmatched list and reuses invoiceIsLinked for the rest", () => {
    const rows = unmatchedCharges(
      charges,
      new Set(["pi_known"]),
      [{ subscriptionId: "sub_known", customerId: null }],
      [{ customerId: "cus_APP12345" }],
      limits,
    );
    expect(rows.map((row) => row.chargeId)).toEqual(["ch_app", "ch_none", "ch_sub"]);
    expect(rows.find((row) => row.chargeId === "ch_sub")).toMatchObject({ fleetLinked: true, customerSuffix: "R999" });
    expect(rows.find((row) => row.chargeId === "ch_app")).toMatchObject({ fleetLinked: true, customerSuffix: "2345" });
    expect(rows.find((row) => row.chargeId === "ch_none")).toMatchObject({ fleetLinked: false, customerSuffix: "ZZZZ" });
    expect(JSON.stringify(rows)).not.toContain("cus_ABCDEFGH");
    expect(JSON.stringify(rows)).not.toContain("email");
  });

  it("withholds a negative fleet link when the directory or the invoice index is incomplete", () => {
    const lonely = charge("po_1", "ch_none", "pi_none", "cus_ZZZZZZZZ", null, false);
    const known = charge("po_1", "ch_app", "pi_app", "cus_APP12345", null, false);
    expect(fleetLink(lonely, [], [], { directoryComplete: false, invoicesComplete: true })).toBeNull();
    expect(fleetLink(known, [], [{ customerId: "cus_APP12345" }], { directoryComplete: false, invoicesComplete: true })).toBe(true);
    expect(fleetLink(lonely, [], [], { directoryComplete: true, invoicesComplete: false })).toBeNull();
    expect(fleetLink({ ...lonely, invoiceSeen: true }, [], [], { directoryComplete: true, invoicesComplete: false })).toBe(false);
  });

  it("lists a paid payment whose intent never appears on a loaded payout", () => {
    const gaps = paidNotInPayout({
      payments: [
        { id: "pay-gap", status: "paid", paidDate: "2026-10-16", paymentIntentId: "pi_gap", amount: 150 },
        { id: "pay-seen", status: "paid", paidDate: "2026-10-16", paymentIntentId: "pi_known", amount: 90 },
        { id: "pay-old", status: "paid", paidDate: "2026-01-01", paymentIntentId: "pi_old", amount: 10 },
        { id: "pay-fail", status: "failed", paidDate: "2026-10-16", paymentIntentId: "pi_fail", amount: 10 },
      ],
      seenIntents: new Set(["pi_known"]),
      from: "2026-08-23",
      to: "2026-10-21",
    });
    expect(gaps).toEqual([{ paymentId: "pay-gap", paymentIntentId: "pi_gap", amountCents: 15000, paidOn: "2026-10-16" }]);
  });
});

describe("payout match reads", () => {
  it("lists unmatched payout charges and drops one that is already a payment", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const report = await loadPayoutMatch(memoryDb({
      payments: [{ id: "pay-1", stripe_payment_intent_id: "pi_known", status: "paid", paid_date: "2026-10-16", amount: 90 }],
      rentals: [{ id: "r1", stripe_subscription_id: "sub_known", stripe_customer_id: null }],
      applications: [{ id: "a1", stripe_customer_id: "cus_APP12345" }],
    }), stripeOnce(seen), NOW);
    expect(seen[0]).toMatchObject({ limit: 100, arrival_date: { lt: expect.any(Number) } });
    const arrival = seen[0].arrival_date as { gte: number; lt: number };
    expect(ARRIVAL).toBeGreaterThanOrEqual(arrival.gte);
    expect(ARRIVAL).toBeLessThan(arrival.lt);
    expect(seen.some((query) => query.expand)).toBe(true);
    expect(report.status).toBe("ready");
    if (report.status !== "ready") return;
    expect(report.truncated).toBe(false);
    expect(report.payouts.map((row) => row.id)).toEqual(["po_1"]);
    expect(report.payouts[0]).toMatchObject({ arrival: "2026-10-16", status: "Paid", amountCents: 15000 });
    expect(report.unmatched.map((row) => row.chargeId)).toEqual(["ch_app", "ch_none", "ch_sub"]);
    expect(report.unmatched.find((row) => row.chargeId === "ch_sub")?.fleetLinked).toBe(true);
    expect(report.unmatched.find((row) => row.chargeId === "ch_none")?.fleetLinked).toBe(false);
    expect(report.paidNotInPayout).toEqual([]);
  });

  it("returns unavailable when Stripe throws, which is not the capped state", async () => {
    const report = await loadPayoutMatch(memoryDb({ payments: [], rentals: [], applications: [] }), {
      payouts: { list: async () => { throw new Error("network"); } },
      balanceTransactions: { list: async () => ({ data: [], has_more: false }) },
      invoices: { list: async () => ({ data: [], has_more: false }) },
    }, NOW);
    expect(report).toEqual({ status: "unavailable", reason: "Stripe Could Not Be Read", payouts: [], unmatched: [], paidNotInPayout: [], truncated: false });
  });

  it("caps payout pages separately from a failed read and does not invent paid-not-in-payout rows", async () => {
    expect(PAYOUT_MAX_PAGES).toBe(10);
    expect(TXN_MAX_PAGES).toBe(4);
    let page = 0;
    const report = await loadPayoutMatch(memoryDb({
      payments: [{ id: "pay-gap", stripe_payment_intent_id: "pi_gap", status: "paid", paid_date: "2026-10-16", amount: 150 }],
      rentals: [],
      applications: [],
    }), {
      payouts: {
        list: async () => {
          page += 1;
          return { data: [payout(`po_${String(page).padStart(2, "0")}`)], has_more: true };
        },
      },
      balanceTransactions: { list: async () => ({ data: [], has_more: false }) },
      invoices: { list: async () => ({ data: [], has_more: false }) },
    }, NOW);
    expect(page).toBe(PAYOUT_MAX_PAGES);
    expect(report.status).toBe("ready");
    if (report.status !== "ready") return;
    expect(report.truncated).toBe(true);
    expect(report.truncatedBecause).toBe("payouts");
    expect(report.payouts).toHaveLength(PAYOUT_MAX_PAGES);
    expect(report.paidNotInPayout).toEqual([]);
    expect(report.unmatched).toEqual([]);
  });

  it("withholds unmatched charges when the payment directory is capped, and withholds a false fleet link when rentals are capped", async () => {
    expect(DIRECTORY_PAGE).toBe(200);
    const payments = Array.from({ length: DIRECTORY_PAGE * DIRECTORY_MAX_PAGES + 1 }, (_, index) => ({
      id: `p-${String(index).padStart(5, "0")}`,
      stripe_payment_intent_id: null,
      status: "pending",
      paid_date: null,
      amount: 1,
    }));
    const cappedPayments = await loadPayoutMatch(memoryDb({ payments, rentals: [], applications: [] }), stripeOnce(), NOW);
    expect(cappedPayments).toMatchObject({ status: "ready", truncated: true, truncatedBecause: "payments", unmatched: [] });

    const rentals = Array.from({ length: DIRECTORY_PAGE * DIRECTORY_MAX_PAGES + 1 }, (_, index) => ({
      id: `r-${String(index).padStart(5, "0")}`,
      stripe_subscription_id: null,
      stripe_customer_id: index === 0 ? "cus_APP12345" : null,
    }));
    const cappedRentals = await loadPayoutMatch(memoryDb({ payments: [], rentals, applications: [] }), stripeOnce(), NOW);
    expect(cappedRentals.status).toBe("ready");
    if (cappedRentals.status !== "ready") return;
    expect(cappedRentals.truncatedBecause).toBe("directory");
    expect(cappedRentals.unmatched.find((row) => row.chargeId === "ch_app")?.fleetLinked).toBe(true);
    expect(cappedRentals.unmatched.find((row) => row.chargeId === "ch_none")?.fleetLinked).toBeNull();
  });

  it("does not call an unread subscription a miss when the invoice list is capped", async () => {
    expect(INVOICE_MAX_PAGES).toBe(10);
    let page = 0;
    const report = await loadPayoutMatch(memoryDb({ payments: [], rentals: [], applications: [] }), {
      payouts: { list: async () => ({ data: [payout("po_1")], has_more: false }) },
      balanceTransactions: { list: async () => ({ data: [txn("txn_none", "ch_none", "pi_none", "cus_ZZZZZZZZ")], has_more: false }) },
      invoices: {
        list: async () => {
          page += 1;
          return {
            data: [{
              id: `in_${String(page).padStart(2, "0")}`,
              customer: "cus_OTHER999",
              subscription: "sub_other",
              payments: { data: [{ payment: { payment_intent: `pi_page_${page}` } }], has_more: false },
            }],
            has_more: true,
          };
        },
      },
    }, NOW);
    expect(page).toBe(INVOICE_MAX_PAGES);
    expect(report.status).toBe("ready");
    if (report.status !== "ready") return;
    expect(report.truncatedBecause).toBe("invoices");
    expect(report.unmatched).toEqual([expect.objectContaining({ chargeId: "ch_none", fleetLinked: null })]);
  });
});

describe("payout match source", () => {
  it("gates the screen before auth and does not grow a second matcher", () => {
    const logic = readFileSync("src/lib/stripe-payout-match.ts", "utf8");
    expect(logic).toContain("invoiceIsLinked(");
    expect(logic).not.toMatch(/rentals\.some|applications\.some/);
    const flag = readFileSync("src/lib/stripe-payout-match-flag.ts", "utf8");
    expect(flag.match(/export const STRIPE_PAYOUT_MATCH_ENABLED = false\b/g)).toHaveLength(1);
    expect(flag).not.toContain("process.env");
    const declarations = walk("src").flatMap((file) => readFileSync(file, "utf8").match(/export const STRIPE_PAYOUT_MATCH_ENABLED\b/g) ?? []);
    expect(declarations).toHaveLength(1);
    const handler = readFileSync("src/lib/stripe-payout-match.functions.ts", "utf8");
    const middleware = handler.slice(handler.indexOf(".middleware(["), handler.indexOf("])"));
    expect(middleware.indexOf("gatePayoutMatch")).toBeLessThan(middleware.indexOf("requireSupabaseAuth"));
    expect(handler.indexOf('await import("./stripe-payout-match.server")')).toBeGreaterThan(handler.indexOf("user_roles"));
    expect(handler.indexOf('await import("./stripe-reader.server")')).toBeGreaterThan(handler.indexOf("user_roles"));
    expect(handler).toContain('createReadOnlyStripe("live", { cache: true })');
    expect(handler).not.toContain("supabaseAdmin");
    const server = readFileSync("src/lib/stripe-payout-match.server.ts", "utf8");
    expect(server).toContain("unmatchedCharges");
    expect(server).toContain("readDirectory");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    expect(panel).toContain("STRIPE_PAYOUT_MATCH_ENABLED ? <StripePayoutMatch /> : null");
  });
});

function charge(
  payoutId: string,
  chargeId: string,
  paymentIntentId: string,
  customerId: string,
  subscriptionId: string | null,
  invoiceSeen: boolean,
): PayoutCharge {
  return { payoutId, chargeId, paymentIntentId, customerId, subscriptionId, invoiceSeen, amountCents: 15000 };
}

function payout(id: string) {
  return { id, amount: 15000, currency: "usd", status: "paid", arrival_date: ARRIVAL, livemode: true };
}

function txn(id: string, chargeId: string, paymentIntentId: string, customerId: string) {
  return {
    id,
    amount: 15000,
    fee: 0,
    net: 15000,
    currency: "usd",
    type: "charge",
    livemode: true,
    source: { id: chargeId, customer: customerId, payment_intent: paymentIntentId },
  };
}

function stripeOnce(seen: Array<Record<string, unknown>> = []) {
  return {
    payouts: {
      list: async (query: Record<string, unknown>) => {
        seen.push(query);
        return { data: [payout("po_1")], has_more: false };
      },
    },
    balanceTransactions: {
      list: async (query: Record<string, unknown>) => {
        seen.push(query);
        return {
          data: [
            txn("txn_known", "ch_known", "pi_known", "cus_ABCDEFGH"),
            txn("txn_sub", "ch_sub", "pi_sub", "cus_OTHER999"),
            txn("txn_app", "ch_app", "pi_app", "cus_APP12345"),
            txn("txn_none", "ch_none", "pi_none", "cus_ZZZZZZZZ"),
            { id: "txn_fee", amount: -500, fee: 0, net: -500, currency: "usd", type: "stripe_fee", livemode: true },
          ],
          has_more: false,
        };
      },
    },
    invoices: {
      list: async (query: Record<string, unknown>) => {
        seen.push(query);
        return {
          data: [{
            id: "in_sub",
            customer: "cus_OTHER999",
            subscription: "sub_known",
            payments: { data: [{ payment: { payment_intent: "pi_sub" } }], has_more: false },
          }],
          has_more: false,
        };
      },
    },
  };
}

function memoryDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let cursor: string | null = null;
      const api = {
        select(_columns: string, options?: { count?: string }) {
          if (options?.count !== "exact") throw new Error("count");
          return api;
        },
        order(column: string) {
          if (column !== "id") throw new Error("order");
          return api;
        },
        gt(_column: string, value: string) {
          cursor = value;
          return api;
        },
        limit(n: number) {
          let rows = (tables[table] ?? []).slice().sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
          const count = rows.length;
          if (cursor) rows = rows.filter((row) => String(row.id) > cursor!);
          return Promise.resolve({ data: rows.slice(0, n), error: null, count });
        },
      };
      return api;
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}
