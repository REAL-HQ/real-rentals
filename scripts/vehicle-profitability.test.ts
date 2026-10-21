import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleTabs, railEntries } from "../src/components/admin/nav-config";
import { VEHICLE_PROFITABILITY_ENABLED } from "../src/lib/vehicle-profitability-flag";
import { buildVehicleProfitReport, etMidnightUnix, periodWindow, type ProfitCharge, type ProfitVehicleRow } from "../src/lib/vehicle-profitability";
import { readProfitCharges, type ReadOnlyStripeGateway } from "../src/lib/vehicle-profitability-read.server";
import { runVehicleProfit } from "../src/lib/vehicle-profitability.server";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const vehicle = (patch: Partial<ProfitVehicleRow> & Pick<ProfitVehicleRow, "id">): ProfitVehicleRow => ({
  year: 2022, make: "Toyota", model: "Camry", licensePlate: "ABC123", partnerId: null,
  createdAt: "2026-01-01T05:00:00.000Z", archivedAt: null, ...patch,
});
const charge = (patch: Partial<ProfitCharge> & Pick<ProfitCharge, "id">): ProfitCharge => ({
  customerId: null, paymentIntentId: null, invoiceId: null, subscriptionId: null, amountCents: 35000,
  currency: "usd", succeeded: true, created: etMidnightUnix("2026-10-02")! + 3600, ...patch,
});

function report(patch: Partial<Parameters<typeof buildVehicleProfitReport>[0]> = {}) {
  return buildVehicleProfitReport({
    period: "this_month", now: NOW, charges: [], payments: [], rentals: [], expenses: [], maintenance: [],
    vehicles: [vehicle({ id: "veh-1" })], partners: [], ...patch,
  });
}

describe("period", () => {
  it("uses Eastern Time month boundaries, including the previous evening UTC", () => {
    const boundary = periodWindow("this_month", new Date("2026-11-01T03:30:00.000Z"));
    expect(boundary).toMatchObject({ from: "2026-10-01", to: "2026-11-01" });
    expect(etMidnightUnix("2026-01-15")).toBe(Math.floor(Date.parse("2026-01-15T05:00:00.000Z") / 1000));
    expect(etMidnightUnix("2026-07-15")).toBe(Math.floor(Date.parse("2026-07-15T04:00:00.000Z") / 1000));
    const last = periodWindow("last_month", NOW);
    expect(last).toMatchObject({ from: "2026-09-01", to: "2026-10-01" });
    const days = periodWindow("last_90", NOW);
    expect(days && (days.lt - days.gte) / 86400).toBeGreaterThan(89);
    expect(days).toMatchObject({ from: "2026-07-24", to: "2026-10-22" });
  });
});

describe("attribution and expenses", () => {
  it("attributes a charge only through one payment or rental, and leaves the rest unattributed", () => {
    const built = report({
      charges: [
        charge({ id: "ch_pay", paymentIntentId: "pi_1" }),
        charge({ id: "ch_sub", subscriptionId: "sub_1" }),
        charge({ id: "ch_cus", customerId: "cus_1" }),
        charge({ id: "ch_none", customerId: "cus_unknown" }),
        charge({ id: "ch_two", customerId: "cus_many" }),
        charge({ id: "ch_dep", paymentIntentId: "pi_dep" }),
        charge({ id: "ch_fight", paymentIntentId: "pi_a", subscriptionId: "sub_b" }),
      ],
      payments: [
        { id: "pay-1", vehicleId: "veh-1", type: "rent", paymentIntentId: "pi_1", invoiceId: null, subscriptionId: null },
        { id: "pay-2", vehicleId: "veh-1", type: "deposit", paymentIntentId: "pi_dep", invoiceId: null, subscriptionId: null },
        { id: "pay-3", vehicleId: "veh-1", type: "rent", paymentIntentId: "pi_a", invoiceId: null, subscriptionId: null },
      ],
      rentals: [
        { id: "rent-1", vehicleId: "veh-1", customerId: "cus_1", subscriptionId: "sub_1", startDate: "2026-10-01", endDate: "2026-10-11", status: "ended" },
        { id: "rent-2", vehicleId: "veh-1", customerId: "cus_many", subscriptionId: null, startDate: "2026-10-01", endDate: "2026-10-04", status: "ended" },
        { id: "rent-3", vehicleId: "veh-2", customerId: "cus_many", subscriptionId: "sub_b", startDate: "2026-10-04", endDate: "2026-10-08", status: "ended" },
      ],
      vehicles: [vehicle({ id: "veh-1" }), vehicle({ id: "veh-2", make: "Honda", model: "Civic", licensePlate: "ZZZ999" })],
    });
    expect(built?.rows.find((row) => row.vehicleId === "veh-1")?.revenueCents).toBe(35000 * 3);
    expect(built?.rows.find((row) => row.vehicleId === "veh-2")?.revenueCents).toBe(0);
    expect(built?.unattributedStripeRevenueCents).toBe(35000 * 3);
    expect(built?.conflictingCharges).toBe(2);
    expect(built?.depositsExcludedCents).toBe(35000);
  });

  it("counts a linked service once, by expense category, and blanks a disagreeing share", () => {
    const once = report({
      expenses: [
        { id: "exp-1", vehicleId: "veh-1", category: "insurance", amount: "12.50", incurredOn: "2026-10-03", maintenanceRecordId: null },
        { id: "exp-2", vehicleId: "veh-1", category: "repair", amount: 40, incurredOn: "2026-10-04", maintenanceRecordId: "svc-1" },
      ],
      maintenance: [
        { id: "svc-1", vehicleId: "veh-1", category: "repair", companyShare: 40, performedOn: "2026-10-04", completedAt: null, createdAt: "2026-10-04T15:00:00.000Z" },
      ],
    });
    expect(once?.rows[0]?.expenseCents).toBe(1250 + 4000);
    expect(once?.rows[0]?.expenses.map((line) => line.label)).toEqual(["Insurance Premium", "Repair"]);
    expect(once?.rows[0]?.netCents).toBe(-(1250 + 4000));
    const fight = report({
      expenses: [{ id: "exp-2", vehicleId: "veh-1", category: "repair", amount: 40, incurredOn: "2026-10-04", maintenanceRecordId: "svc-1" }],
      maintenance: [{ id: "svc-1", vehicleId: "veh-1", category: "repair", companyShare: 30, performedOn: "2026-10-04", completedAt: null, createdAt: null }],
    });
    expect(fight?.rows[0]).toMatchObject({ expenseCents: null, netCents: null });
  });

  it("uses a zero company share's linked expense and does not invent a split", () => {
    const built = report({
      expenses: [{ id: "exp-2", vehicleId: "veh-1", category: "maintenance", amount: 15, incurredOn: "2026-10-04", maintenanceRecordId: "svc-1" }],
      maintenance: [{ id: "svc-1", vehicleId: "veh-1", category: "maintenance", companyShare: 0, performedOn: "2026-10-04", completedAt: null, createdAt: null }],
      partners: [{ id: "partner-1", name: "Dolmar", revenueSplitPct: 60 }],
    });
    expect(built?.rows[0]?.expenseCents).toBe(1500);
    expect(built?.rows[0]?.split).toBe("not_configured");
    const shared = report({
      vehicles: [vehicle({ id: "veh-1", partnerId: "partner-1" })],
      partners: [{ id: "partner-1", name: "Dolmar", revenueSplitPct: 60 }],
      charges: [charge({ id: "ch_1", paymentIntentId: "pi_1", amountCents: 10000 })],
      payments: [{ id: "pay-1", vehicleId: "veh-1", type: "rent", paymentIntentId: "pi_1", invoiceId: null, subscriptionId: null }],
    });
    expect(shared?.rows[0]?.partnerShareCents).toBe(6000);
    expect(shared?.rows[0]?.split).toBe("configured");
  });

  it("measures rented days over owned days inside the elapsed Eastern window", () => {
    const built = report({
      vehicles: [vehicle({ id: "veh-1", createdAt: "2026-10-01T04:00:00.000Z" })],
      rentals: [
        { id: "rent-1", vehicleId: "veh-1", customerId: null, subscriptionId: null, startDate: "2026-10-01", endDate: "2026-10-11", status: "ended" },
        { id: "rent-2", vehicleId: "veh-1", customerId: null, subscriptionId: null, startDate: "2026-10-10", endDate: "2026-10-12", status: "ended" },
        { id: "rent-3", vehicleId: "veh-1", customerId: null, subscriptionId: null, startDate: "2026-10-01", endDate: "2026-10-20", status: "cancelled" },
      ],
      charges: [charge({ id: "ch_1", paymentIntentId: "pi_1", amountCents: 11000 })],
      payments: [{ id: "pay-1", vehicleId: "veh-1", type: "rent", paymentIntentId: "pi_1", invoiceId: null, subscriptionId: null }],
    });
    expect(built?.rows[0]).toMatchObject({ daysOwned: 21, daysRented: 11, revenuePerRentedDayCents: 1000 });
    const open = report({
      rentals: [{ id: "rent-1", vehicleId: "veh-1", customerId: null, subscriptionId: null, startDate: null, endDate: null, status: "ended" }],
    });
    expect(open?.rows[0]?.daysRented).toBeNull();
  });
});

describe("flag and guard", () => {
  it("stays off and does not read", async () => {
    expect(VEHICLE_PROFITABILITY_ENABLED).toBe(false);
    expect(visibleTabs("owner").some((tab) => tab.id === "vehicle_profit")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "vehicle_profit")).toBe(false);
    expect(railEntries("owner").map((entry) => entry.label).join(",")).not.toContain("Vehicle Profit");
    let called = false;
    const touch = async () => { called = true; throw new Error("read"); };
    const result = await runVehicleProfit({
      enabled: false, userId: "owner-1", roles: ["admin"], period: "this_month", load: touch, readCharges: touch,
    });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(called).toBe(false);
  });

  it("refuses a coordinator before the directory or Stripe", async () => {
    let called = false;
    const touch = async () => { called = true; throw new Error("read"); };
    await expect(runVehicleProfit({
      enabled: true, userId: "coord-1", roles: ["coordinator"], period: "this_month", load: touch, readCharges: touch,
    })).rejects.toThrow("Forbidden");
    expect(called).toBe(false);
  });

  it("does not call Stripe when the directory is incomplete", async () => {
    let stripe = false;
    const result = await runVehicleProfit({
      enabled: true, userId: "mgr-1", roles: ["team"], period: "this_month", now: NOW,
      load: async () => null,
      readCharges: async () => { stripe = true; return { ok: false, reason: "no" }; },
    });
    expect(result.status).toBe("unavailable");
    expect(stripe).toBe(false);
  });

  it("lists charges and nothing else", async () => {
    const gateway: ReadOnlyStripeGateway = {
      charges: { list: async () => ({ data: [{ id: "ch_1", amount_captured: 35000, currency: "usd", status: "succeeded", paid: true, captured: true, created: 1_700_000_000, customer: "cus_1", payment_intent: "pi_1", invoice: { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } }, livemode: true }], has_more: false }) },
    };
    const result = await readProfitCharges(gateway, { gte: 1, lt: 2 });
    expect(result.ok && result.charges[0]).toMatchObject({ id: "ch_1", customerId: "cus_1", subscriptionId: "sub_1", invoiceId: "in_1" });
    const source = readFileSync("src/lib/vehicle-profitability-read.server.ts", "utf8");
    const refs = [...source.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(new Set(refs)).toEqual(new Set(["charges.list"]));
    for (const verb of ["create", "update", "del", "delete", "capture", "confirm", "cancel", "refund"]) {
      expect(source).not.toMatch(new RegExp(`\\.${verb}\\(`));
      expect(readFileSync("src/lib/vehicle-profitability.functions.ts", "utf8")).not.toMatch(new RegExp(`\\.${verb}\\(`));
    }
    const handler = readFileSync("src/lib/vehicle-profitability.functions.ts", "utf8");
    expect(handler.indexOf("vehicleProfitEnabled")).toBeLessThan(handler.indexOf("from(\"user_roles\")"));
    expect(handler).toContain("VEHICLE_PROFITABILITY_ENABLED");
    expect(readFileSync("src/routes/admin.tsx", "utf8")).toContain("VEHICLE_PROFITABILITY_ENABLED && tab === \"vehicle_profit\"");
  });
});
