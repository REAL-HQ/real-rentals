import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import {
  RENT_CATEGORY_LABEL,
  STRIPE_CHECK_UNAVAILABLE,
  buildRentReconciliation,
  lastFullWeek,
  rentReconciliationToCsv,
  weekBounds,
  type ListedCharge,
  type RentPayment,
  type RentStripeRead,
  type StripeRentFact,
} from "../src/lib/rent-reconciliation";
import { RENT_RECONCILIATION_OFF } from "../src/lib/rent-reconciliation-flag";
import { runRentReconciliation } from "../src/lib/rent-reconciliation.server";

const WEEK = weekBounds("2026-10-12")!;
const applications = [{ id: "driver-1", name: 'Ada, "Bee"', stripeCustomerId: "cus_1" }];
const rentals = [{ id: "rental-1", applicationId: "driver-1", vehicleId: "vehicle-1", stripeCustomerId: "cus_1" }];
const vehicles = [{ id: "vehicle-1", label: "Unit 7 · Civic" }];

function payment(over: Partial<RentPayment> = {}): RentPayment {
  return {
    id: "pay-1",
    rentalId: "rental-1",
    applicationId: "driver-1",
    vehicleId: "vehicle-1",
    type: "rent",
    status: "paid",
    amountCents: 10000,
    netCollectedCents: 10000,
    unreadable: false,
    paidDate: "2026-10-14",
    dueDate: null,
    stripePaymentIntentId: "pi_1",
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    ...over,
  };
}

function fact(over: Partial<StripeRentFact> = {}): StripeRentFact {
  return {
    forId: "pi_1",
    paymentIntentId: "pi_1",
    invoiceId: null,
    chargeId: "ch_1",
    customerId: "cus_1",
    capturedCents: 10000,
    refundedCents: 0,
    currency: "usd",
    outcome: "succeeded",
    status: "succeeded",
    ...over,
  };
}

function charge(over: Partial<ListedCharge> = {}): ListedCharge {
  return {
    id: "ch_only",
    paymentIntentId: "pi_only",
    invoiceId: null,
    customerId: "cus_1",
    capturedCents: 5000,
    refundedCents: 0,
    currency: "usd",
    succeeded: true,
    failed: false,
    status: "succeeded",
    ...over,
  };
}

function stripe(facts: StripeRentFact[] = [], charges: ListedCharge[] = []): RentStripeRead {
  return { ok: true, facts, charges };
}

async function run(payments: RentPayment[], result: RentStripeRead) {
  const before = structuredClone(payments);
  const report = await runRentReconciliation({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-14",
    load: async () => ({ ok: true as const, directory: { payments, applications, rentals, vehicles } }),
    stripe: async () => result,
  });
  expect(report.status).toBe("ready");
  if (report.status !== "ready") throw new Error("expected a report");
  return { report: report.report, before, payments };
}

it("uses the last full Eastern Time week and snaps a chosen day to Monday", () => {
  expect(lastFullWeek(new Date("2026-10-21T15:00:00Z"))).toMatchObject({ from: "2026-10-12", through: "2026-10-18" });
  expect(lastFullWeek(new Date("2026-10-19T03:30:00Z"))).toMatchObject({ from: "2026-10-05", through: "2026-10-11" });
  expect(WEEK).toMatchObject({ from: "2026-10-12", through: "2026-10-18" });
  expect(weekBounds("2026-10-14")).toMatchObject({ from: "2026-10-12", through: "2026-10-18" });
  expect(weekBounds("not-a-day")).toBeNull();
});

it("throws before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const stripeRead = vi.fn(async () => stripe());
  await expect(runRentReconciliation({
    enabled: false,
    userId: "owner",
    tier: "owner",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: null,
    load,
    stripe: stripeRead,
  })).rejects.toThrow(RENT_RECONCILIATION_OFF);
  expect(load).not.toHaveBeenCalled();
  expect(stripeRead).not.toHaveBeenCalled();
});

it("refuses a coordinator and a missing user before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const stripeRead = vi.fn(async () => stripe());
  await expect(runRentReconciliation({
    enabled: true,
    userId: "coord",
    tier: "coordinator",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-12",
    load,
    stripe: stripeRead,
  })).rejects.toThrow("Forbidden");
  await expect(runRentReconciliation({
    enabled: true,
    userId: null,
    tier: "manager",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-12",
    load,
    stripe: stripeRead,
  })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
  expect(stripeRead).not.toHaveBeenCalled();
});

it("lets an owner and a manager read, and defaults to the last full week", async () => {
  const load = vi.fn(async () => ({ ok: true as const, directory: { payments: [], applications: [], rentals: [], vehicles: [] } }));
  for (const tier of ["owner", "manager"] as const) {
    const result = await runRentReconciliation({
      enabled: true,
      userId: tier,
      tier,
      now: new Date("2026-10-21T15:00:00Z"),
      weekStart: null,
      load,
      stripe: async () => stripe(),
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.report.from).toBe("2026-10-12");
  }
});

it("matches a rent payment when Stripe captured the same amount and the refund is in net collected", async () => {
  const { report, before, payments } = await run([payment()], stripe([fact()]));
  expect(payments).toEqual(before);
  expect(report.stripeCheck).toBe("ready");
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].category).toBe("matched");
  expect(report.rows[0].evidence).toEqual([]);
  expect(report.rows[0].stripeCapturedCents).toBe(10000);
  expect(report.rows[0].stripeRefundedCents).toBe(0);
  expect(report.totals?.matched).toEqual({ count: 1, cents: 10000 });
  expect(report.totals?.amount_mismatch.count).toBe(0);
});

it("classifies a rent payment that is missing or failed in Stripe", async () => {
  const missing = await run([payment({ id: "none", stripePaymentIntentId: null })], stripe());
  expect(missing.report.rows[0].category).toBe("missing_or_failed");
  expect(missing.report.rows[0].evidence[0]).toContain("no Stripe payment intent or invoice id");
  const subscription = await run([payment({ stripePaymentIntentId: null, stripeSubscriptionId: "sub_1" })], stripe());
  expect(subscription.report.rows[0].evidence[0]).toContain("subscription id");
  const absent = await run([payment()], stripe([fact({ outcome: "missing", capturedCents: null, status: null })]));
  expect(absent.report.rows[0].category).toBe("missing_or_failed");
  expect(absent.report.rows[0].evidence[0]).toBe("Stripe has no captured charge for this payment. This is evidence only.");
  const failed = await run([payment()], stripe([fact({ outcome: "failed", status: "failed", capturedCents: 10000 })]));
  expect(failed.report.rows[0].category).toBe("missing_or_failed");
  expect(failed.report.rows[0].evidence[0]).toBe("Stripe shows this payment as failed. This is evidence only.");
  expect(failed.report.totals?.missing_or_failed).toEqual({ count: 1, cents: 10000 });
});

it("lists a succeeded charge on a known customer when no payment row has it", async () => {
  const payments = [
    payment(),
    payment({ id: "dep", type: "deposit", stripePaymentIntentId: "pi_dep", amountCents: 9000, netCollectedCents: 9000 }),
  ];
  const { report } = await run(payments, stripe([fact()], [
    charge(),
    charge({ id: "ch_dep", paymentIntentId: "pi_dep", customerId: "cus_1" }),
    charge({ id: "ch_stranger", paymentIntentId: "pi_stranger", customerId: "cus_other" }),
  ]));
  const only = report.rows.filter((row) => row.category === "stripe_only");
  expect(only).toHaveLength(1);
  expect(only[0].amountCents).toBe(5000);
  expect(only[0].renter).toBe('Ada, "Bee"');
  expect(only[0].evidence[0]).toBe("This succeeded Stripe charge is on a known customer and has no payment row. This is evidence only.");
  expect(report.rows.some((row) => row.paymentId === "dep")).toBe(false);
  expect(report.totals?.stripe_only).toEqual({ count: 1, cents: 5000 });
});

it("keeps an amount mismatch as evidence and does not change the payment", async () => {
  const source = payment();
  const { report, before } = await run([source], stripe([fact({ capturedCents: 8000, refundedCents: 4000 })]));
  expect(source).toEqual(before[0]);
  expect(report.rows[0].category).toBe("amount_mismatch");
  expect(report.rows[0].evidence.join(" ")).toContain("Stripe captured $80.00 and the payment amount is $100.00. This is evidence only.");
  expect(report.rows[0].evidence.join(" ")).toContain("Stripe refunded $40.00 and net collected is $100.00. This is evidence only.");
  expect(report.rows[0].amountCents).toBe(10000);
  expect(report.totals?.amount_mismatch).toEqual({ count: 1, cents: 10000 });
  expect(report.totals?.matched.count).toBe(0);
});

it("classifies a Stripe refund that is not reflected in net collected", async () => {
  const reflected = await run([payment({ netCollectedCents: 6000 })], stripe([fact({ refundedCents: 4000 })]));
  expect(reflected.report.rows[0].category).toBe("matched");
  expect(reflected.report.rows[0].evidence).toEqual([]);
  const gap = await run([payment({ netCollectedCents: 10000 })], stripe([fact({ refundedCents: 4000 })]));
  expect(gap.report.rows[0].category).toBe("refund_not_in_net");
  expect(gap.report.rows[0].evidence[0]).toBe("Stripe refunded $40.00 and net collected is $100.00. This is evidence only.");
  expect(gap.report.totals?.refund_not_in_net).toEqual({ count: 1, cents: 10000 });
  const blank = await run([payment({ netCollectedCents: null })], stripe([fact({ refundedCents: 4000 })]));
  expect(blank.report.rows[0].category).toBe("refund_not_in_net");
  expect(blank.report.rows[0].evidence[0]).toContain("net collected is blank");
});

it("keeps the database rows when Stripe is unavailable and withholds them on a database page cap", async () => {
  const stripeRead = vi.fn(async () => {
    throw new Error("boom");
  });
  const failed = await runRentReconciliation({
    enabled: true,
    userId: "manager",
    tier: "manager",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-12",
    load: async () => ({ ok: true as const, directory: { payments: [payment()], applications, rentals, vehicles } }),
    stripe: stripeRead,
  });
  expect(failed.status).toBe("ready");
  if (failed.status === "ready") {
    expect(failed.report.stripeCheck).toBe("unavailable");
    expect(failed.report.rows[0].amountCents).toBe(10000);
    expect(failed.report.rows[0].category).toBeNull();
    expect(failed.report.totals).toBeNull();
    expect(failed.report.warnings).toEqual([]);
    expect(rentReconciliationToCsv(failed.report)).toContain(STRIPE_CHECK_UNAVAILABLE);
  }
  const cappedStripe = vi.fn(async () => stripe());
  const capped = await runRentReconciliation({
    enabled: true,
    userId: "manager",
    tier: "manager",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "2026-10-12",
    load: async () => ({ ok: false as const, capped: true }),
    stripe: cappedStripe,
  });
  expect(cappedStripe).not.toHaveBeenCalled();
  expect(capped.status).toBe("ready");
  if (capped.status === "ready") {
    expect(capped.report.rows).toEqual([]);
    expect(capped.report.totals).toBeNull();
    expect(capped.report.warnings[0]).toContain("page cap");
    expect(capped.report.stripeCheck).toBe("unavailable");
  }
});

it("leaves deposits and rent from another week out of the chosen week", () => {
  const report = buildRentReconciliation({
    week: WEEK,
    payments: [
      payment({ id: "in", paidDate: "2026-10-18" }),
      payment({ id: "due", paidDate: null, dueDate: "2026-10-12", stripePaymentIntentId: "pi_due" }),
      payment({ id: "before", paidDate: "2026-10-11" }),
      payment({ id: "after", paidDate: "2026-10-19" }),
      payment({ id: "deposit", type: "deposit" }),
      payment({ id: "blank", paidDate: null, dueDate: null }),
    ],
    applications,
    rentals,
    vehicles,
    stripe: { ok: false },
  });
  expect(report.rows.map((row) => row.paymentId).sort()).toEqual(["due", "in"]);
  expect(report.stripeCheck).toBe("unavailable");
});

it("escapes commas, quotes, and formula text in the csv", async () => {
  const { report } = await run([payment()], stripe([fact()]));
  report.rows[0].renter = '=Ada, "Bee"';
  const csv = rentReconciliationToCsv(report);
  expect(csv).toContain(`"'=Ada, ""Bee"""`);
  expect(csv).toContain(RENT_CATEGORY_LABEL.matched);
  expect(csv).toContain("Week Starting,2026-10-12");
  expect(csv).not.toContain(STRIPE_CHECK_UNAVAILABLE);
});

it("does not read an unusable week", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const result = await runRentReconciliation({
    enabled: true,
    userId: "owner",
    tier: "owner",
    now: new Date("2026-10-21T15:00:00Z"),
    weekStart: "not-a-day",
    load,
  });
  expect(result).toEqual({ status: "unavailable", reason: "The week could not be read" });
  expect(load).not.toHaveBeenCalled();
});

it("keeps Rent Payment Reconciliation out of the dark nav and behind the throw", () => {
  const flag = readFileSync("src/lib/rent-reconciliation-flag.ts", "utf8");
  const fn = readFileSync("src/lib/rent-reconciliation.functions.ts", "utf8");
  const server = readFileSync("src/lib/rent-reconciliation.server.ts", "utf8");
  const pure = readFileSync("src/lib/rent-reconciliation.ts", "utf8");
  const stripeFile = readFileSync("src/lib/rent-reconciliation-stripe.server.ts", "utf8");
  const panel = readFileSync("src/components/admin/RentReconciliationPanel.tsx", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf("if (!RENT_RECONCILIATION_ENABLED) throw new Error(RENT_RECONCILIATION_OFF);");
  const manager = fn.indexOf("await requireManager(context.userId)");
  const table = fn.indexOf("loadRentReconciliation(");
  const stripeRead = fn.indexOf("readLiveRentStripe(");
  expect(flag).toContain("export const RENT_RECONCILIATION_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(manager).toBeGreaterThan(disabled);
  expect(table).toBeGreaterThan(manager);
  expect(stripeRead).toBeGreaterThan(manager);
  expect(fn.indexOf('import("./rent-reconciliation-stripe.server")')).toBeGreaterThan(manager);
  expect(tabs).not.toMatch(/id: "rent_reconciliation"/);
  expect(TABS.some((tab) => tab.id === "rent_reconciliation")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "rent_reconciliation")).toBe(false);
    expect(railEntries(tier).some((entry) => entry.id === "rent_reconciliation")).toBe(false);
  }
  expect(admin.indexOf('urlTab === "rent_reconciliation"')).toBeGreaterThan(-1);
  expect(admin.indexOf('urlTab === "rent_reconciliation"')).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('RENT_RECONCILIATION_ENABLED && tab === "rent_reconciliation"');
  expect(server).toContain("stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id");
  expect(server).not.toContain("createReadOnlyStripe");
  expect(server).not.toContain("createStripeClient");
  expect(stripeFile).toContain('createReadOnlyStripe("live", { cache: true })');
  expect(stripeFile).not.toContain("createStripeClient");
  expect(panel).toContain("STRIPE_CHECK_UNAVAILABLE");
  expect(panel).toContain("Week Starting");
  expect(pure).toContain('export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable"');
  for (const source of [flag, fn, server, pure, panel, stripeFile]) {
    expect(source).not.toMatch(/from ["']stripe["']/);
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  }
});
