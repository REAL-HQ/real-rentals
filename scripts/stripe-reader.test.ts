import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_READER_MAX_PAGES, STRIPE_TEMPORARILY_UNAVAILABLE, paginateStripeList } from "../src/lib/stripe-reader";
import { readWeeklyCashFlow } from "../src/lib/weekly-cash-flow-read.server";

const stripeMock = vi.hoisted(() => {
  const list = vi.fn();
  const create = vi.fn();
  const refundCreate = vi.fn();
  const rawRequest = vi.fn(async () => ({ id: "should-not-run" }));
  const request = vi.fn(async () => ({ id: "should-not-run" }));
  const senderRaw = vi.fn(async () => ({ id: "should-not-run" }));
  const resourceRaw = vi.fn(async () => ({ id: "should-not-run" }));
  const createStripeClient = vi.fn((_env: string, _options?: { timeout?: number }) => ({
    charges: { list, create, _stripe: { rawRequest: resourceRaw } },
    refunds: { create: refundCreate },
    rawRequest,
    request,
    _requestSender: { _rawRequest: senderRaw },
  }));
  return { list, create, refundCreate, rawRequest, request, senderRaw, resourceRaw, createStripeClient };
});
vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));
import { clearStripeReaderCache, createReadOnlyStripe } from "../src/lib/stripe-reader.server";
import { readLivePartnerCharges, readPartnerCharges } from "../src/lib/partner-statement-read.server";

const VERBS = "create|update|del|delete|capture|confirm|cancel|refund|finalizeInvoice|pay|voidInvoice|close|expire|approve|reject|attach|detach";
const RESOURCES = "customers|charges|refunds|subscriptions|invoices|invoiceItems|invoicePayments|paymentIntents|setupIntents|paymentMethods|payouts|prices|products|coupons|disputes|creditNotes|plans|subscriptionItems|subscriptionSchedules|balanceTransactions|taxRates|promotionCodes|accounts|sessions";
const WRITE = new RegExp(`(?:\\bstripe\\b(?:\\s*\\.\\s*\\w+)*|\\b(?:${RESOURCES}))\\s*\\.\\s*(?:${VERBS})\\s*\\(`, "g");
const SDK_VALUE_IMPORT = /^\s*import\s+(?!type\b).*\sfrom\s+["']stripe["']/gm;

/** Write paths that already existed on 7e3e6eb. Checkout, subscriptions, and collecting a payment. */
const APPROVED_WRITES = new Set([
  "src/lib/stripe-operations.server.ts",
  "src/lib/rental-payments.functions.ts",
  "src/lib/rental-subscription-coordination.server.ts",
  "src/lib/payments.functions.ts",
  "src/lib/payment-collection.server.ts",
]);

const READERS = [
  "src/lib/stripe-match-read.server.ts",
  "src/lib/collections-watch-read.server.ts",
  "src/lib/deposits-ledger-read.server.ts",
  "src/lib/driver-statement-read.server.ts",
  "src/lib/weekly-cash-flow-read.server.ts",
  "src/lib/stripe-collections.server.ts",
  "src/lib/partner-statement-read.server.ts",
  "src/lib/deposit-ledger-stripe.server.ts",
  "src/lib/rent-reconciliation-stripe.server.ts",
  "src/lib/stripe-risk-monitor-read.server.ts",
  "src/lib/stripe-payout-recon-read.server.ts",
  "src/lib/owner-pnl-fees-read.server.ts",
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...filesUnder(path));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function repoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

describe("shared Stripe reader", () => {
  beforeEach(() => {
    clearStripeReaderCache();
    stripeMock.list.mockReset();
    stripeMock.createStripeClient.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("pages until the cap and logs that the cap was hit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const result = await paginateStripeList(async () => ({ data: [{ id: `ch_${++calls}` }], has_more: true }), { label: "charges.list", maxPages: 3 });
    expect(result).toEqual({ ok: false, reason: "capped" });
    expect(calls).toBe(3);
    expect(warn).toHaveBeenCalledWith("Stripe reader page cap reached (3) for charges.list");
    expect(STRIPE_READER_MAX_PAGES).toBe(100);
    warn.mockRestore();
  });

  it("turns a 429 or a timeout into Stripe temporarily unavailable and lets other errors through", async () => {
    const limited = await readWeeklyCashFlow({
      charges: { list: async () => { throw { statusCode: 429, type: "StripeRateLimitError", message: "Too many requests" }; } },
      refunds: { list: async () => ({ data: [], has_more: false }) },
    }, { gte: 1, lt: 2 });
    expect(limited).toEqual({ ok: false, reason: STRIPE_TEMPORARILY_UNAVAILABLE });
    const timed = await readWeeklyCashFlow({
      charges: { list: async () => ({ data: [], has_more: false }) },
      refunds: { list: async () => { throw { type: "StripeConnectionError", code: "ETIMEDOUT", message: "timeout of 20000ms exceeded" }; } },
    }, { gte: 1, lt: 2 });
    expect(timed).toEqual({ ok: false, reason: STRIPE_TEMPORARILY_UNAVAILABLE });
    const other = await readWeeklyCashFlow({
      charges: { list: async () => { throw new Error("Stripe unavailable"); } },
      refunds: { list: async () => ({ data: [], has_more: false }) },
    }, { gte: 1, lt: 2 });
    expect(other).toEqual({ ok: false, reason: "Stripe evidence was incomplete or timed out" });
  });

  it("reuses a list response for 60 seconds only when a reader opts in", async () => {
    stripeMock.list.mockResolvedValue({ data: [{ id: "ch_1" }], has_more: false });
    const fresh = createReadOnlyStripe("live");
    await fresh.charges.list({ limit: 100 });
    await fresh.charges.list({ limit: 100 });
    expect(stripeMock.list).toHaveBeenCalledTimes(2);
    stripeMock.list.mockClear();
    const stripe = createReadOnlyStripe("live", { cache: true });
    await stripe.charges.list({ limit: 100 }, { timeout: 500 });
    await stripe.charges.list({ limit: 100 }, { timeout: 9_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(1);
    expect(stripeMock.createStripeClient).toHaveBeenCalledWith("live", { timeout: 20_000 });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000 + 60_001);
    await stripe.charges.list({ limit: 100 }, { timeout: 1_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(2);
    await stripe.charges.list({ limit: 50 }, { timeout: 1_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(3);
    expect((stripe.charges as unknown as { create?: unknown }).create).toBeUndefined();
    expect(stripeMock.create).not.toHaveBeenCalled();
    stripeMock.list.mockRejectedValueOnce({ statusCode: 429, message: "rate limit" });
    await expect(stripe.charges.list({ limit: 1 })).rejects.toThrow(STRIPE_TEMPORARILY_UNAVAILABLE);
    stripeMock.list.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(stripe.charges.list({ limit: 2 })).rejects.toThrow("Stripe unavailable");
  });

  it("reads partner charges the same way through the read-only client and refuses a write", async () => {
    const pages = [
      {
        data: [{
          id: "ch_1", amount_captured: 5000, currency: "USD", status: "succeeded", paid: true, captured: true,
          created: 1_700_000_000, customer: { id: "cus_1" }, payment_intent: "pi_1", livemode: true,
          invoice: { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } },
        }],
        has_more: true,
      },
      {
        data: [{
          id: "ch_2", amount_captured: 0, currency: "usd", status: "failed", paid: false, captured: false,
          created: 1_700_000_100, customer: "cus_2", payment_intent: null, invoice: "in_2", livemode: true,
        }],
        has_more: false,
      },
    ];
    const list = async (params: { starting_after?: string }) => (params.starting_after ? pages[1] : pages[0]);
    const direct = await readPartnerCharges(
      { charges: { list } },
      { gte: 10, lt: 20 },
    );
    stripeMock.list.mockImplementation(list);
    const proxied = await readLivePartnerCharges({ gte: 10, lt: 20 });
    expect(proxied).toEqual(direct);
    expect(proxied).toEqual({
      ok: true,
      charges: [
        {
          id: "ch_1", customerId: "cus_1", paymentIntentId: "pi_1", invoiceId: "in_1", subscriptionId: "sub_1",
          amountCents: 5000, currency: "usd", succeeded: true, created: 1_700_000_000, paymentIds: [],
        },
        {
          id: "ch_2", customerId: "cus_2", paymentIntentId: null, invoiceId: "in_2", subscriptionId: null,
          amountCents: 0, currency: "usd", succeeded: false, created: 1_700_000_100, paymentIds: [],
        },
      ],
    });
    expect(stripeMock.list).toHaveBeenCalledTimes(2);
    expect(await readLivePartnerCharges({ gte: 10, lt: 20 })).toEqual(proxied);
    expect(stripeMock.list).toHaveBeenCalledTimes(2);
    const stripe = createReadOnlyStripe("live", { cache: true });
    expect((stripe.charges as unknown as { create?: unknown }).create).toBeUndefined();
    expect(stripe.refunds).toBeUndefined();
    expect((stripe as unknown as { rawRequest?: unknown }).rawRequest).toBeUndefined();
    expect((stripe as unknown as { request?: unknown }).request).toBeUndefined();
    expect(stripeMock.create).not.toHaveBeenCalled();
    expect(stripeMock.refundCreate).not.toHaveBeenCalled();
    expect(stripeMock.rawRequest).not.toHaveBeenCalled();
    expect(stripeMock.request).not.toHaveBeenCalled();
  });

  it("does not expose Stripe writes through descriptors, prototypes, or private fields", () => {
    const stripe = createReadOnlyStripe("live", { cache: true });
    const charges = stripe.charges as unknown as { list?: unknown; create?: unknown; _stripe?: { rawRequest?: () => unknown } };
    const descriptor = Object.getOwnPropertyDescriptor(stripe, "charges");
    const reflected = Reflect.getOwnPropertyDescriptor(stripe, "charges");
    expect(descriptor?.value).toBe(charges);
    expect(reflected?.value).toBe(charges);
    expect(descriptor?.value.create).toBeUndefined();
    expect(reflected?.value.create).toBeUndefined();
    expect(() => descriptor?.value.create({ amount: 1 })).toThrow(TypeError);
    expect(stripeMock.create).not.toHaveBeenCalled();

    const sender = (stripe as unknown as { _requestSender?: { _rawRequest?: () => unknown } })._requestSender;
    expect(sender).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(stripe, "_requestSender")).toBeUndefined();
    expect(stripeMock.senderRaw).not.toHaveBeenCalled();

    expect(charges._stripe).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(charges, "_stripe")).toBeUndefined();
    expect(stripeMock.resourceRaw).not.toHaveBeenCalled();

    const described = Object.getOwnPropertyDescriptors(stripe);
    expect(Object.keys(described)).toEqual(["charges"]);
    expect(Object.keys(Object.getOwnPropertyDescriptors(charges)).sort()).toEqual(["list"]);
    expect(Object.getPrototypeOf(stripe)).toBeNull();
    expect(Object.getPrototypeOf(charges)).toBeNull();
    expect(Object.isFrozen(stripe)).toBe(true);
    expect(Object.isFrozen(charges)).toBe(true);
    expect(stripeMock.rawRequest).not.toHaveBeenCalled();
    expect(stripeMock.request).not.toHaveBeenCalled();
  });

  it("sends every named reader through the read-only client", () => {
    for (const file of READERS) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("createReadOnlyStripe");
      expect(source, file).not.toContain("createStripeClient");
    }
    expect(readFileSync("src/lib/stripe-collections.server.ts", "utf8")).not.toContain("cache: true");
    for (const file of READERS.filter((path) => path !== "src/lib/stripe-collections.server.ts")) {
      expect(readFileSync(file, "utf8"), file).toContain("cache: true");
    }
  });

  it("keeps flag defaults off and returns before Stripe while a flag is off", () => {
    expect(readFileSync("src/lib/collections-watch-flag.ts", "utf8")).toContain("export const COLLECTIONS_WATCH_ENABLED = false");
    expect(readFileSync("src/lib/deposits-ledger-flag.ts", "utf8")).toContain("export const DEPOSITS_LEDGER_ENABLED = false");
    expect(readFileSync("src/lib/driver-statement-flag.ts", "utf8")).toContain("export const DRIVER_STATEMENT_ENABLED = false");
    expect(readFileSync("src/lib/weekly-cash-flow-flag.ts", "utf8")).toContain("export const WEEKLY_CASH_FLOW_ENABLED = false");
    expect(readFileSync("src/lib/stripe-match-flag.ts", "utf8")).toContain("export const STRIPE_MATCH_REPORT_ENABLED = false");
    for (const file of [
      "src/lib/collections-watch-flag.ts",
      "src/lib/deposits-ledger-flag.ts",
      "src/lib/driver-statement-flag.ts",
      "src/lib/weekly-cash-flow-flag.ts",
      "src/lib/stripe-match-flag.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/process\.env|import\.meta\.env/);
    }
    expect(readFileSync("src/lib/vehicle-profitability-flag.ts", "utf8")).toContain("export const VEHICLE_PROFITABILITY_ENABLED = false");
    expect(readFileSync("src/lib/unified-finance-flag.ts", "utf8")).toContain("export const UNIFIED_FINANCE_ENDPOINT_ENABLED = false");
    expect(readFileSync("src/lib/stripe-collections.ts", "utf8")).toContain("export const STRIPE_COLLECTIONS_ENABLED = true");
    const handlers: Array<[string, string, string]> = [
      ["src/lib/collections-watch.functions.ts", "if (!COLLECTIONS_WATCH_ENABLED)", "readLiveCollectionsWatch("],
      ["src/lib/deposits-ledger.functions.ts", "if (!DEPOSITS_LEDGER_ENABLED)", "readLiveDepositsLedger("],
      ["src/lib/driver-statement.functions.ts", "if (!DRIVER_STATEMENT_ENABLED)", "readLiveDriverStatement("],
      ["src/lib/weekly-cash-flow.functions.ts", "if (!WEEKLY_CASH_FLOW_ENABLED)", "readLiveWeeklyCashFlow("],
      ["src/lib/stripe-match.functions.ts", "if (!STRIPE_MATCH_REPORT_ENABLED)", "readLiveStripeMatch("],
    ];
    for (const [file, flag, stripe] of handlers) {
      const body = readFileSync(file, "utf8");
      const flagAt = body.indexOf(flag);
      const stripeAt = body.indexOf(stripe);
      expect(flagAt, file).toBeGreaterThan(-1);
      expect(stripeAt, file).toBeGreaterThan(flagAt);
    }
  });

  it("fails when a file outside the approved write paths calls a Stripe write", () => {
    expect(WRITE.test("await stripe.charges.refund()")).toBe(true);
    WRITE.lastIndex = 0;
    expect("await admin.from('payments').update({})".match(WRITE)).toBeNull();
    const offenders: string[] = [];
    const sdkOffenders: string[] = [];
    for (const path of filesUnder("src")) {
      const file = repoPath(path);
      const source = readFileSync(path, "utf8");
      WRITE.lastIndex = 0;
      const writes = source.match(WRITE) ?? [];
      if (writes.length && !APPROVED_WRITES.has(file)) offenders.push(`${file}: ${writes.join(", ")}`);
      SDK_VALUE_IMPORT.lastIndex = 0;
      if (SDK_VALUE_IMPORT.test(source) && file !== "src/lib/stripe.server.ts") sdkOffenders.push(file);
    }
    expect(offenders).toEqual([]);
    expect(sdkOffenders).toEqual([]);
    for (const file of APPROVED_WRITES) {
      WRITE.lastIndex = 0;
      expect(readFileSync(file, "utf8").match(WRITE)?.length ?? 0, file).toBeGreaterThan(0);
    }
  });
});
