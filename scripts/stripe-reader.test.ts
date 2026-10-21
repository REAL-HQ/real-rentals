import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_READER_MAX_PAGES, STRIPE_TEMPORARILY_UNAVAILABLE, paginateStripeList } from "../src/lib/stripe-reader";
import { readWeeklyCashFlow } from "../src/lib/weekly-cash-flow-read.server";

const stripeMock = vi.hoisted(() => {
  const list = vi.fn();
  const createStripeClient = vi.fn((_env: string, _options?: { timeout?: number }) => ({ charges: { list } }));
  return { list, createStripeClient };
});
vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));
import { clearStripeReaderCache, createReadOnlyStripe } from "../src/lib/stripe-reader.server";

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

  it("reuses a list response for 60 seconds and refuses a write", async () => {
    stripeMock.list.mockResolvedValue({ data: [{ id: "ch_1" }], has_more: false });
    const stripe = createReadOnlyStripe("live");
    await stripe.charges.list({ limit: 100 }, { timeout: 500 });
    await stripe.charges.list({ limit: 100 }, { timeout: 9_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(1);
    expect(stripeMock.createStripeClient).toHaveBeenCalledWith("live", { timeout: 20_000 });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000 + 60_001);
    await stripe.charges.list({ limit: 100 }, { timeout: 1_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(2);
    await stripe.charges.list({ limit: 50 }, { timeout: 1_000 });
    expect(stripeMock.list).toHaveBeenCalledTimes(3);
    expect(() => (stripe.charges as unknown as { create: (body: unknown) => Promise<unknown> }).create({ amount: 1 })).toThrow("Stripe reader refuses charges.create");
    stripeMock.list.mockRejectedValueOnce({ statusCode: 429, message: "rate limit" });
    await expect(stripe.charges.list({ limit: 1 })).rejects.toThrow(STRIPE_TEMPORARILY_UNAVAILABLE);
    stripeMock.list.mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(stripe.charges.list({ limit: 2 })).rejects.toThrow("Stripe unavailable");
  });

  it("sends every named reader through the read-only client", () => {
    for (const file of READERS) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("createReadOnlyStripe");
      expect(source, file).not.toContain("createStripeClient");
    }
  });

  it("keeps flag defaults off and returns before Stripe while a flag is off", () => {
    expect(readFileSync("src/lib/collections-watch-flag.ts", "utf8")).toContain('return env.COLLECTIONS_WATCH_ENABLED === "true"');
    expect(readFileSync("src/lib/deposits-ledger-flag.ts", "utf8")).toContain('return env.DEPOSITS_LEDGER_ENABLED === "true"');
    expect(readFileSync("src/lib/driver-statement-flag.ts", "utf8")).toContain('return env.DRIVER_STATEMENT_ENABLED === "true"');
    expect(readFileSync("src/lib/weekly-cash-flow-flag.ts", "utf8")).toContain('return env.WEEKLY_CASH_FLOW_ENABLED === "true"');
    expect(readFileSync("src/lib/stripe-match-flag.ts", "utf8")).toContain('return env.STRIPE_MATCH_REPORT_ENABLED === "true"');
    expect(readFileSync("src/lib/vehicle-profitability-flag.ts", "utf8")).toContain("export const VEHICLE_PROFITABILITY_ENABLED = false");
    expect(readFileSync("src/lib/unified-finance-flag.ts", "utf8")).toContain("export const UNIFIED_FINANCE_ENDPOINT_ENABLED = false");
    expect(readFileSync("src/lib/stripe-collections.ts", "utf8")).toContain("export const STRIPE_COLLECTIONS_ENABLED = true");
    const handlers: Array<[string, string, string]> = [
      ["src/lib/collections-watch.functions.ts", "collectionsWatchEnabled()", "readLiveCollectionsWatch("],
      ["src/lib/deposits-ledger.functions.ts", "depositsLedgerEnabled()", "readLiveDepositsLedger("],
      ["src/lib/driver-statement.functions.ts", "driverStatementEnabled()", "readLiveDriverStatement("],
      ["src/lib/weekly-cash-flow.functions.ts", "weeklyCashFlowEnabled()", "readLiveWeeklyCashFlow("],
      ["src/lib/stripe-match.server.ts", "stripeMatchReportEnabled(input.env)", "readStripe("],
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
