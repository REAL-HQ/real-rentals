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
 * Owner P&L income is verified Stripe charges plus recorded non-Stripe
 * payments. A shared PaymentIntent, charge id, invoice id, or metadata
 * paymentIds entry counts once. Amounts are never compared. Cash and Zelle
 * with no charge agree with the payment-ledger month. A Stripe charge with
 * no payment row is still only on Owner P&L, because that ledger does not
 * read Stripe. A Stripe-method row with no reference is excluded there and
 * would still be income on the ledger. Blank company share and a share that
 * disagrees with the linked expense now follow the same cost total.
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

function ownerPayment(id: string, type: string, paymentIntentId: string | null, extra: Partial<OwnerPaymentLink> = {}): OwnerPaymentLink {
  return { id, vehicleId: "v1", type, paymentIntentId, invoiceId: null, subscriptionId: null, ...extra };
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
      payments: [
        ownerPayment("pay-rent", "rent", "pi_v1", { status: "paid", paymentMethod: "stripe", amount: "350.00", paidDate: "2026-10-15" }),
        ownerPayment("pay-dep", "deposit", "pi_dep", { status: "paid", paymentMethod: "card", amount: "200.00", paidDate: "2026-10-03" }),
      ],
      rentals: [],
      expenses: sharedExpenses,
      maintenance: sharedMaintenance,
      refunds: [],
      vehicles: [{ id: "v1", year: 2020, make: "Ada", model: "One", licensePlate: "PL1" }],
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
    expect(owner?.current.coverage).toBe("complete");
    expect(owner?.current.unmatched).toEqual([]);
    expect(owner?.current.sources).toEqual(expect.arrayContaining([
      { source: "stripe", label: "Stripe", cents: 35000 },
      { source: "cash", label: "Cash", cents: 0 },
      { source: "zelle", label: "Zelle", cents: 0 },
    ]));
    expect(owner?.current.vehicles).toEqual([
      expect.objectContaining({ id: "v1", label: "2020 Ada One · PL1", incomeCents: 35000, expenseCents: 11050, refundsCents: 0, netCents: 23950 }),
    ]);

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

  it("counts cash and Zelle with no Stripe charge on both computations", () => {
    const payments = [
      ownerPayment("pay-cash", "rent", null, { status: "paid", paymentMethod: "cash", amount: "75.00", paidDate: "2026-10-08", vehicleId: "v-cash" }),
      ownerPayment("pay-zelle", "rent", null, { status: "paid", paymentMethod: "Zelle", amount: "40.00", paidDate: "2026-10-09", vehicleId: "v-zelle" }),
    ];
    const owner = buildOwnerPnlMonth({
      payments,
      rentals: [],
      expenses: [],
      maintenance: [],
      refunds: [],
      vehicles: [
        { id: "v-cash", year: null, make: "Cash", model: null, licensePlate: null },
        { id: "v-zelle", year: null, make: "Zelle", model: null, licensePlate: null },
      ],
      month: MONTH,
      charges: [],
    });
    const ledger = buildMonthlyPl({
      month: MONTH,
      vehicles: [
        { id: "v-cash", year: null, make: "Cash", model: null, licensePlate: null },
        { id: "v-zelle", year: null, make: "Zelle", model: null, licensePlate: null },
      ],
      rentals: [],
      payments: [
        { ...ledgerPayment("pay-cash", "rent", "75.00", "2026-10-08"), vehicleId: "v-cash", rentalId: null },
        { ...ledgerPayment("pay-zelle", "rent", "40.00", "2026-10-09"), vehicleId: "v-zelle", rentalId: null },
      ],
      expenses: [],
      maintenance: [],
    });
    expect(owner?.revenueCents).toBe(11500);
    expect(owner?.netCents).toBe(11500);
    expect(owner?.coverage).toBe("complete");
    expect(owner?.sources).toEqual(expect.arrayContaining([
      { source: "cash", label: "Cash", cents: 7500 },
      { source: "zelle", label: "Zelle", cents: 4000 },
      { source: "stripe", label: "Stripe", cents: 0 },
    ]));
    expect(owner?.vehicles).toEqual([
      expect.objectContaining({ id: "v-cash", label: "Cash", incomeCents: 7500, netCents: 7500 }),
      expect.objectContaining({ id: "v-zelle", label: "Zelle", incomeCents: 4000, netCents: 4000 }),
    ]);
    expect(ledger.ok && ledger.report.netCents).toBe(owner?.netCents);
    expect(ledger.ok && ledger.report.income.find((line) => line.label === "Rent")?.cents).toBe(11500);
  });

  it("counts a Stripe charge with no payment row only on Owner P&L", () => {
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
    expect(owner?.sources.find((row) => row.source === "stripe")?.cents).toBe(8000);
    expect(owner?.vehicles).toEqual([expect.objectContaining({ id: "v1", incomeCents: 8000, netCents: 8000 })]);
    expect(ledger.ok && ledger.report.netCents).toBe(0);
    expect(ledger.ok && ledger.report.income.every((line) => line.cents === 0)).toBe(true);
  });

  it("excludes a Stripe-method row with no reference and does not match a different payment on amount", () => {
    const owner = buildOwnerPnlMonth({
      payments: [
        ownerPayment("pay-card", "rent", null, { status: "paid", paymentMethod: "card", amount: "90.00", paidDate: "2026-10-12" }),
        ownerPayment("pay-cash", "rent", null, { status: "paid", paymentMethod: "cash", amount: "350.00", paidDate: "2026-10-12" }),
      ],
      rentals: [{ id: "r1", vehicleId: "v1", customerId: "cus_1", subscriptionId: null }],
      expenses: [],
      maintenance: [],
      refunds: [],
      month: MONTH,
      charges: [charge("ch", "pi_other", 35000, "cus_1")],
    });
    expect(owner?.revenueCents).toBe(70000);
    expect(owner?.coverage).toBe("partial");
    expect(owner?.unmatched).toEqual([{ id: "pay-card", method: "card", reason: "No Payment Intent, charge, invoice, or payment reference." }]);
    expect(owner?.sources.find((row) => row.source === "stripe")?.cents).toBe(35000);
    expect(owner?.sources.find((row) => row.source === "cash")?.cents).toBe(35000);
  });

  it("puts Cash App, Venmo, wire, and other methods on their own source lines", () => {
    const methods = [
      ["pay-app", "Cash App", "cash_app", "10.00"],
      ["pay-venmo", "Venmo", "venmo", "11.00"],
      ["pay-wire", "wire", "wire", "12.00"],
      ["pay-other", "PayPal", "other", "13.00"],
    ] as const;
    const owner = buildOwnerPnlMonth({
      payments: methods.map(([id, paymentMethod, , amount]) => ownerPayment(id, "rent", null, { status: "paid", paymentMethod, amount, paidDate: "2026-10-11" })),
      rentals: [],
      expenses: [],
      maintenance: [],
      refunds: [],
      month: MONTH,
      charges: [],
    });
    expect(owner?.revenueCents).toBe(4600);
    for (const [, , source, amount] of methods) {
      expect(owner?.sources.find((row) => row.source === source)?.cents).toBe(Math.round(Number(amount) * 100));
    }
  });

  it("keeps the Stripe charge when metadata paymentIds names a recorded row with a different amount", () => {
    const owner = buildOwnerPnlMonth({
      payments: [ownerPayment("pay-z", "rent", null, { status: "paid", paymentMethod: "zelle", amount: "999.00", paidDate: "2026-10-15" })],
      rentals: [],
      expenses: [],
      maintenance: [],
      refunds: [],
      month: MONTH,
      charges: [{ ...charge("ch", "pi_v1", 35000), paymentIds: ["pay-z"] }],
    });
    expect(owner?.revenueCents).toBe(35000);
    expect(owner?.sources.find((row) => row.source === "zelle")?.cents).toBe(0);
    expect(owner?.coverage).toBe("complete");
    expect(owner?.unmatched).toEqual([]);
  });

  it("uses total cost when company share is blank, and agrees with the ledger", () => {
    const maintenance: OwnerMaintenanceRow[] = [
      { id: "m-blank", vehicleId: "v1", category: "repair", companyShare: null, totalCost: "40.00", performedOn: "2026-10-10", completedAt: null, createdAt: null },
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
    expect(owner?.expensesComplete).toBe(true);
    expect(owner?.expenseCents).toBe(4000);
    expect(owner?.netCents).toBe(-4000);
    expect(owner?.notes.some((note) => note.includes("Total cost was used"))).toBe(true);
    expect(ledger.ok && ledger.report.maintenanceCents).toBe(4000);
    expect(ledger.ok && ledger.report.netCents).toBe(owner?.netCents);
  });

  it("counts the linked expense once when company share disagrees, and says so", () => {
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
    expect(owner?.expensesComplete).toBe(true);
    expect(owner?.expenseCents).toBe(5000);
    expect(owner?.netCents).toBe(-5000);
    expect(owner?.notes.some((note) => note.includes("does not match the linked expense"))).toBe(true);
    expect(ledger.ok && ledger.report.expenseCents).toBe(5000);
    expect(ledger.ok && ledger.report.maintenanceCents).toBe(0);
    expect(ledger.ok && ledger.report.netCents).toBe(owner?.netCents);
  });

  it("keeps one owner screen, the existing flag, print, and the page cap", () => {
    expect(OWNER_PNL_ENABLED).toBe(false);
    expect(OWNER_DIRECTORY_PAGE).toBe(1000);
    expect(OWNER_DIRECTORY_MAX_PAGES).toBe(100);
    const server = readFileSync(new URL("../src/lib/owner-pnl.server.ts", import.meta.url), "utf8");
    expect(server).toContain('reason: "P&L records were incomplete"');
    expect(server).toContain("total_cost");
    const ownerMath = readFileSync(new URL("../src/lib/owner-pnl.ts", import.meta.url), "utf8");
    expect(ownerMath).toContain("totalCost");
    expect(ownerMath).not.toMatch(/from ["'][^"']*payment-reporting/);
    expect(ownerMath).toContain("metadata paymentIds");
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
