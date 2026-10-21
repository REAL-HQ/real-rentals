import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { monthWindow } from "../src/lib/owner-pnl";
import { EXPENSE_EXPORT_ENABLED } from "../src/lib/expense-export-flag";
import { EXPENSE_EXPORT_TRUNCATED, escapeCsvCell, expenseExportCsv } from "../src/lib/expense-export";
import { runExpenseExport } from "../src/lib/expense-export.server";
import { buildVehiclePnl, type VehiclePnlReport } from "../src/lib/vehicle-pnl";

const window = monthWindow("2026-10");
if (!window) throw new Error("October window");

function report(extra: Partial<VehiclePnlReport> = {}): VehiclePnlReport {
  return {
    month: "2026-10",
    from: "2026-10-01",
    through: "2026-10-31",
    rows: [
      {
        vehicleId: "veh-1",
        label: "2020 Honda Civic",
        revenueCents: 14200,
        expenses: [{ category: "insurance", label: "Insurance", cents: 1000 }],
        expenseCents: 1000,
        tollsTicketsCents: 250,
        maintenanceCents: 400,
        netCents: 12550,
      },
    ],
    unattributed: { revenueCents: 0, expenseCents: 0, tollsTicketsCents: 0, maintenanceCents: 0, netCents: 0 },
    truncated: false,
    notes: [],
    ...extra,
  };
}

describe("monthly finance csv", () => {
  it("writes the Vehicle Profit amounts and does not invent a second revenue figure", () => {
    const source = buildVehiclePnl({
      window,
      vehicles: [{ id: "veh-1", year: 2020, make: "Honda", model: "Civic", licensePlate: null }],
      rentals: [],
      payments: [
        {
          id: "p-cash",
          rentalId: null,
          vehicleId: "veh-1",
          status: "paid",
          type: "rent",
          netCollected: "45.00",
          paidDate: "2026-10-09",
          stripePaymentIntentId: null,
          stripeInvoiceId: null,
        },
      ],
      expenses: [],
      tolls: [],
      maintenance: [],
      stripe: { ok: true, truncated: false, charges: [], refunds: [] },
      caps: { vehicles: false, rentals: false, payments: false, expenses: false, tolls: false, maintenance: false },
    });
    const csv = expenseExportCsv(source);
    expect(csv).toContain("45.00,Known");
    expect(csv).not.toContain("TRUNCATED");
    const builder = readFileSync(new URL("../src/lib/expense-export.ts", import.meta.url), "utf8");
    expect(builder).not.toMatch(/net_collected|stripe_payment_intent|createReadOnlyStripe/);
    expect(readFileSync(new URL("../src/lib/expense-export.server.ts", import.meta.url), "utf8")).toContain("runVehiclePnl");
  });

  it("leaves an unknown amount blank and marks it Unknown", () => {
    const csv = expenseExportCsv(report({
      rows: [{
        vehicleId: "veh-1",
        label: "Civic",
        revenueCents: null,
        expenses: [{ category: "tires", label: "Tires", cents: null }],
        expenseCents: null,
        tollsTicketsCents: 0,
        maintenanceCents: 0,
        netCents: null,
      }],
    }));
    const data = csv.trim().split("\r\n")[1];
    expect(data).toContain(",,Unknown,");
    expect(data).toContain(",Unknown,");
    expect(data).not.toContain("0.00,Known,Unknown");
    expect(csv).not.toMatch(/,0\.00,Unknown/);
  });

  it("starts a truncated file with a TRUNCATED line", () => {
    const csv = expenseExportCsv(report({ truncated: true, rows: [{
      ...report().rows[0]!,
      revenueCents: null,
      netCents: null,
    }] }));
    expect(csv.startsWith(`${EXPENSE_EXPORT_TRUNCATED}\r\n`)).toBe(true);
  });

  it("escapes commas and quotes and neutralizes formula cells", () => {
    expect(escapeCsvCell(`=cmd|' /C calc'!A0`)).toBe(`"'=cmd|' /C calc'!A0"`);
    expect(escapeCsvCell("+1")).toBe(`"'+1"`);
    expect(escapeCsvCell("-10.00")).toBe("-10.00");
    expect(escapeCsvCell("-40.00")).toBe("-40.00");
    expect(escapeCsvCell("12.50")).toBe("12.50");
    expect(escapeCsvCell(" =1+1")).toBe(`"' =1+1"`);
    expect(escapeCsvCell("＝1+1")).toBe(`"'＝1+1"`);
    expect(escapeCsvCell("|cmd")).toBe(`"'|cmd"`);
    expect(escapeCsvCell("@sum")).toBe(`"'@sum"`);
    expect(escapeCsvCell(`Honda, "Civic"`)).toBe(`"Honda, ""Civic"""`);
    const csv = expenseExportCsv(report({
      rows: [{
        vehicleId: "veh-1",
        label: "=HYPERLINK(\"http://evil\")",
        revenueCents: 0,
        expenses: [],
        expenseCents: 0,
        tollsTicketsCents: 0,
        maintenanceCents: 0,
        netCents: -1000,
      }],
    }));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("-10.00,Known");
    expect(csv).not.toContain(`"'-10.00"`);
  });

  it("writes the report's Unattributed net instead of subtracting the columns again", () => {
    const csv = expenseExportCsv(report({
      unattributed: {
        revenueCents: 100,
        expenseCents: 0,
        tollsTicketsCents: 0,
        maintenanceCents: 0,
        netCents: 50,
      },
    }));
    const line = csv.trim().split("\r\n").find((row) => row.includes("Unattributed"));
    expect(line?.includes("1.00,Known")).toBe(true);
    expect(line?.endsWith("0.50,Known")).toBe(true);
    const builder = readFileSync(new URL("../src/lib/expense-export.ts", import.meta.url), "utf8");
    expect(builder).not.toContain("revenue - expense");
  });
});

describe("monthly finance export access", () => {
  it("stays off, is declared once, and returns before the role check and any read", async () => {
    expect(EXPENSE_EXPORT_ENABLED).toBe(false);
    const flag = readFileSync(new URL("../src/lib/expense-export-flag.ts", import.meta.url), "utf8");
    expect(flag).toMatch(/export const EXPENSE_EXPORT_ENABLED = false/);
    expect(flag.match(/EXPENSE_EXPORT_ENABLED\s*=/g)).toHaveLength(1);
    expect(flag).not.toMatch(/process\.env/);
    const handler = readFileSync(new URL("../src/lib/expense-export.functions.ts", import.meta.url), "utf8");
    const gate = handler.indexOf("if (!EXPENSE_EXPORT_ENABLED) return DISABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('await import("@/lib/roles.server")'));
    expect(gate).toBeLessThan(handler.indexOf('"./expense-export.server"'));
    expect(gate).toBeLessThan(handler.indexOf('"./vehicle-pnl.server"'));
    expect(gate).toBeLessThan(handler.indexOf('"./vehicle-pnl-stripe.server"'));
    const sources = [
      "src/lib/expense-export.ts",
      "src/lib/expense-export.server.ts",
      "src/lib/expense-export.functions.ts",
      "src/components/admin/VehiclePnlSection.tsx",
      "src/components/admin/ExpenseCategoriesPanel.tsx",
      "src/routes/admin.tsx",
      "src/components/admin/nav-config.ts",
    ];
    for (const path of sources) {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/export const EXPENSE_EXPORT_ENABLED/);
      expect(text).not.toMatch(/process\.env\.EXPENSE_EXPORT_ENABLED/);
    }
    const section = readFileSync(new URL("../src/components/admin/VehiclePnlSection.tsx", import.meta.url), "utf8");
    expect(section).toContain("EXPENSE_EXPORT_ENABLED &&");
    expect(section).toContain("Download Monthly Finance CSV");
    expect(section).toContain("This Export Is Truncated");
    expect(section).not.toMatch(/text-transform/);
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    expect(admin).not.toContain("EXPENSE_EXPORT_ENABLED");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(nav).not.toContain("EXPENSE_EXPORT_ENABLED");
    const load = vi.fn();
    await expect(runExpenseExport({
      enabled: false,
      userId: "owner-1",
      tier: "owner",
      month: "2026-10",
      load,
    })).resolves.toEqual({ status: "disabled", csv: null, truncated: false, month: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a coordinator before the read", async () => {
    const load = vi.fn();
    await expect(runExpenseExport({
      enabled: true,
      userId: "coord-1",
      tier: "coordinator",
      month: "2026-10",
      load,
    })).rejects.toThrow("Forbidden");
    expect(load).not.toHaveBeenCalled();
  });

  it("lets a manager export the Vehicle Profit report", async () => {
    const load = vi.fn(async () => ({
      vehicles: [{ id: "veh-1", year: 2020, make: "Honda", model: "Civic", licensePlate: null }],
      rentals: [],
      payments: [],
      expenses: [],
      tolls: [],
      maintenance: [],
      stripe: { ok: true as const, truncated: false, charges: [], refunds: [] },
      caps: { vehicles: false, rentals: false, payments: false, expenses: false, tolls: false, maintenance: false },
    }));
    const result = await runExpenseExport({
      enabled: true,
      userId: "manager-1",
      tier: "manager",
      month: "2026-10",
      load,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.truncated).toBe(false);
      expect(result.csv.startsWith("TRUNCATED")).toBe(false);
      expect(result.csv).toContain("0.00,Known");
      expect(result.month).toBe("2026-10");
    }
  });
});
