import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMonthlyPl, type PlExpense, type PlMaintenance, type PlPayment } from "../src/lib/finance-monthly-pl";
import { OWNER_PNL_ENABLED } from "../src/lib/owner-pnl-flag";
import { OWNER_DIRECTORY_MAX_PAGES, OWNER_DIRECTORY_PAGE } from "../src/lib/owner-pnl.server";
import {
  buildOwnerPnl,
  buildOwnerPnlMonth,
  monthWindow,
  type OwnerCharge,
  type OwnerExpenseRow,
  type OwnerMaintenanceRow,
  type OwnerPaymentLink,
} from "../src/lib/owner-pnl";

/**
 * Monthly Owner P&L and the payment-ledger month (finance-monthly-pl.ts, the
 * computation from #160) are not one superset. Deposit exclusion, counting a
 * linked service once, and withholding a capped directory read were already
 * on Owner P&L. Print is the layout added to that screen.
 *
 * Company totals agree when a succeeded USD charge equals the payment's
 * collected amount, refunds are zero on both sides, and company_share equals
 * the linked in-month expense. They must differ when income exists on only
 * one side, or when company_share is blank or disagrees with that expense.
 * Owner P&L has no per-vehicle breakdown.
 */

const MONTH = "2026-10";
const october = monthWindow(MONTH)!;

function charge(id: string, paymentIntentId: string | null, amountCents: number, customerId: string | null = null): OwnerCharge {
  return {
    id,
    paymentIntentId,
    amountCents,
    created: october.gte + 10,
    currency: "usd",
    succeeded: true,
    customerId,
    invoiceId: null,
    subscriptionId: null,
  };
}

function ownerPayment(id: string, type: string, paymentIntentId: string | null): OwnerPaymentLink {
  return { id, vehicleId: "v1", type, paymentIntentId, invoiceId: null, subscriptionId: null };
}

function ledgerPayment(id: string, type: string, dollars: string, paidDate = "2026-10-15"): PlPayment {
  return {
    id,
    rentalId: "r1",
    vehicleId: "v1",
    status: "paid",
    type,
    amount: dollars,
    netCollected: dollars,
    refundedAmount: "0",
    paidDate,
  };
}

const sharedExpenses: OwnerExpenseRow[] = [
  { id: "e-ins", vehicleId: "v1", category: "insurance", amount: "10.00", incurredOn: "2026-10-02", maintenanceRecordId: null },
  { id: "e-rep", vehicleId: "v1", category: "repair", amount: "100.50", incurredOn: "2026-10-15", maintenanceRecordId: "m1" },
];

const sharedMaintenance: OwnerMaintenanceRow[] = [
  { id: "m1", vehicleId: "v1", category: "repair", companyShare: "100.50", performedOn: "2026-10-15", completedAt: null, createdAt: null },
];

function ledgerExpenses(rows: OwnerExpenseRow[]): PlExpense[] {
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    amount: row.amount,
    category: row.category,
    incurredOn: row.incurredOn,
    maintenanceRecordId: row.maintenanceRecordId,
  }));
}

function ledgerMaintenance(rows: OwnerMaintenanceRow[], totalCost: unknown): PlMaintenance[] {
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    category: row.category,
    companyShare: row.companyShare,
    totalCost,
    performedOn: row.performedOn,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  }));
}

describe("owner p&l and the payment-ledger month", () => {
  it("agrees when the charge, the collected payment, and the linked service are the same dollars", () => {
    const owner = buildOwnerPnl({
      payments: [ownerPayment("pay-rent", "rent", "pi_v1"), ownerPayment("pay-dep", "deposit", "pi_dep")],
      rentals: [],
      expenses: sharedExpenses,
      maintenance: sharedMaintenance,
      refunds: [],
      month: MONTH,
      currentCharges: [charge("ch-rent", "pi_v1", 35000), charge("ch-dep", "pi_dep", 20000)],
      previousCharges: [],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [{ id: "v1", year: 2020, make: "Ada", model: "One", licensePlate: "PL1" }],
      rentals: [{ id: "r1", vehicleId: "v1" }],
      payments: [ledgerPayment("pay-rent", "rent", "350.00"), ledgerPayment("pay-dep", "deposit", "200.00", "2026-10-03")],
      expenses: ledgerExpenses(sharedExpenses),
      maintenance: ledgerMaintenance(sharedMaintenance, "100.50"),
    });

    expect(owner?.current).toMatchObject({
      revenueCents: 35000,
      depositsExcludedCents: 20000,
      refundsCents: 0,
      expenseCents: 11050,
      netCents: 23950,
      expensesComplete: true,
    });
    expect(owner?.current.expenses).toEqual([
      { category: "insurance", label: "Insurance Premium", cents: 1000 },
      { category: "repair", label: "Repair", cents: 10050 },
    ]);
    expect(owner?.current).not.toHaveProperty("vehicles");

    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    const income = ledger.report.income.reduce((sum, line) => sum + line.cents, 0);
    expect(income).toBe(35000);
    expect(ledger.report.income).toEqual([
      { label: "Rent", cents: 35000 },
      { label: "Late Fees", cents: 0 },
      { label: "Other", cents: 0 },
    ]);
    expect(ledger.report).toMatchObject({
      refundCents: 0,
      depositsExcludedCents: 20000,
      expenseCents: 11050,
      maintenanceCents: 0,
      netCents: 23950,
      fees: "unavailable",
    });
    expect(ledger.report.netCents).toBe(owner?.current.netCents);
    expect(ledger.report.expenseCents + ledger.report.maintenanceCents).toBe(owner?.current.expenseCents);
    expect(ledger.report.vehicles).toEqual([
      expect.objectContaining({ id: "v1", label: "2020 Ada One · PL1", netCents: 23950 }),
    ]);
  });

  it("counts a cash payment with no Stripe charge only on the payment ledger", () => {
    const owner = buildOwnerPnlMonth({
      payments: [ownerPayment("pay-cash", "rent", null)],
      rentals: [],
      expenses: [],
      maintenance: [],
      refunds: [],
      month: MONTH,
      charges: [],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [{ id: "v1", year: null, make: "Cash", model: null, licensePlate: null }],
      rentals: [{ id: "r1", vehicleId: "v1" }],
      payments: [ledgerPayment("pay-cash", "rent", "75.00", "2026-10-08")],
      expenses: [],
      maintenance: [],
    });
    expect(owner?.revenueCents).toBe(0);
    expect(owner?.netCents).toBe(0);
    expect(ledger.ok && ledger.report.income.find((line) => line.label === "Rent")?.cents).toBe(7500);
    expect(ledger.ok && ledger.report.netCents).toBe(7500);
  });

  it("counts a Stripe charge with no payment only on Owner P&L", () => {
    const owner = buildOwnerPnlMonth({
      payments: [],
      rentals: [{ id: "r1", vehicleId: "v1", customerId: "cus_1", subscriptionId: null }],
      expenses: [],
      maintenance: [],
      refunds: [],
      month: MONTH,
      charges: [charge("ch-only", null, 8000, "cus_1")],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [{ id: "v1", year: null, make: "Ada", model: null, licensePlate: null }],
      rentals: [{ id: "r1", vehicleId: "v1" }],
      payments: [],
      expenses: [],
      maintenance: [],
    });
    expect(owner?.revenueCents).toBe(8000);
    expect(owner?.netCents).toBe(8000);
    expect(ledger.ok && ledger.report.netCents).toBe(0);
    expect(ledger.ok && ledger.report.income.every((line) => line.cents === 0)).toBe(true);
  });

  it("blanks Owner expenses when company share is blank, and the ledger uses total cost", () => {
    const maintenance: OwnerMaintenanceRow[] = [
      { id: "m-blank", vehicleId: "v1", category: "repair", companyShare: null, performedOn: "2026-10-10", completedAt: null, createdAt: null },
    ];
    const owner = buildOwnerPnlMonth({
      payments: [],
      rentals: [],
      expenses: [],
      maintenance,
      refunds: [],
      month: MONTH,
      charges: [],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [{ id: "v1", year: null, make: "Ada", model: null, licensePlate: null }],
      rentals: [],
      payments: [],
      expenses: [],
      maintenance: ledgerMaintenance(maintenance, "40.00"),
    });
    expect(owner?.expensesComplete).toBe(false);
    expect(owner?.expenseCents).toBeNull();
    expect(owner?.netCents).toBeNull();
    expect(ledger.ok && ledger.report.maintenanceCents).toBe(4000);
    expect(ledger.ok && ledger.report.expenseCents).toBe(0);
    expect(ledger.ok && ledger.report.netCents).toBe(-4000);
  });

  it("blanks Owner expenses when company share disagrees with the linked expense", () => {
    const expenses: OwnerExpenseRow[] = [
      { id: "e-gap", vehicleId: "v1", category: "repair", amount: "50.00", incurredOn: "2026-10-15", maintenanceRecordId: "m-gap" },
    ];
    const maintenance: OwnerMaintenanceRow[] = [
      { id: "m-gap", vehicleId: "v1", category: "repair", companyShare: "80.00", performedOn: "2026-10-15", completedAt: null, createdAt: null },
    ];
    const owner = buildOwnerPnlMonth({
      payments: [],
      rentals: [],
      expenses,
      maintenance,
      refunds: [],
      month: MONTH,
      charges: [],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [{ id: "v1", year: null, make: "Ada", model: null, licensePlate: null }],
      rentals: [],
      payments: [],
      expenses: ledgerExpenses(expenses),
      maintenance: ledgerMaintenance(maintenance, "80.00"),
    });
    expect(owner?.expensesComplete).toBe(false);
    expect(owner?.expenseCents).toBeNull();
    expect(ledger.ok && ledger.report.expenseCents).toBe(5000);
    expect(ledger.ok && ledger.report.maintenanceCents).toBe(0);
    expect(ledger.ok && ledger.report.netCents).toBe(-5000);
  });

  it("keeps one owner screen, the existing flag, print, and the page cap", () => {
    expect(OWNER_PNL_ENABLED).toBe(false);
    expect(OWNER_DIRECTORY_PAGE).toBe(1000);
    expect(OWNER_DIRECTORY_MAX_PAGES).toBe(100);
    const server = readFileSync(new URL("../src/lib/owner-pnl.server.ts", import.meta.url), "utf8");
    expect(server).toContain('reason: "P&L records were incomplete"');
    expect(server).not.toContain("total_cost");
    const ownerMath = readFileSync(new URL("../src/lib/owner-pnl.ts", import.meta.url), "utf8");
    expect(ownerMath).not.toContain("total_cost");
    expect(ownerMath).not.toContain("totalCost");
    const panel = readFileSync(new URL("../src/components/admin/OwnerPnlPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("window.print()");
    expect(panel).toContain("print:hidden");
    expect(panel).toMatch(/>\s*Print\s*</);
    expect(panel).not.toMatch(/text-transform/i);
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    expect(admin).not.toContain("finance_monthly_pl");
    expect(admin).not.toContain("FinanceMonthlyPlPanel");
    expect(nav).not.toContain("finance_monthly_pl");
    const ledger = readFileSync(new URL("../src/lib/finance-monthly-pl.ts", import.meta.url), "utf8");
    expect(ledger).not.toContain("FINANCE_MONTHLY_PL_ENABLED");
    expect(ledger).toContain("not a screen");
  });
});
