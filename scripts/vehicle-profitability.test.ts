import { readFileSync, existsSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { VEHICLE_PROFITABILITY_ENABLED, VEHICLE_PROFITABILITY_OFF } from "../src/lib/vehicle-profitability-flag";
import {
  MISSING_COST_SOURCES,
  buildVehicleProfit,
  defaultProfitRange,
  vehicleProfitToCsv,
  type ProfitPayment,
  type ProfitVehicle,
} from "../src/lib/vehicle-profitability";
import { runVehicleProfit } from "../src/lib/vehicle-profitability.server";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const RANGE = { from: "2026-10-01", through: "2026-10-10" };

function vehicle(id: string, patch: Partial<ProfitVehicle> = {}): ProfitVehicle {
  return {
    id, year: 2022, make: "Toyota", model: "Camry", licensePlate: "ABC123",
    createdAt: "2026-01-01", archivedAt: null, ...patch,
  };
}

function payment(patch: Partial<ProfitPayment> & Pick<ProfitPayment, "id">): ProfitPayment {
  return {
    rentalId: "rent-1", vehicleId: null, status: "paid", type: "rent",
    amount: 100, netCollected: 75, refundedAmount: 25, paidDate: "2026-10-03", ...patch,
  };
}

it("attributes collected revenue through the rental, nets refunds, and keeps a vehicle with no payments", () => {
  const report = buildVehicleProfit({
    range: RANGE,
    vehicles: [
      vehicle("veh-1"),
      vehicle("veh-2", { make: "Honda", model: "Civic", licensePlate: "ZZZ999" }),
      vehicle("veh-3", { make: "Nissan", model: "Versa", licensePlate: "NNN111" }),
    ],
    rentals: [
      { id: "rent-1", vehicleId: "veh-1", startDate: "2026-10-01", endDate: "2026-10-06", status: "ended" },
      { id: "rent-cancel", vehicleId: "veh-1", startDate: "2026-10-01", endDate: "2026-10-11", status: "cancelled" },
    ],
    payments: [
      payment({ id: "pay-rent", vehicleId: "veh-2" }),
      payment({ id: "pay-math", status: "refunded", amount: 40, netCollected: null, refundedAmount: 10, paidDate: "2026-10-04" }),
      payment({ id: "pay-none", rentalId: null, vehicleId: null, type: "late_fee", amount: 1234.56, netCollected: 1234.56, refundedAmount: 0, paidDate: "2026-10-02" }),
      payment({ id: "pay-deposit", type: "deposit", amount: 500, netCollected: 500, refundedAmount: 0, paidDate: "2026-10-01" }),
      payment({ id: "pay-out", amount: 999, netCollected: 999, refundedAmount: 0, paidDate: "2026-09-01" }),
      payment({ id: "pay-failed", status: "failed", amount: 80, netCollected: null, refundedAmount: 0, paidDate: "2026-10-02" }),
    ],
    expenses: [
      { id: "exp-1", vehicleId: "veh-1", amount: "12.50", incurredOn: "2026-10-03", maintenanceRecordId: "svc-1" },
    ],
    maintenance: [
      { id: "svc-1", vehicleId: "veh-1", companyShare: 40, totalCost: 40, performedOn: "2026-10-03", completedAt: null, createdAt: null },
      { id: "svc-2", vehicleId: "veh-2", companyShare: 10, totalCost: 10, performedOn: "2026-10-02", completedAt: null, createdAt: null },
    ],
  });
  const honda = report.rows.find((row) => row.vehicleId === "veh-2");
  const toyota = report.rows.find((row) => row.vehicleId === "veh-1");
  const nissan = report.rows.find((row) => row.vehicleId === "veh-3");
  expect(toyota).toMatchObject({
    revenueCents: 7500 + 3000,
    expenseCents: 1250,
    maintenanceCents: 0,
    netCents: 10500 - 1250,
    daysRented: 5,
    daysAvailable: 10,
    utilizationPercent: 50,
    revenuePerRentedDayCents: 2100,
  });
  expect(honda).toMatchObject({ revenueCents: 0, maintenanceCents: 1000, netCents: -1000, daysRented: 0, utilizationPercent: 0, revenuePerRentedDayCents: null });
  expect(nissan).toMatchObject({ revenueCents: 0, expenseCents: 0, maintenanceCents: 0, netCents: 0, daysRented: 0, daysAvailable: 10, utilizationPercent: 0 });
  expect(report.unattributed.map((row) => [row.id, row.amountCents])).toEqual([["pay-none", 123456]]);
  expect(report.depositsExcludedCents).toBe(50000);
  expect(report.missingCostSources).toEqual(MISSING_COST_SOURCES);
  const csv = vehicleProfitToCsv(report);
  expect(csv).toContain('"$1,234.56"');
  expect(csv).toContain("50%");
  expect(csv.startsWith("Vehicle Profitability\r\n")).toBe(true);
});

it("defaults to the last 90 Eastern Time days", () => {
  expect(defaultProfitRange(NOW)).toEqual({ from: "2026-07-24", through: "2026-10-21" });
  expect(defaultProfitRange(new Date("2026-10-21T03:30:00Z"))).toEqual({ from: "2026-07-23", through: "2026-10-20" });
});

it("throws while the flag is off, before any read, and refuses a coordinator", async () => {
  expect(VEHICLE_PROFITABILITY_ENABLED).toBe(false);
  const load = vi.fn();
  await expect(runVehicleProfit({
    enabled: false, userId: "owner-1", tier: "owner", now: NOW, range: null, load,
  })).rejects.toThrow(VEHICLE_PROFITABILITY_OFF);
  await expect(runVehicleProfit({
    enabled: true, userId: "coord-1", tier: "coordinator", now: NOW, range: RANGE, load,
  })).rejects.toThrow("Forbidden");
  await expect(runVehicleProfit({
    enabled: true, userId: null, tier: "manager", now: NOW, range: RANGE, load,
  })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
  const owner = await runVehicleProfit({
    enabled: true, userId: "owner-1", tier: "owner", now: NOW, range: null,
    load: async () => ({ ok: true, directory: { vehicles: [], rentals: [], payments: [], expenses: [], maintenance: [] } }),
  });
  expect(owner.report?.from).toBe("2026-07-24");
  expect(owner.report?.rows).toEqual([]);
  await expect(runVehicleProfit({
    enabled: true, userId: "mgr-1", tier: "manager", now: NOW, range: { from: "2026-10-11", through: "2026-10-01" }, load,
  })).rejects.toThrow("The date range is not valid");
  expect(load).not.toHaveBeenCalled();
});

it("stays out of the tab list and does not call Stripe", () => {
  expect(TABS.some((tab) => tab.id === "vehicle_profit")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "vehicle_profit")).toBe(false);
    expect(railEntries(tier).some((tab) => tab.id === "vehicle_profit")).toBe(false);
  }
  const handler = readFileSync("src/lib/vehicle-profitability.functions.ts", "utf8");
  const off = handler.indexOf("if (!VEHICLE_PROFITABILITY_ENABLED) throw new Error(VEHICLE_PROFITABILITY_OFF)");
  const role = handler.indexOf("await requireManager(context.userId)");
  const directory = handler.indexOf("loadVehicleProfitDirectory(");
  expect(off).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(off);
  expect(directory).toBeGreaterThan(role);
  expect(handler).toContain(".inputValidator((data: unknown) => data)");
  expect(handler).not.toContain("stripe");
  expect(existsSync("src/lib/vehicle-profitability-read.server.ts")).toBe(false);
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const special = admin.indexOf('urlTab === "vehicle_profit"');
  expect(special).toBeGreaterThan(-1);
  expect(special).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('VEHICLE_PROFITABILITY_ENABLED && tab === "vehicle_profit"');
  expect(readFileSync("src/components/admin/VehicleProfitPanel.tsx", "utf8")).toContain("Download CSV");
  for (const file of [
    "src/lib/vehicle-profitability.ts",
    "src/lib/vehicle-profitability.server.ts",
    "src/lib/vehicle-profitability.functions.ts",
    "src/components/admin/VehicleProfitPanel.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(source, file).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
    expect(source, file).not.toContain("createStripeClient");
    expect(source, file).not.toContain("createReadOnlyStripe");
  }
});
