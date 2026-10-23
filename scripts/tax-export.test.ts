import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { FEE_UNAVAILABLE, buildTaxExport, currentTaxYear, taxFileToCsv, taxYear, type TaxPayment } from "../src/lib/tax-export";
import { TAX_EXPORT_ENABLED, TAX_EXPORT_OFF } from "../src/lib/tax-export-flag";
import { runTaxExport } from "../src/lib/tax-export.server";

const YEAR = taxYear(2026)!;

function payment(patch: Partial<TaxPayment> & Pick<TaxPayment, "id">): TaxPayment {
  return {
    driverId: "app-1", rentalId: "rent-1", status: "paid", type: "rent",
    amount: 10, netCollected: 10, refundedAmount: 0, paidDate: "2026-06-15", refundedAt: null, ...patch,
  };
}

function file(id: string) {
  const report = built();
  const found = report.files.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
}

function built() {
  return buildTaxExport({
    year: YEAR,
    drivers: [{ id: "app-1", name: 'Ada, "Bee"', deleted: false }],
    vehicles: [{ id: "veh-1", year: 2022, make: "Toyota", model: "Camry", licensePlate: "ABC123" }],
    rentals: [{ id: "rent-open", depositHeld: true }, { id: "rent-1", depositHeld: true }],
    payments: [
      payment({ id: "pay-main", amount: 100, netCollected: 75, refundedAmount: 25, paidDate: "2026-06-15", refundedAt: "2026-06-20" }),
      payment({ id: "pay-open", amount: 10, netCollected: 10, paidDate: "2026-01-01T05:00:00.000Z" }),
      payment({ id: "pay-close", amount: 20, netCollected: 20, paidDate: "2027-01-01T04:30:00.000Z" }),
      payment({ id: "pay-year-end", amount: 5, netCollected: 5, paidDate: "2026-12-31" }),
      payment({ id: "pay-before", amount: 30, netCollected: 30, paidDate: "2026-01-01T04:30:00.000Z" }),
      payment({ id: "pay-after", amount: 40, netCollected: 40, paidDate: "2027-01-01" }),
      payment({ id: "pay-after-instant", amount: 40, netCollected: 40, paidDate: "2027-01-01T05:00:00.000Z" }),
      payment({ id: "pay-deposit", type: "deposit", amount: 200, netCollected: 200, refundedAmount: 0, paidDate: "2026-03-01" }),
      payment({ id: "pay-held", type: "deposit", amount: 80, netCollected: 0, refundedAmount: 80, paidDate: "2026-04-01", refundedAt: "2027-02-01" }),
      payment({ id: "pay-returned", type: "deposit", rentalId: "rent-1", amount: 50, netCollected: 0, refundedAmount: 50, paidDate: "2026-05-01", refundedAt: "2026-07-01" }),
    ],
    refunds: [
      { id: "ref-main", amount: 25, status: "succeeded", createdAt: "2026-06-20T15:00:00.000Z", paymentIds: ["pay-main"] },
      { id: "ref-open", amount: 1, status: null, createdAt: "2026-01-01T05:00:00.000Z", paymentIds: [] },
      { id: "ref-before", amount: 9, status: "succeeded", createdAt: "2026-01-01T04:30:00.000Z", paymentIds: [] },
      { id: "ref-deposit", amount: 50, status: "succeeded", createdAt: "2026-07-01T16:00:00.000Z", paymentIds: ["pay-returned"] },
    ],
    expenses: [{ id: "exp-1", vehicleId: "veh-1", category: "repair", amount: "12.50", incurredOn: "2026-08-01" }],
    maintenance: [{ id: "svc-1", vehicleId: "veh-1", companyShare: 40, performedOn: "2026-08-02", completedAt: null, createdAt: null }],
  });
}

it("keeps Eastern Time year boundaries, nets refunds, and leaves deposits out of rental income", () => {
  expect(currentTaxYear(new Date("2026-01-01T04:30:00.000Z"))).toBe(2025);
  expect(currentTaxYear(new Date("2026-01-01T05:00:00.000Z"))).toBe(2026);
  const income = file("income");
  expect(income.rows.map((row) => row[0])).toEqual(["pay-main", "pay-open", "pay-close", "pay-year-end"]);
  expect(income.rows.find((row) => row[0] === "pay-open")?.[2]).toBe("2026-01-01");
  expect(income.rows.find((row) => row[0] === "pay-close")?.[2]).toBe("2026-12-31");
  expect(income.rows.find((row) => row[0] === "pay-main")?.[4]).toBe("$75.00");
  expect(income.total).toEqual(["Total", "", "", "", "$110.00"]);
  expect(income.rows.some((row) => row[0].startsWith("pay-deposit") || row[0] === "pay-before" || row[0] === "pay-after")).toBe(false);
  const csv = taxFileToCsv(income);
  expect(csv).toContain('"Ada, ""Bee"""');
  expect(csv.endsWith("Total,,,,$110.00\r\n")).toBe(true);

  const refunds = file("refunds");
  expect(refunds.rows.map((row) => [row[0], row[3]])).toEqual([
    ["ref-main", "$25.00"],
    ["ref-open", "$1.00"],
    ["ref-deposit", "$50.00"],
  ]);
  expect(refunds.rows.find((row) => row[0] === "ref-deposit")?.[2]).toBe("Yes");
  expect(refunds.total[3]).toBe("$76.00");

  const deposits = file("deposits");
  expect(deposits.rows.map((row) => [row[0], row[4]])).toEqual([
    ["pay-deposit", "$200.00"],
    ["pay-held", "$80.00"],
    ["pay-returned", "$0.00"],
  ]);
  expect(deposits.total[4]).toBe("$280.00");
});

it("marks processing fees Unavailable and does not invent cents", () => {
  const fees = file("fees");
  expect(fees.rows.length).toBe(4);
  expect(fees.rows.every((row) => row[3] === FEE_UNAVAILABLE)).toBe(true);
  expect(fees.total).toEqual(["Total", "", "$110.00", FEE_UNAVAILABLE]);
  expect(FEE_UNAVAILABLE).toBe("Unavailable");
  const report = built();
  expect(report.gaps.some((gap) => gap.includes("does not call Stripe"))).toBe(true);
  expect(file("expenses").total[3]).toBe("$12.50");
  expect(file("expenses").rows.some((row) => row[2] === "Total Repair")).toBe(true);
  expect(file("maintenance").total[2]).toBe("$40.00");
  expect(report.gaps.some((gap) => gap.includes("rent-open"))).toBe(false);
  expect(report.gaps.some((gap) => gap.startsWith("1 rentals say a deposit is held"))).toBe(true);
});

it("throws while the flag is off, before any read, and refuses a manager", async () => {
  expect(TAX_EXPORT_ENABLED).toBe(false);
  const load = vi.fn();
  await expect(runTaxExport({
    enabled: false, userId: "owner-1", tier: "owner", now: new Date("2026-10-21T15:00:00.000Z"), year: 2026, load,
  })).rejects.toThrow(TAX_EXPORT_OFF);
  await expect(runTaxExport({
    enabled: true, userId: "mgr-1", tier: "manager", now: new Date("2026-10-21T15:00:00.000Z"), year: 2026, load,
  })).rejects.toThrow("Forbidden");
  await expect(runTaxExport({
    enabled: true, userId: "coord-1", tier: "coordinator", now: new Date("2026-10-21T15:00:00.000Z"), year: 2026, load,
  })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
  await expect(runTaxExport({
    enabled: true, userId: "owner-1", tier: "owner", now: new Date("2026-10-21T15:00:00.000Z"), year: 1999, load,
  })).rejects.toThrow("The tax year is not valid");
  expect(load).not.toHaveBeenCalled();
  const empty = {
    payments: [], refunds: [], expenses: [], maintenance: [], vehicles: [], drivers: [], rentals: [],
  };
  const owner = await runTaxExport({
    enabled: true, userId: "owner-1", tier: "owner", now: new Date("2026-01-01T04:30:00.000Z"), year: null,
    load: async () => ({ ok: true, directory: empty }),
  });
  expect(owner.report?.year).toBe(2025);
  expect(owner.report?.files.find((entry) => entry.id === "fees")?.total[3]).toBe(FEE_UNAVAILABLE);
  expect(owner.report?.files.find((entry) => entry.id === "income")?.total[4]).toBe("$0.00");
});

it("stays out of the tab list and checks the owner after the flag", () => {
  expect(TABS.some((tab) => tab.id === "tax_export")).toBe(false);
  for (const tier of ["owner", "manager", "coordinator"] as const) {
    expect(visibleTabs(tier).some((tab) => tab.id === "tax_export")).toBe(false);
    expect(railEntries(tier).some((tab) => tab.id === "tax_export")).toBe(false);
  }
  const handler = readFileSync("src/lib/tax-export.functions.ts", "utf8");
  const off = handler.indexOf("if (!TAX_EXPORT_ENABLED) throw new Error(TAX_EXPORT_OFF)");
  const role = handler.indexOf("await requireOwner(context.userId)");
  const directory = handler.indexOf("loadTaxExportDirectory(");
  expect(off).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(off);
  expect(directory).toBeGreaterThan(role);
  expect(handler).not.toContain("requireManager");
  expect(handler).toContain(".inputValidator((data: unknown) => data)");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const special = admin.indexOf('urlTab === "tax_export"');
  expect(special).toBeGreaterThan(-1);
  expect(special).toBeLessThan(admin.indexOf("TABS.some"));
  expect(admin).toContain('TAX_EXPORT_ENABLED && tab === "tax_export"');
  expect(readFileSync("src/components/admin/TaxExportPanel.tsx", "utf8")).toContain("Download CSV");
  for (const path of [
    "src/lib/tax-export.ts",
    "src/lib/tax-export.server.ts",
    "src/lib/tax-export.functions.ts",
    "src/components/admin/TaxExportPanel.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    expect(source, path).not.toContain("createStripeClient");
    expect(source, path).not.toContain("createReadOnlyStripe");
    expect(source, path).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(source, path).not.toMatch(/\.(or|filter)\(\s*`[^`]*\$\{/);
  }
});
