import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleWorkspaceTabs } from "../src/components/admin/nav-config";
import { buildDepositsLedger, heldDeposits, ledgerTotals, periodWindow, type DepositPerson, type LedgerCharge, type LedgerRefund } from "../src/lib/deposits-ledger";
import { depositsLedgerEnabled } from "../src/lib/deposits-ledger-flag";
import { readDepositsLedger, type ListOnlyStripeGateway } from "../src/lib/deposits-ledger-read.server";
import { runDepositsLedger } from "../src/lib/deposits-ledger.server";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("list-only guard", () => {
  it("lists refunds and charges and never retrieves or writes", () => {
    const source = read("lib/deposits-ledger-read.server.ts");
    const calls = [...source.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(calls).toEqual(expect.arrayContaining(["refunds.list", "charges.list"]));
    expect(calls.every((call) => call === "refunds.list" || call === "charges.list")).toBe(true);
    expect(source).not.toMatch(/\.(retrieve|create|update|del|delete|capture|confirm|cancel|refund|createPreview|retrieveUpcoming)\s*\(/);
    const panel = read("components/admin/DepositsLedgerPanel.tsx");
    const server = read("lib/deposits-ledger.server.ts") + read("lib/deposits-ledger.functions.ts") + panel;
    expect(server).not.toContain("settleDeposit");
    expect(server).not.toContain("DepositDialog");
    expect(panel).toContain("No deposit records");
  });

  it("checks the flag before any role or table read", () => {
    const source = read("lib/deposits-ledger.functions.ts");
    const handler = source.slice(source.indexOf(".handler"));
    const flag = handler.indexOf("depositsLedgerEnabled()");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(handler.indexOf('from("user_roles")'));
    expect(flag).toBeLessThan(handler.indexOf("loadDepositsDirectory"));
  });
});

describe("Eastern period math", () => {
  it("uses This Month, Last Month, and 90 Days on Eastern midnights", () => {
    expect(periodWindow("this_month", NOW)).toEqual({ from: "2026-10-01", to: "2026-11-01", gte: unix("2026-10-01T04:00:00.000Z"), lt: unix("2026-11-01T04:00:00.000Z") });
    expect(periodWindow("last_month", NOW)).toEqual({ from: "2026-09-01", to: "2026-10-01", gte: unix("2026-09-01T04:00:00.000Z"), lt: unix("2026-10-01T04:00:00.000Z") });
    expect(periodWindow("last_90", NOW)).toEqual({ from: "2026-07-24", to: "2026-10-22", gte: unix("2026-07-24T04:00:00.000Z"), lt: unix("2026-10-22T04:00:00.000Z") });
  });

  it("anchors standard time, daylight time, and the evening before the fall change", () => {
    expect(periodWindow("this_month", new Date("2026-01-15T17:00:00.000Z"))).toMatchObject({ gte: unix("2026-01-01T05:00:00.000Z"), lt: unix("2026-02-01T05:00:00.000Z") });
    expect(periodWindow("this_month", new Date("2026-07-15T16:00:00.000Z"))).toMatchObject({ gte: unix("2026-07-01T04:00:00.000Z"), lt: unix("2026-08-01T04:00:00.000Z") });
    expect(periodWindow("this_month", new Date("2026-11-01T03:30:00.000Z"))?.from).toBe("2026-10-01");
    expect(periodWindow("last_month", new Date("2026-01-15T17:00:00.000Z"))).toMatchObject({ from: "2025-12-01", gte: unix("2025-12-01T05:00:00.000Z") });
  });
});

describe("totals", () => {
  const window = periodWindow("this_month", NOW)!;
  const charge = (over: Partial<LedgerCharge> = {}): LedgerCharge => ({ id: "ch_1", amountCents: 10000, currency: "usd", created: window.gte, succeeded: true, ...over });
  const refund = (over: Partial<LedgerRefund> = {}): LedgerRefund => ({
    id: "re_1", amountCents: 2500, currency: "usd", status: "succeeded", reason: "requested_by_customer", created: window.gte + 10,
    chargeCreated: window.gte - 86400, customer: { id: "cus_ada", email: "ada@example.com", phone: null }, ...over,
  });

  it("subtracts succeeded refunds from gross and can go negative", () => {
    expect(ledgerTotals([charge()], [refund()])).toEqual({ grossCents: 10000, refundCents: 2500, netCents: 7500 });
    expect(ledgerTotals([charge({ amountCents: 1000 })], [refund({ amountCents: 2500 })])).toEqual({ grossCents: 1000, refundCents: 2500, netCents: -1500 });
    expect(ledgerTotals([charge({ succeeded: false, amountCents: 9000 })], [refund({ status: "pending" })])).toEqual({ grossCents: 0, refundCents: 0, netCents: 0 });
  });

  it("withholds a mixed-currency total and keeps a pending refund out of it", () => {
    expect(ledgerTotals([charge({ currency: "eur" })], [])).toBeNull();
    expect(ledgerTotals([charge()], [refund({ currency: "eur" })])).toBeNull();
    expect(ledgerTotals([charge()], [refund({ status: "pending", currency: "eur" })])).toEqual({ grossCents: 10000, refundCents: 0, netCents: 10000 });
  });

  it("drops money outside the period and matches the refund to the driver", () => {
    const report = buildDepositsLedger({
      period: "this_month", now: NOW, applications: [{
        id: "app_ada", fullName: "Ada Driver", email: "ada@example.com", phone: "(555) 111-2222",
        stripeCustomerId: "cus_ada", userId: "user_ada", deletedAt: null, status: "active",
      }], rentals: [], charges: [charge(), charge({ id: "ch_old", created: window.gte - 1 })],
      refunds: [refund(), refund({ id: "re_old", created: window.lt })],
      depositRentals: [], depositPayments: [], vehicles: [], people: [],
    });
    expect(report?.totals).toEqual({ grossCents: 10000, refundCents: 2500, netCents: 7500 });
    expect(report?.from).toBe("2026-10-01");
    expect(report?.through).toBe("2026-10-31");
    expect(report?.refunds).toEqual([expect.objectContaining({
      id: "re_1", amountCents: 2500, status: "Succeeded", chargeDate: "2026-09-30",
      match: expect.objectContaining({ driverId: "app_ada", phone: "(555) 111-2222", reason: "Stripe Customer Id" }),
    })]);
  });

  it("refuses a repeated refund with a different amount", () => {
    const report = buildDepositsLedger({
      period: "this_month", now: NOW, applications: [], rentals: [], charges: [],
      refunds: [refund(), refund({ amountCents: 100 })], depositRentals: [], depositPayments: [], vehicles: [], people: [],
    });
    expect(report).toBeNull();
  });
});

describe("held deposits", () => {
  const person: DepositPerson = { id: "app_ada", fullName: "Ada Driver", userId: "user_ada", phone: "(555) 111-2222" };
  const vehicle = { id: "veh_1", year: 2020, make: "Toyota", model: "Camry", unitNumber: "12" };

  it("says nothing when no deposit is held, and does not invent an amount", () => {
    expect(heldDeposits({
      depositRentals: [{ id: "rent_1", applicationId: "app_ada", driverUserId: "user_ada", vehicleId: "veh_1", depositAmount: 500, depositHeld: false, depositStatus: "none" }],
      depositPayments: [], vehicles: [vehicle], people: [person],
    })).toEqual([]);
    const settled = heldDeposits({
      depositRentals: [{ id: "rent_1", applicationId: "app_ada", driverUserId: "user_ada", vehicleId: "veh_1", depositAmount: 500, depositHeld: true, depositStatus: "refunded" }],
      depositPayments: [{ id: "pay_1", rentalId: "rent_1", driverId: "app_ada", vehicleId: "veh_1", status: "paid", netCollected: 500, paidDate: "2026-09-02" }],
      vehicles: [vehicle], people: [person],
    });
    expect(settled).toEqual([]);
  });

  it("uses the collected net and leaves a missing net blank", () => {
    const held = heldDeposits({
      depositRentals: [{ id: "rent_1", applicationId: "app_ada", driverUserId: "user_ada", vehicleId: "veh_1", depositAmount: 500, depositHeld: true, depositStatus: "none" }],
      depositPayments: [{ id: "pay_1", rentalId: "rent_1", driverId: "app_ada", vehicleId: "veh_1", status: "paid", netCollected: 400, paidDate: "2026-09-02T15:00:00Z" }],
      vehicles: [vehicle], people: [person],
    });
    expect(held).toEqual([expect.objectContaining({ amountCents: 40000, driverName: "Ada Driver", phone: "(555) 111-2222", vehicle: "12 · 2020 Toyota Camry", collectedDate: "2026-09-02", status: "Held" })]);
    const blank = heldDeposits({
      depositRentals: [{ id: "rent_2", applicationId: "app_ada", driverUserId: null, vehicleId: "veh_1", depositAmount: 500, depositHeld: false, depositStatus: "pending_disposition" }],
      depositPayments: [{ id: "pay_2", rentalId: "rent_2", driverId: "app_ada", vehicleId: "veh_1", status: "paid", netCollected: null, paidDate: null }],
      vehicles: [vehicle], people: [person],
    });
    expect(blank[0]).toMatchObject({ amountCents: null, collectedDate: null, status: "Pending Disposition" });
  });
});

describe("flag off", () => {
  it("is on only for the exact string true", () => {
    expect(depositsLedgerEnabled({ DEPOSITS_LEDGER_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "TRUE", "1", "yes", " true", "true "]) expect(depositsLedgerEnabled({ DEPOSITS_LEDGER_ENABLED: value })).toBe(false);
  });

  it("returns before deposits and Stripe, and refuses a coordinator", async () => {
    let loads = 0;
    let reads = 0;
    const load = async () => { loads += 1; return null; };
    const readStripe = async () => { reads += 1; return { ok: false as const, reason: "should not run" }; };
    const off = await runDepositsLedger({ enabled: false, userId: "user", roles: ["admin"], period: "this_month", load, readStripe });
    expect(off).toEqual({ status: "disabled", report: null });
    await expect(runDepositsLedger({ enabled: true, userId: null, roles: ["admin"], period: "this_month", load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runDepositsLedger({ enabled: true, userId: "user", roles: ["coordinator"], period: "last_90", load, readStripe })).rejects.toThrow("Forbidden");
    expect(loads).toBe(0);
    expect(reads).toBe(0);
    const missing = await runDepositsLedger({ enabled: true, userId: "user", roles: ["team"], period: "last_month", load, readStripe });
    expect(missing.status).toBe("unavailable");
    expect(loads).toBe(1);
    expect(reads).toBe(0);
  });

  it("stays off the rail and out of a coordinator Payments workspace", () => {
    expect(visibleWorkspaceTabs("payments", "manager").map((tab) => tab.id)).toContain("deposits_ledger");
    expect(visibleWorkspaceTabs("payments", "owner").map((tab) => tab.id)).toContain("deposits_ledger");
    expect(visibleWorkspaceTabs("payments", "coordinator")).toEqual([]);
    expect(railEntries("owner").map((entry) => entry.label)).not.toContain("Deposits & Refunds");
  });
});

describe("Stripe reader", () => {
  const window = periodWindow("this_month", NOW)!;

  it("fails closed when the charge is not expanded or the account is not live", async () => {
    const gateway = (charge: unknown, livemode = true): ListOnlyStripeGateway => ({
      refunds: { list: async (params) => {
        expect(params.expand).toEqual(["data.charge.customer"]);
        expect(params.created).toEqual({ gte: window.gte, lt: window.lt });
        return { data: [{ id: "re_1", amount: 2500, currency: "usd", status: "succeeded", reason: "duplicate", created: window.gte, charge, livemode }], has_more: false };
      } },
      charges: { list: async () => ({ data: [{ id: "ch_1", amount: 10000, amount_captured: 10000, currency: "usd", status: "succeeded", paid: true, captured: true, created: window.gte, livemode: true }], has_more: false }) },
    });
    const expanded = await readDepositsLedger(gateway({ id: "ch_old", created: window.gte - 86400, customer: { id: "cus_ada", email: "Ada@Example.com", phone: null, livemode: true }, livemode: true }), window, { now: () => NOW.getTime() });
    expect(expanded.ok && expanded.refunds[0]).toMatchObject({ chargeCreated: window.gte - 86400, customer: { id: "cus_ada", email: "Ada@Example.com" } });
    const bare = await readDepositsLedger(gateway("ch_old"), window, { now: () => NOW.getTime() });
    expect(bare.ok).toBe(false);
    const testMode = await readDepositsLedger(gateway({ id: "ch_old", created: window.gte, customer: "cus_ada", livemode: true }, false), window, { now: () => NOW.getTime() });
    expect(testMode.ok).toBe(false);
  });
});
