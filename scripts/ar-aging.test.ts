import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import {
  AR_PAGE_CAP,
  AR_STRIPE_UNAVAILABLE,
  buildArAging,
  dollarsToCents,
  etToday,
  type AgingDriver,
  type AgingPayment,
  type AgingStripeNet,
} from "../src/lib/ar-aging";
import { AR_AGING_OFF } from "../src/lib/ar-aging-flag";
import { readArAgingStripe, readLiveArAgingStripe } from "../src/lib/ar-aging-stripe.server";
import { runArAging } from "../src/lib/ar-aging.server";

const stripeMock = vi.hoisted(() => {
  const paymentIntentsRetrieve = vi.fn();
  const chargesRetrieve = vi.fn();
  const chargesCreate = vi.fn();
  const rawRequest = vi.fn(async () => ({ id: "should-not-run" }));
  const createStripeClient = vi.fn(() => ({
    paymentIntents: { retrieve: paymentIntentsRetrieve },
    charges: { retrieve: chargesRetrieve, create: chargesCreate },
    rawRequest,
  }));
  return { paymentIntentsRetrieve, chargesRetrieve, chargesCreate, rawRequest, createStripeClient };
});

vi.mock("../src/lib/stripe.server", () => ({ createStripeClient: stripeMock.createStripeClient }));

import { clearStripeReaderCache, createReadOnlyStripe } from "../src/lib/stripe-reader.server";

const TODAY = "2026-10-21";

function driver(over: Partial<AgingDriver> = {}): AgingDriver {
  return { id: "driver-1", name: "Ada", status: "active", ...over };
}

function payment(over: Partial<AgingPayment> = {}): AgingPayment {
  return {
    id: "pay-1",
    driverId: "driver-1",
    type: "rent",
    status: "current",
    amountCents: 50000,
    netCollectedCents: null,
    stripePaymentIntentId: null,
    dueDate: "2026-10-18",
    ...over,
  };
}

function report(drivers: AgingDriver[], payments: AgingPayment[], stripeNets: AgingStripeNet[] = [], stripeUnavailable = false) {
  return buildArAging({ today: TODAY, drivers, payments, stripeNets, stripeUnavailable });
}

beforeEach(() => {
  clearStripeReaderCache();
  stripeMock.paymentIntentsRetrieve.mockReset();
  stripeMock.chargesRetrieve.mockReset();
  stripeMock.chargesCreate.mockReset();
  stripeMock.rawRequest.mockReset();
  stripeMock.createStripeClient.mockClear();
});

it("throws before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const stripe = vi.fn();
  await expect(runArAging({ enabled: false, userId: "owner", tier: "owner", today: TODAY, load, stripe })).rejects.toThrow(AR_AGING_OFF);
  expect(load).not.toHaveBeenCalled();
  expect(stripe).not.toHaveBeenCalled();
});

it("refuses a coordinator before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  await expect(runArAging({ enabled: true, userId: "coord", tier: "coordinator", today: TODAY, load })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
});

it("ages a $500 unpaid rent charge into 0-7, 8-30, 31-60, and 60+", () => {
  const rows = report(
    [driver()],
    [
      payment({ id: "d3", dueDate: "2026-10-18", amountCents: 50000 }),
      payment({ id: "d10", dueDate: "2026-10-11", amountCents: 10000 }),
      payment({ id: "d40", dueDate: "2026-09-11", amountCents: 20000 }),
      payment({ id: "d70", dueDate: "2026-08-12", amountCents: 30000 }),
    ],
  )!;
  const row = rows.rows[0];
  expect(row.rentBilledCents).toBe(110000);
  expect(row.collectedCents).toBe(0);
  expect(row.balanceCents).toBe(110000);
  expect(row.bucket0Cents).toBe(50000);
  expect(row.bucket8Cents).toBe(10000);
  expect(row.bucket31Cents).toBe(20000);
  expect(row.bucket60Cents).toBe(30000);
  expect(row.notYetDueCents).toBe(0);
});

it("keeps a future due date out of the 0-7 bucket and shifts a timestamp into Eastern Time", () => {
  const rows = report(
    [driver()],
    [
      payment({ id: "future", dueDate: "2026-10-22", amountCents: 40000 }),
      payment({ id: "stamp", dueDate: "2026-10-21T03:00:00Z", amountCents: 15000 }),
    ],
  )!;
  expect(etToday(new Date("2026-10-21T03:00:00Z"))).toBe("2026-10-20");
  const row = rows.rows[0];
  expect(row.bucket0Cents).toBe(15000);
  expect(row.notYetDueCents).toBe(40000);
  expect(row.balanceCents).toBe(55000);
});

it("shows Unknown when the rent amount cannot be read and keeps a recorded zero", () => {
  expect(dollarsToCents("10.555")).toBeNull();
  expect(dollarsToCents(0)).toBe(0);
  expect(dollarsToCents(-1)).toBeNull();
  const rows = report(
    [driver(), driver({ id: "driver-2", name: "Bea" })],
    [
      payment({ amountCents: null }),
      payment({ id: "zero", driverId: "driver-2", amountCents: 0, dueDate: "2026-10-18" }),
    ],
  )!;
  const ada = rows.rows.find((row) => row.driverId === "driver-1");
  const bea = rows.rows.find((row) => row.driverId === "driver-2");
  expect(ada?.rentBilledCents).toBeNull();
  expect(ada?.balanceCents).toBeNull();
  expect(ada?.bucket0Cents).toBeNull();
  expect(bea?.rentBilledCents).toBe(0);
  expect(bea?.collectedCents).toBe(0);
  expect(bea?.balanceCents).toBe(0);
  expect(rows.rentBilledCents).toBeNull();
});

it("uses verified Stripe net once and recorded non-Stripe collections, and leaves deposits out", () => {
  const rows = report(
    [driver()],
    [
      payment({ id: "rent", amountCents: 50000, status: "paid", netCollectedCents: 50000, stripePaymentIntentId: "pi_1", dueDate: "2026-10-11" }),
      payment({ id: "fee", type: "late_fee", status: "paid", amountCents: 4000, netCollectedCents: 4000, dueDate: "2026-10-11" }),
      payment({ id: "deposit", type: "deposit", status: "paid", amountCents: 50000, netCollectedCents: 50000 }),
    ],
    [{ paymentIntentId: "pi_1", netCents: 48000 }],
  )!;
  const row = rows.rows[0];
  expect(row.rentBilledCents).toBe(50000);
  expect(row.collectedCents).toBe(52000);
  expect(row.balanceCents).toBe(-2000);
  expect(row.bucket8Cents).toBe(0);
});

it("applies non-rent collected to the oldest rent balance", () => {
  const rows = report(
    [driver()],
    [
      payment({ id: "old", amountCents: 10000, dueDate: "2026-08-12" }),
      payment({ id: "new", amountCents: 5000, dueDate: "2026-10-18" }),
      payment({ id: "fee", type: "late_fee", status: "paid", amountCents: 4000, netCollectedCents: 4000 }),
    ],
  )!;
  const row = rows.rows[0];
  expect(row.collectedCents).toBe(4000);
  expect(row.balanceCents).toBe(11000);
  expect(row.bucket60Cents).toBe(6000);
  expect(row.bucket0Cents).toBe(5000);
});

it("leaves collected Unknown when the Stripe fee was not verified", () => {
  const rows = report(
    [driver()],
    [payment({ status: "paid", netCollectedCents: 50000, stripePaymentIntentId: "pi_missing", amountCents: 50000 })],
    [],
  )!;
  expect(rows.rows[0].rentBilledCents).toBe(50000);
  expect(rows.rows[0].collectedCents).toBeNull();
  expect(rows.rows[0].balanceCents).toBeNull();
  expect(rows.rows[0].bucket0Cents).toBeNull();
});

it("omits an inactive driver and a void rent charge", () => {
  const rows = report(
    [driver({ status: "closed" }), driver({ id: "driver-2", name: "Bea" })],
    [
      payment({ status: "void", amountCents: 90000 }),
      payment({ id: "void-2", driverId: "driver-2", status: "void", amountCents: 90000 }),
      payment({ id: "live", driverId: "driver-2", amountCents: 2500, dueDate: "2026-10-18" }),
    ],
  )!;
  expect(rows.rows.map((row) => row.driverId)).toEqual(["driver-2"]);
  expect(rows.rows[0].rentBilledCents).toBe(2500);
});

it("withholds totals when the read is capped and does not call Stripe", async () => {
  const stripe = vi.fn();
  const result = await runArAging({
    enabled: true,
    userId: "manager",
    tier: "manager",
    today: TODAY,
    load: async () => ({ ok: false, capped: true }),
    stripe,
  });
  expect(stripe).not.toHaveBeenCalled();
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.report.rows).toEqual([]);
    expect(result.report.balanceCents).toBeNull();
    expect(result.report.warnings).toContain(AR_PAGE_CAP);
  }
});

it("keeps the rent amount and marks collected Unknown when Stripe fails", async () => {
  const result = await runArAging({
    enabled: true,
    userId: "manager",
    tier: "manager",
    today: TODAY,
    load: async () => ({
      ok: true as const,
      drivers: [driver()],
      payments: [payment({ status: "paid", stripePaymentIntentId: "pi_1", netCollectedCents: 50000, amountCents: 50000 })],
    }),
    stripe: async () => {
      throw new Error("boom");
    },
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.report.rows[0].rentBilledCents).toBe(50000);
    expect(result.report.rows[0].collectedCents).toBeNull();
    expect(result.report.warnings).toContain(AR_STRIPE_UNAVAILABLE);
    expect(result.report.warnings.join(" ")).not.toContain("retrieve cap");
  }
});

it("checks Stripe only for listed payment intents", async () => {
  const stripe = vi.fn(async (ids: string[]) => {
    expect(ids).toEqual(["pi_listed"]);
    return { ok: true as const, nets: [{ paymentIntentId: "pi_listed", netCents: 10000 }] };
  });
  const result = await runArAging({
    enabled: true,
    userId: "owner",
    tier: "owner",
    today: TODAY,
    load: async () => ({
      ok: true as const,
      drivers: [driver(), driver({ id: "driver-2", name: "Bea", status: "approved" })],
      payments: [
        payment({ status: "paid", stripePaymentIntentId: "pi_listed", netCollectedCents: 50000, amountCents: 50000 }),
        payment({ id: "other", driverId: "driver-2", status: "paid", stripePaymentIntentId: "pi_other", netCollectedCents: 1000 }),
      ],
    }),
    stripe,
  });
  expect(stripe).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.report.rows[0].collectedCents).toBe(10000);
});

it("omits an unverified charge and refuses a top-level Stripe method", async () => {
  const nets = await readArAgingStripe(
    {
      paymentIntents: {
        retrieve: async (id) => (id === "pi_bad" ? { id, livemode: false, latest_charge: "ch_bad" } : { id, latest_charge: "ch_ok" }),
      },
      charges: {
        retrieve: async () => ({ id: "ch_ok", currency: "usd", amount_captured: 10000, amount_refunded: 0, balance_transaction: { fee: 200, currency: "usd" } }),
      },
    },
    ["pi_bad", "pi_ok"],
  );
  expect(nets).toEqual({ ok: true, nets: [{ paymentIntentId: "pi_ok", netCents: 9800 }] });

  stripeMock.paymentIntentsRetrieve.mockResolvedValue({ id: "pi_1", livemode: false });
  expect(await readLiveArAgingStripe(["pi_1"])).toEqual({ ok: true, nets: [] });
  expect(stripeMock.chargesRetrieve).not.toHaveBeenCalled();
  const stripe = createReadOnlyStripe("live", { cache: true });
  expect(() => (stripe as unknown as { rawRequest: () => void }).rawRequest()).toThrow("Stripe reader refuses rawRequest");
  expect(() => stripe.charges.create({ amount: 1 })).toThrow("Stripe reader refuses charges.create");
  expect(stripeMock.rawRequest).not.toHaveBeenCalled();
  expect(stripeMock.chargesCreate).not.toHaveBeenCalled();
  expect(stripeMock.createStripeClient).toHaveBeenCalledWith("live", { timeout: 20_000 });
});

it("keeps Receivables Aging off the Payments page until the flag is on, and behind the throw", () => {
  const flag = readFileSync("src/lib/ar-aging-flag.ts", "utf8");
  const fn = readFileSync("src/lib/ar-aging.functions.ts", "utf8");
  const stripeFile = readFileSync("src/lib/ar-aging-stripe.server.ts", "utf8");
  const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
  const section = readFileSync("src/components/admin/ArAgingSection.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const disabled = fn.indexOf("if (!AR_AGING_ENABLED) throw new Error(AR_AGING_OFF);");
  const manager = fn.indexOf("await requireManager(context.userId)");
  const table = fn.indexOf("loadArAging(");
  expect(flag).toContain("export const AR_AGING_ENABLED = false");
  expect(flag.match(/AR_AGING_ENABLED/g)?.length).toBe(1);
  expect(disabled).toBeGreaterThan(-1);
  expect(manager).toBeGreaterThan(disabled);
  expect(table).toBeGreaterThan(manager);
  expect(fn.indexOf('import("./ar-aging-stripe.server")')).toBeGreaterThan(manager);
  expect(panel).toContain("AR_AGING_ENABLED ? <ArAgingSection /> : null");
  expect(section).toContain("Receivables Aging");
  expect(section).toContain("Unknown");
  expect(nav).not.toContain("Receivables Aging");
  expect(stripeFile).toContain('createReadOnlyStripe("live", { cache: true })');
  expect(stripeFile).not.toContain("createStripeClient");
  expect(stripeFile).not.toContain("refunds.list");
  for (const source of [flag, fn, stripeFile, section]) {
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  }
});
