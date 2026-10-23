import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildVehicleExpenseLine, type ExpenseMovement, type ServiceMovement } from "../src/lib/vehicle-expenses";
import { VEHICLE_EXPENSES_ENABLED } from "../src/lib/vehicle-expenses-flag";
import { EXPENSE_SOURCES } from "../src/lib/vehicle-expenses-sources";
import { EXPENSE_RECORDS_INCOMPLETE, loadVehicleExpenseRecords, runVehicleExpenses } from "../src/lib/vehicle-expenses.server";
import { TABS } from "../src/components/admin/nav-config";

const vehicle = { id: "v1", year: 2020, make: "Toyota", model: "Camry", licensePlate: "ABC123", unitNumber: "12" };
const service = (extra: Partial<ServiceMovement> = {}): ServiceMovement => ({
  id: "s1", vehicleId: "v1", category: "maintenance", companyShare: 100, totalCost: 100,
  performedOn: "2026-10-02", completedAt: null, createdAt: "2026-10-02T15:00:00Z", vendorName: "Shop", ...extra,
});
const linked = (extra: Partial<ExpenseMovement> = {}): ExpenseMovement => ({
  id: "e1", vehicleId: "v1", category: "maintenance", amount: 100, incurredOn: "2026-10-02",
  maintenanceRecordId: "s1", vendorName: "Shop", receiptPath: "receipts/e1.pdf", ...extra,
});

describe("vehicle expense line", () => {
  it("counts a linked service once and does not add total cost again", () => {
    const report = buildVehicleExpenseLine({
      expenses: [
        linked(),
        { id: "e2", vehicleId: "v1", category: "insurance", amount: "25.00", incurredOn: "2026-10-03", maintenanceRecordId: null, vendorName: "Carrier", receiptPath: null },
        { id: "e3", vehicleId: "v1", category: "repair", amount: 10, incurredOn: "2026-10-04", maintenanceRecordId: null, vendorName: "Garage", receiptPath: null },
        { id: "e4", vehicleId: "v1", category: "registration", amount: 5, incurredOn: "2026-10-05", maintenanceRecordId: null, vendorName: "DMV", receiptPath: null },
        { id: "e5", vehicleId: "v1", category: "tolls", amount: 2, incurredOn: "2026-10-06", maintenanceRecordId: null, vendorName: "Tollway", receiptPath: null },
        { id: "e6", vehicleId: "v1", category: "cleaning", amount: 3, incurredOn: "2026-10-07", maintenanceRecordId: null, vendorName: "Detail", receiptPath: null },
      ],
      services: [service()],
      vehicles: [vehicle],
    });
    expect(report.expenseCents).toBe(14500);
    expect(report.buckets).toEqual({ maintenance: 10000, insurance: 2500, registration: 500, tolls: 200, cleaning: 300, other: 1000 });
    expect(report.expenseCents).not.toBe(10000 + 10000);
    expect(report.vehicles[0].label).toBe("Unit 12 · 2020 Toyota Camry · ABC123");
    expect(report.vehicles[0].entries.find((entry) => entry.id === "e1")?.receiptOnFile).toBe(true);
    expect(report.notes).toEqual([]);
  });

  it("keeps the linked expense when company share disagrees with total cost", () => {
    const report = buildVehicleExpenseLine({
      expenses: [linked()],
      services: [service({ companyShare: 40, totalCost: 100 })],
      vehicles: [vehicle],
    });
    expect(report.expenseCents).toBe(10000);
    expect(report.notes[0]).toContain("Company share $40.00 does not match the linked expense $100.00");
    expect(report.notes[0]).toContain("The linked expense is counted once.");
  });

  it("uses total cost only when the share is blank and no expense is linked", () => {
    const blank = buildVehicleExpenseLine({
      expenses: [],
      services: [service({ companyShare: null, totalCost: 80, category: "routine" })],
      vehicles: [vehicle],
    });
    expect(blank.expenseCents).toBe(8000);
    expect(blank.buckets.other).toBe(8000);
    expect(blank.notes[0]).toContain("Total cost was used.");
    const zeroShare = buildVehicleExpenseLine({
      expenses: [],
      services: [service({ companyShare: 0, totalCost: 80 })],
      vehicles: [vehicle],
    });
    expect(zeroShare.expenseCents).toBe(0);
    expect(zeroShare.notes).toEqual([]);
  });
});

describe("vehicle expense access", () => {
  it("stays dark and does not load", async () => {
    expect(VEHICLE_EXPENSES_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/vehicle-expenses-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const VEHICLE_EXPENSES_ENABLED = false/);
    expect(flag).not.toMatch(/process\.env/);
    const load = vi.fn();
    const result = await runVehicleExpenses({ enabled: false, userId: "owner", tier: "owner", load });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a coordinator before the load and withholds a broken scan", async () => {
    const load = vi.fn(async () => ({ ok: false as const }));
    await expect(runVehicleExpenses({ enabled: true, userId: "c", tier: "coordinator", load })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
    const unavailable = await runVehicleExpenses({ enabled: true, userId: "m", tier: "manager", load });
    expect(unavailable).toEqual({ status: "unavailable", report: null, reason: EXPENSE_RECORDS_INCOMPLETE });
  });

  it("checks the flag before the role and does not write", () => {
    const source = readFileSync(new URL("../src/lib/vehicle-expenses.functions.ts", import.meta.url), "utf8");
    const flagAt = source.indexOf("if (!VEHICLE_EXPENSES_ENABLED) return");
    const roleAt = source.indexOf("requireManager");
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(roleAt);
    expect(source).toContain("Expense entry is proposed and not applied");
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|from\("vehicle_expenses"\)|from\("receipts"\)/);
    for (const file of ["vehicle-expenses.ts", "vehicle-expenses.server.ts", "vehicle-expenses.functions.ts"]) {
      const body = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
      expect(body).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(body).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
      expect(body).not.toContain("vehicle_expense_entries");
    }
  });
});

describe("expense directory", () => {
  function stable<T extends { id: string }>(rows: T[]) {
    return async (cursor: string | null) => ({
      data: rows.filter((row) => cursor === null || row.id > cursor).slice(0, 1000),
      error: null as { message: string } | null,
    });
  }

  it("joins the vendor and still counts the linked expense once", async () => {
    const loaded = await loadVehicleExpenseRecords({
      expenses: stable([{ id: "e1", vehicle_id: "v1", category: "maintenance", amount: 100, incurred_on: "2026-10-02", maintenance_record_id: "s1", vendor_id: "ven", receipt_path: "a.pdf" }]),
      services: stable([{ id: "s1", vehicle_id: "v1", category: "maintenance", company_share: 100, total_cost: 100, performed_on: "2026-10-02", completed_at: null, created_at: "2026-10-02T15:00:00Z", vendor_id: "ven", vendor_name_raw: "Raw" }]),
      vehicles: stable([{ id: "v1", year: 2020, make: "Toyota", model: "Camry", license_plate: "ABC123", unit_number: "12" }]),
      vendors: stable([{ id: "ven", name: "Shop" }]),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const report = buildVehicleExpenseLine(loaded.records);
    expect(report.expenseCents).toBe(10000);
    expect(report.vehicles[0].entries[0].vendor).toBe("Shop");
  });
});

describe("expense sources and the dark screen", () => {
  it("cites the live expense data", () => {
    expect(EXPENSE_SOURCES.length).toBeGreaterThan(20);
    for (const source of EXPENSE_SOURCES) {
      const line = readFileSync(new URL(`../${source.file}`, import.meta.url), "utf8").split("\n")[source.line - 1];
      expect(line, `${source.file}:${source.line}`).toContain(source.needle);
    }
  });

  it("keeps the new table in proposed and the tab off the rail", () => {
    const proposal = readFileSync(new URL("../proposed/vehicle-expense-entries-v1.sql", import.meta.url), "utf8");
    expect(proposal).toContain("Not a migration");
    expect(proposal).toContain("private.is_manager()");
    expect(proposal).toContain("'maintenance', 'insurance', 'registration', 'tolls', 'cleaning', 'other'");
    expect(proposal).not.toMatch(/partner_owns_vehicle/);
    expect(readFileSync(new URL("../supabase/migrations/20260925161000_vehicle_expenses.sql", import.meta.url), "utf8")).not.toContain("vehicle_expense_entries");
    expect(TABS.map((tab) => tab.id)).not.toContain("vehicle_expenses");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    const tabsBlock = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
    expect(tabsBlock).not.toContain("vehicle_expenses");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    const special = admin.indexOf('urlTab === "vehicle_expenses"');
    const known = admin.indexOf("!TABS.some((t) => t.id === urlTab)");
    expect(special).toBeGreaterThan(-1);
    expect(special).toBeLessThan(known);
    expect(admin).toContain('VEHICLE_EXPENSES_ENABLED && tab === "vehicle_expenses"');
    const panel = readFileSync(new URL("../src/components/admin/VehicleExpensesPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("Enter An Expense");
    expect(panel).toContain("Receipt");
    expect(panel).toContain("Owner P&L expense line");
    expect(panel).not.toMatch(/text-transform|uppercase|capitalize/);
    expect(panel).not.toMatch(/from\("receipts"\)|createExpense|from\("vehicle_expenses"\)/);
    const live = readFileSync(new URL("../src/lib/expenses.functions.ts", import.meta.url), "utf8");
    expect(live).toContain('.from("vehicle_expenses")');
    expect(live).toContain(".insert({");
  });
});
