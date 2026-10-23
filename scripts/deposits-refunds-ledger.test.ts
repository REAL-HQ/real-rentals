import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDepositsRefundsLedger, type DepositDeduction, type DepositPayment, type DepositRefund, type DepositRental, type DepositStripeRefund } from "../src/lib/deposits-refunds-ledger";
import { DEPOSITS_LEDGER_ENABLED } from "../src/lib/deposits-refunds-flag";
import { DEPOSIT_RECORDS_INCOMPLETE, loadDepositRecords, runDepositsRefunds } from "../src/lib/deposits-refunds-ledger.server";
import { readDepositRefunds } from "../src/lib/deposits-refunds-stripe.server";
import { TABS, visibleWorkspaceTabs, WORKSPACE_TABS } from "../src/components/admin/nav-config";

const stripeMock = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: [] as unknown[], has_more: false })),
  create: vi.fn(),
  calls: [] as { env: string; extra: number }[],
}));

vi.mock("../src/lib/stripe.server", () => ({
  createStripeClient: (env: string, ...rest: unknown[]) => {
    stripeMock.calls.push({ env, extra: rest.length });
    return {
      refunds: { list: stripeMock.list, create: stripeMock.create },
      charges: { create: stripeMock.create },
    };
  },
}));

const { clearStripeReaderCache, createReadOnlyStripe } = await import("../src/lib/stripe-reader.server");

const people = [{ id: "d1", fullName: "Ada Lovelace" }];
const vehicles = [{ id: "v1", year: 2020, make: "Toyota", model: "Camry", licensePlate: "ABC123", unitNumber: "12" }];
const rental: DepositRental = { id: "r1", driverId: "d1", vehicleId: "v1", depositAmount: "500.00", depositHeld: true };
const deposit: DepositPayment = {
  id: "p1", driverId: "d1", vehicleId: "v1", rentalId: "r1", type: " Deposit ", status: "Paid",
  amount: "200.00", refundedAmount: "50.00", paymentIntentId: "pi_1",
};
const rent: DepositPayment = {
  id: "p-rent", driverId: "d1", vehicleId: "v1", rentalId: "r1", type: "rent", status: "paid",
  amount: "300.00", refundedAmount: "0", paymentIntentId: "pi_rent",
};
const refund: DepositRefund = {
  id: "rf1", amount: "50.00", status: "succeeded", paymentIds: ["p1"],
  stripeRefundId: "re_1", stripeChargeId: "ch_1", paymentIntentId: "pi_1",
};
const damage: DepositDeduction = { id: "dd1", rentalId: "r1", amount: "40.00", incidentId: "i1", tollChargeId: null };
const toll: DepositDeduction = { id: "dd2", rentalId: "r1", amount: "10.00", incidentId: null, tollChargeId: "t1" };
const matchedStripe: DepositStripeRefund = {
  id: "re_1", amountCents: 5000, currency: "usd", status: "succeeded", chargeId: "ch_1", paymentIntentId: "pi_1",
};

function ledger(stripe: { ok: true; refunds: DepositStripeRefund[] } | { ok: false }, extras?: { deductions?: DepositDeduction[]; refunds?: DepositRefund[] }) {
  return buildDepositsRefundsLedger({
    payments: [deposit, rent],
    refunds: extras?.refunds ?? [refund],
    deductions: extras?.deductions ?? [damage, toll],
    rentals: [rental],
    people,
    vehicles,
    stripe,
  });
}

describe("deposits and refunds ledger", () => {
  it("holds the deposit once, subtracts the return and applications, and ignores rent", () => {
    const report = ledger({ ok: true, refunds: [matchedStripe, { id: "re_rent", amountCents: 1000, currency: "usd", status: "succeeded", chargeId: "ch_rent", paymentIntentId: "pi_rent" }] });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({
      renter: "Ada Lovelace",
      vehicle: "Unit 12 · 2020 Toyota Camry · ABC123",
      heldCents: 20000,
      returnedCents: 5000,
      damagesCents: 4000,
      tollsCents: 1000,
      outstandingCents: 10000,
    });
    expect(report.totals.outstandingCents).toBe(10000);
    expect(report.differences).toEqual([]);
    expect(report.stripeCheck).toBe("complete");
    expect(report).not.toHaveProperty("revenue");
    expect(report.groups[0]).not.toHaveProperty("revenueCents");
    const withoutRent = buildDepositsRefundsLedger({
      payments: [deposit],
      refunds: [refund],
      deductions: [damage, toll],
      rentals: [rental],
      people,
      vehicles,
      stripe: { ok: true, refunds: [matchedStripe] },
    });
    expect(withoutRent.groups[0].heldCents).toBe(report.groups[0].heldCents);
  });

  it("uses a held rental deposit only when no deposit payment names that rental", () => {
    const held = buildDepositsRefundsLedger({
      payments: [],
      refunds: [],
      deductions: [],
      rentals: [{ ...rental, depositAmount: "75.00" }],
      people,
      vehicles,
      stripe: { ok: true, refunds: [] },
    });
    expect(held.groups[0].heldCents).toBe(7500);
    const notHeld = buildDepositsRefundsLedger({
      payments: [],
      refunds: [],
      deductions: [],
      rentals: [{ ...rental, depositHeld: false }],
      people,
      vehicles,
      stripe: { ok: true, refunds: [] },
    });
    expect(notHeld.groups).toEqual([]);
  });

  it("counts refunded_amount only when no succeeded refund names the payment", () => {
    const report = buildDepositsRefundsLedger({
      payments: [{ ...deposit, refundedAmount: "25.00" }],
      refunds: [],
      deductions: [],
      rentals: [rental],
      people,
      vehicles,
      stripe: { ok: true, refunds: [] },
    });
    expect(report.groups[0].returnedCents).toBe(2500);
    expect(report.groups[0].outstandingCents).toBe(17500);
  });

  it("does not let a Stripe difference change outstanding", () => {
    const differs = ledger({ ok: true, refunds: [{ ...matchedStripe, amountCents: 4900 }] });
    expect(differs.differences).toEqual([{ id: "rf1", kind: "Amount Differs", appCents: 5000, stripeCents: 4900 }]);
    expect(differs.groups[0].outstandingCents).toBe(10000);
    const missing = ledger({ ok: true, refunds: [] });
    expect(missing.differences).toEqual([{ id: "rf1", kind: "Not On Stripe", appCents: 5000, stripeCents: null }]);
    const absent = buildDepositsRefundsLedger({
      payments: [deposit, rent],
      refunds: [{ ...refund, stripeRefundId: null }],
      deductions: [damage, toll],
      rentals: [rental],
      people,
      vehicles,
      stripe: { ok: true, refunds: [] },
    });
    expect(absent.differences[0].kind).toBe("Not On Stripe");
    const extra = ledger({
      ok: true,
      refunds: [matchedStripe, { id: "re_extra", amountCents: 2500, currency: "usd", status: "succeeded", chargeId: "ch_1", paymentIntentId: "pi_1" }],
    });
    expect(extra.differences).toEqual([{ id: "re_extra", kind: "Not In The Ledger", appCents: null, stripeCents: 2500 }]);
    expect(extra.groups[0].outstandingCents).toBe(10000);
    const foreign = ledger({ ok: true, refunds: [{ ...matchedStripe, currency: "eur" }] });
    expect(foreign.differences).toEqual([{ id: "rf1", kind: "Not USD", appCents: 5000, stripeCents: null }]);
  });

  it("keeps the deposit rows when the Stripe read fails", () => {
    const report = ledger({ ok: false });
    expect(report.groups[0].outstandingCents).toBe(10000);
    expect(report.stripeCheck).toBe("unavailable");
    expect(report.differences).toEqual([]);
    expect(report.notes).toContain("Stripe check unavailable");
  });

  it("blanks damages and tolls when one application is both or neither", () => {
    const both = ledger({ ok: true, refunds: [matchedStripe] }, {
      deductions: [{ id: "dd", rentalId: "r1", amount: "15.00", incidentId: "i1", tollChargeId: "t1" }],
    });
    expect(both.groups[0].damagesCents).toBeNull();
    expect(both.groups[0].tollsCents).toBeNull();
    expect(both.groups[0].outstandingCents).toBeNull();
    expect(both.notes).toContain("A deposit application is neither a damage nor a toll.");
    const neither = ledger({ ok: true, refunds: [matchedStripe] }, {
      deductions: [{ id: "dd", rentalId: "r1", amount: "15.00", incidentId: null, tollChargeId: null }],
    });
    expect(neither.groups[0].outstandingCents).toBeNull();
    expect(neither.notes).toContain("A deposit application is neither a damage nor a toll.");
  });
});

describe("deposits ledger access", () => {
  it("stays dark and does not load or call Stripe", async () => {
    expect(DEPOSITS_LEDGER_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/deposits-refunds-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const DEPOSITS_LEDGER_ENABLED = false/);
    expect(flag).not.toMatch(/process\.env/);
    const load = vi.fn();
    const readStripe = vi.fn();
    const result = await runDepositsRefunds({ enabled: false, userId: "owner", tier: "owner", load, readStripe });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(load).not.toHaveBeenCalled();
    expect(readStripe).not.toHaveBeenCalled();
  });

  it("refuses a coordinator before the load", async () => {
    const load = vi.fn();
    const readStripe = vi.fn();
    await expect(runDepositsRefunds({ enabled: true, userId: "c", tier: "coordinator", load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runDepositsRefunds({ enabled: true, userId: null, tier: "manager", load, readStripe })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
    expect(readStripe).not.toHaveBeenCalled();
  });

  it("keeps a failed Stripe read from blanking a manager's rows", async () => {
    const load = vi.fn(async () => ({
      ok: true as const,
      records: {
        payments: [deposit],
        refunds: [refund],
        deductions: [damage, toll],
        rentals: [rental],
        people,
        vehicles,
      },
    }));
    const thrown = await runDepositsRefunds({
      enabled: true,
      userId: "m",
      tier: "manager",
      load,
      readStripe: async () => { throw new Error("down"); },
    });
    expect(thrown.status).toBe("ready");
    if (thrown.status === "ready") {
      expect(thrown.report.groups[0].heldCents).toBe(20000);
      expect(thrown.report.notes).toContain("Stripe check unavailable");
    }
    const unavailable = await runDepositsRefunds({
      enabled: true,
      userId: "m",
      tier: "owner",
      load: async () => ({ ok: false }),
      readStripe: vi.fn(),
    });
    expect(unavailable).toEqual({ status: "unavailable", report: null, reason: DEPOSIT_RECORDS_INCOMPLETE });
  });

  it("checks the flag before the role and before the Stripe read", () => {
    const source = readFileSync(new URL("../src/lib/deposits-refunds-ledger.functions.ts", import.meta.url), "utf8");
    const flagAt = source.indexOf("if (!DEPOSITS_LEDGER_ENABLED) return");
    const roleAt = source.indexOf("requireManager");
    const stripeAt = source.indexOf("readLiveDepositRefunds");
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(roleAt);
    expect(roleAt).toBeLessThan(stripeAt);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|refunds\.create\s*\(|charges\.create\s*\(/);
  });
});

describe("deposit directory", () => {
  function stable<T extends { id: string }>(rows: T[]) {
    return async (cursor: string | null) => ({
      data: rows.filter((row) => cursor === null || row.id > cursor).slice(0, 1000),
      error: null as { message: string } | null,
    });
  }
  const source = () => ({
    payments: stable([{
      id: "p1", driver_id: "d1", vehicle_id: "v1", rental_id: "r1", type: "deposit", status: "paid",
      amount: 200, refunded_amount: 0, stripe_payment_intent_id: "pi_1",
    }]),
    refunds: stable([{
      id: "rf1", amount: 50, status: "succeeded", payment_ids: ["p1"], stripe_refund_id: "re_1",
      stripe_charge_id: "ch_1", stripe_payment_intent_id: "pi_1",
    }]),
    deductions: stable([
      { id: "dd1", amount: 40, rental_id: "r1", incident_id: "i1", toll_charge_id: null },
      { id: "dd2", amount: 10, rental_id: "r1", incident_id: null, toll_charge_id: "t1" },
    ]),
    rentals: stable([{ id: "r1", driver_id: "d1", vehicle_id: "v1", deposit_amount: 500, deposit_held: true }]),
    people: stable([{ id: "d1", full_name: "Ada Lovelace" }]),
    vehicles: stable([{ id: "v1", year: 2020, make: "Toyota", model: "Camry", license_plate: "ABC123", unit_number: "12" }]),
  });

  it("maps one stable scan into the same cents", async () => {
    const loaded = await loadDepositRecords(source());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const report = buildDepositsRefundsLedger({ ...loaded.records, stripe: { ok: true, refunds: [matchedStripe] } });
    expect(report.groups[0].outstandingCents).toBe(10000);
    expect(report).not.toHaveProperty("revenue");
  });

  it("withholds the report when the second scan disagrees, a row is unusable, or the page cap is hit", async () => {
    let n = 0;
    const changed = await loadDepositRecords({
      ...source(),
      payments: async () => {
        n += 1;
        return { data: [{ id: n === 1 ? "p1" : "p2", driver_id: "d1", vehicle_id: "v1", rental_id: "r1", type: "deposit", status: "paid", amount: 200, refunded_amount: 0, stripe_payment_intent_id: null }], error: null };
      },
    });
    expect(changed).toEqual({ ok: false });
    const badRefund = await loadDepositRecords({ ...source(), refunds: stable([{ id: "rf1", amount: 50, status: "succeeded", payment_ids: null, stripe_refund_id: null, stripe_charge_id: null, stripe_payment_intent_id: null }]) });
    expect(badRefund).toEqual({ ok: false });
    const full = async (cursor: string | null) => {
      const start = cursor ? Number(cursor) : 0;
      return { data: Array.from({ length: 1000 }, (_, i) => ({ id: String(start + i + 1).padStart(7, "0") })), error: null };
    };
    const capped = await loadDepositRecords({ ...source(), payments: full });
    expect(capped).toEqual({ ok: false });
  });
});

describe("stripe refund reader", () => {
  beforeEach(() => {
    clearStripeReaderCache();
    stripeMock.list.mockReset();
    stripeMock.list.mockResolvedValue({ data: [], has_more: false });
    stripeMock.calls.length = 0;
  });

  it("lists refunds and skips test-mode rows", async () => {
    const pages = [
      { data: [{ id: "re_test", amount: "nope", currency: "usd", status: "succeeded", livemode: false }], has_more: true },
      { data: [{ id: "re_live", amount: 5000, currency: "USD", status: "succeeded", livemode: true, charge: { id: "ch_1" }, payment_intent: "pi_1" }], has_more: false },
    ];
    let page = 0;
    const calls: unknown[] = [];
    const listed = await readDepositRefunds({
      refunds: { list: async (params) => { calls.push(params); return pages[page++]; } },
    });
    expect(calls).toEqual([{ limit: 100 }, { limit: 100, starting_after: "re_test" }]);
    expect(listed).toEqual({ ok: true, refunds: [{ id: "re_live", amountCents: 5000, currency: "usd", status: "succeeded", chargeId: "ch_1", paymentIntentId: "pi_1" }] });
  });

  it("fails closed on a bad live row or the page cap", async () => {
    const bad = await readDepositRefunds({
      refunds: { list: async () => ({ data: [{ id: "re_bad", amount: 1.5, currency: "usd", status: "succeeded", livemode: true }], has_more: false }) },
    });
    expect(bad).toEqual({ ok: false });
    let n = 0;
    const capped = await readDepositRefunds({
      refunds: { list: async () => { n += 1; return { data: [{ id: `re_${n}`, amount: 100, currency: "usd", status: "succeeded", livemode: true }], has_more: true }; } },
    });
    expect(capped).toEqual({ ok: false });
    expect(n).toBe(100);
  });

  it("uses createReadOnlyStripe for list only", async () => {
    const { readLiveDepositRefunds } = await import("../src/lib/deposits-refunds-stripe.server");
    const reader = readFileSync(new URL("../src/lib/deposits-refunds-stripe.server.ts", import.meta.url), "utf8");
    const client = readFileSync(new URL("../src/lib/stripe-reader.server.ts", import.meta.url), "utf8");
    expect(reader).toContain("createReadOnlyStripe");
    expect(reader).toContain("refunds.list");
    expect(reader).not.toMatch(/refunds\.create\s*\(/);
    expect(reader).not.toMatch(/charges\.create\s*\(/);
    expect(client).not.toMatch(/refunds\.create\s*\(|charges\.create\s*\(/);
    const stripe = createReadOnlyStripe("live", { cache: true });
    expect(stripeMock.calls).toEqual([{ env: "live", extra: 0 }]);
    expect(() => (stripe.refunds as { create?: unknown }).create).toThrow("Stripe reader refuses refunds.create");
    expect(() => (stripe as unknown as { charges: { create?: unknown } }).charges.create).toThrow("Stripe reader refuses charges.create");
    await stripe.refunds.list({ limit: 1 });
    expect(stripeMock.list).toHaveBeenCalledWith({ limit: 1 }, { timeout: 20000 });
    const live = await readLiveDepositRefunds();
    expect(live).toEqual({ ok: true, refunds: [] });
  });
});

describe("dark admin entry", () => {
  it("keeps the tab out of the rail and mounts it only while the flag is on", () => {
    expect(TABS.map((tab) => tab.id)).not.toContain("deposits_refunds");
    expect(TABS.map((tab) => tab.id)).not.toContain("deposit_ledger");
    expect(TABS.map((tab) => tab.id)).not.toContain("deposits_ledger");
    expect(WORKSPACE_TABS.payments.map((tab) => tab.id)).toEqual(["payments", "charges"]);
    expect(visibleWorkspaceTabs("payments", "manager").map((tab) => tab.id)).toEqual(["payments", "charges"]);
    expect(visibleWorkspaceTabs("payments", "coordinator")).toEqual([]);
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("deposits_refunds");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    const special = admin.indexOf('urlTab === "deposits_refunds"');
    const known = admin.indexOf("!TABS.some((t) => t.id === urlTab)");
    expect(special).toBeGreaterThan(-1);
    expect(special).toBeLessThan(known);
    expect(admin).toContain('DEPOSITS_LEDGER_ENABLED && tab === "deposits_refunds"');
    const panel = readFileSync(new URL("../src/components/admin/DepositsRefundsPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("Applied To Damages");
    expect(panel).toContain("Applied To Tolls");
    expect(panel).toContain("Deposits are never counted as revenue.");
    expect(panel).not.toMatch(/text-transform|uppercase|capitalize/);
    expect(panel).not.toMatch(/>\s*Revenue\s*</);
    for (const file of [
      "deposits-refunds-ledger.ts",
      "deposits-refunds-ledger.server.ts",
      "deposits-refunds-stripe.server.ts",
      "stripe-reader.ts",
      "stripe-reader.server.ts",
    ]) {
      const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(source).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
    }
  });
});
