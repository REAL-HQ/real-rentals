import { etYmd } from "./weekly-cash-flow";

/**
 * Owner tax packet for one Eastern Time calendar year.
 * Rental income is paid or refunded net collected, and deposits are excluded.
 * Processing fees are not stored, so they stay Unavailable. This module does not call Stripe or write.
 */

export const FEE_UNAVAILABLE = "Unavailable";
export const DIRECTORY_INCOMPLETE = "Tax records were incomplete";
export const REVENUE_TYPES = ["rent", "late_fee", "other", "toll", "damage", "fee"] as const;
export const TAX_GAPS = [
  "Stripe processing fees are not stored on payments or payment_refunds. This export does not call Stripe, so every fee is Unavailable.",
  "Rental income uses the payment's current net collected. A refund recorded later has already reduced that net. The refunds file lists those refunds and is not subtracted again.",
  "rental.deposit_held is the current flag, not a balance on a past December 31. Held deposits are reconstructed from deposit payments and refunded_at.",
  "A refund amount with no refunded_at cannot be placed, so that deposit is Unavailable.",
  "Maintenance company share and a linked vehicle expense are separate files. Adding those two totals counts that service twice.",
  "Depreciation is not a vehicle column. Acquisition, lender, and payoff are owner finance and are not read.",
] as const;

const PAID = new Set(["paid", "refunded"]);
const REVENUE = new Set<string>(REVENUE_TYPES);
const REFUND_SKIP = new Set(["failed", "canceled", "cancelled", "void", "voided"]);

export type TaxYear = { year: number; from: string; through: string };
export type TaxVehicle = { id: string; year: number | null; make: string | null; model: string | null; licensePlate: string | null };
export type TaxDriver = { id: string; name: string; deleted: boolean };
export type TaxPayment = {
  id: string;
  driverId: string | null;
  rentalId: string | null;
  status: string;
  type: string;
  amount: unknown;
  netCollected: unknown;
  refundedAmount: unknown;
  paidDate: string | null;
  refundedAt: string | null;
};
export type TaxRefund = {
  id: string;
  amount: unknown;
  status: string | null;
  createdAt: string | null;
  paymentIds: string[];
};
export type TaxExpense = { id: string; vehicleId: string | null; category: string | null; amount: unknown; incurredOn: string | null };
export type TaxMaintenance = {
  id: string;
  vehicleId: string | null;
  companyShare: unknown;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type TaxRental = { id: string; depositHeld: boolean };
export type TaxFile = { id: string; filename: string; title: string; headers: string[]; rows: string[][]; total: string[] };
export type TaxExportReport = { year: number; from: string; through: string; files: TaxFile[]; gaps: string[] };

export function taxYear(year: number): TaxYear | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return { year, from: `${year}-01-01`, through: `${year}-12-31` };
}

export function currentTaxYear(now: Date): number | null {
  const day = etYmd(now);
  const year = day ? Number(day.slice(0, 4)) : Number.NaN;
  return taxYear(year)?.year ?? null;
}

export function buildTaxExport(input: {
  year: TaxYear;
  payments: TaxPayment[];
  refunds: TaxRefund[];
  expenses: TaxExpense[];
  maintenance: TaxMaintenance[];
  vehicles: TaxVehicle[];
  drivers: TaxDriver[];
  rentals: TaxRental[];
}): TaxExportReport {
  const { from, through, year } = input.year;
  const drivers = new Map(input.drivers.filter((driver) => driver.id && !driver.deleted).map((driver) => [driver.id, driver.name]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicleLabel(vehicle)]));
  const payments = new Map(input.payments.map((payment) => [payment.id, payment]));
  const incomeRows: string[][] = [];
  const feeRows: string[][] = [];
  const depositRows: string[][] = [];
  let income = 0;
  let incomeReady = true;
  let held = 0;
  let heldReady = true;
  const gaps: string[] = [...TAX_GAPS];
  const heldRentals = new Set(input.rentals.filter((rental) => rental.depositHeld).map((rental) => rental.id));
  const depositRentals = new Set<string>();

  for (const payment of input.payments) {
    const paid = placed(payment.paidDate);
    const status = payment.status.trim().toLowerCase();
    const type = payment.type.trim().toLowerCase();
    if (!PAID.has(status)) continue;
    if (type === "deposit") {
      if (payment.rentalId) depositRentals.add(payment.rentalId);
      const heldCents = heldAtYearEnd(payment, through);
      if (heldCents === "skip") continue;
      if (heldCents === "undated" || !paid) {
        gaps.push(`Deposit payment ${payment.id} has no paid date and was omitted.`);
        continue;
      }
      depositRows.push([payment.id, drivers.get(payment.driverId ?? "") ?? "", paid, placed(payment.refundedAt) ?? "", heldCents === null ? FEE_UNAVAILABLE : formatCents(heldCents)]);
      if (heldCents === null) heldReady = false;
      else if (!Number.isSafeInteger(held + heldCents)) heldReady = false;
      else held += heldCents;
      continue;
    }
    if (!REVENUE.has(type) || !paid || paid < from || paid > through) {
      if (REVENUE.has(type) && !paid) gaps.push(`Payment ${payment.id} has no paid date and was omitted.`);
      continue;
    }
    const cents = collectedCents(payment);
    incomeRows.push([payment.id, drivers.get(payment.driverId ?? "") ?? "", paid, statusLabel(type), cents === null ? FEE_UNAVAILABLE : formatCents(cents)]);
    feeRows.push([payment.id, paid, cents === null ? FEE_UNAVAILABLE : formatCents(cents), FEE_UNAVAILABLE]);
    if (cents === null) incomeReady = false;
    else if (!Number.isSafeInteger(income + cents)) incomeReady = false;
    else income += cents;
  }

  const covered = new Set<string>();
  const refundRows: string[][] = [];
  let refunded = 0;
  let refundsReady = true;
  for (const refund of input.refunds) {
    if (REFUND_SKIP.has((refund.status ?? "").trim().toLowerCase())) continue;
    const day = placed(refund.createdAt);
    if (!day || day < from || day > through) continue;
    for (const id of refund.paymentIds) covered.add(id);
    const cents = dollarsToCents(refund.amount);
    const kinds = refund.paymentIds.map((id) => payments.get(id)?.type.trim().toLowerCase() ?? "");
    const deposit = kinds.length === 0 ? "Unknown" : kinds.every((kind) => kind === "deposit") ? "Yes" : kinds.some((kind) => kind === "deposit") ? "Mixed" : "No";
    refundRows.push([refund.id, day, deposit, cents === null ? FEE_UNAVAILABLE : formatCents(cents)]);
    if (cents === null) refundsReady = false;
    else if (!Number.isSafeInteger(refunded + cents)) refundsReady = false;
    else refunded += cents;
  }
  for (const payment of input.payments) {
    if (covered.has(payment.id)) continue;
    const refundedCents = dollarsToCents(payment.refundedAmount);
    if (refundedCents === null || refundedCents === 0) continue;
    const day = placed(payment.refundedAt);
    if (!day || day < from || day > through) continue;
    refundRows.push([payment.id, day, payment.type.trim().toLowerCase() === "deposit" ? "Yes" : "No", formatCents(refundedCents)]);
    if (!Number.isSafeInteger(refunded + refundedCents)) refundsReady = false;
    else refunded += refundedCents;
  }

  const expenseRows: string[][] = [];
  const byCategory = new Map<string, number>();
  let expensesReady = true;
  let expenseTotal = 0;
  for (const expense of input.expenses) {
    const day = placed(expense.incurredOn);
    if (!day || day < from || day > through) continue;
    const cents = dollarsToCents(expense.amount);
    const category = categoryLabel(expense.category);
    expenseRows.push([day, expense.vehicleId ? vehicles.get(expense.vehicleId) ?? expense.vehicleId : "", category, cents === null ? FEE_UNAVAILABLE : formatCents(cents)]);
    if (cents === null) expensesReady = false;
    else {
      const next = (byCategory.get(category) ?? 0) + cents;
      if (!Number.isSafeInteger(next) || !Number.isSafeInteger(expenseTotal + cents)) expensesReady = false;
      else {
        byCategory.set(category, next);
        expenseTotal += cents;
      }
    }
  }
  const categoryRows = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, cents]) => ["", "", `Total ${category}`, formatCents(cents)]);

  const maintenanceRows: string[][] = [];
  let maintenanceTotal = 0;
  let maintenanceReady = true;
  for (const record of input.maintenance) {
    const day = placed(record.performedOn) ?? placed(record.completedAt) ?? placed(record.createdAt);
    if (!day || day < from || day > through) continue;
    const cents = dollarsToCents(record.companyShare);
    maintenanceRows.push([day, record.vehicleId ? vehicles.get(record.vehicleId) ?? record.vehicleId : "", cents === null ? FEE_UNAVAILABLE : formatCents(cents)]);
    if (cents === null) maintenanceReady = false;
    else if (!Number.isSafeInteger(maintenanceTotal + cents)) maintenanceReady = false;
    else maintenanceTotal += cents;
  }

  const unlinkedHeld = [...heldRentals].filter((id) => !depositRentals.has(id));
  if (unlinkedHeld.length) gaps.push(`${unlinkedHeld.length} rentals say a deposit is held and have no deposit payment. Those amounts are not in the total.`);

  const money = (ready: boolean, cents: number) => ready ? formatCents(cents) : FEE_UNAVAILABLE;
  const files: TaxFile[] = [
    file("income", "tax-rental-income.csv", "Rental Income", ["Payment", "Driver", "Paid", "Type", "Net Collected"], incomeRows, ["Total", "", "", "", money(incomeReady, income)]),
    file("deposits", "tax-deposits-held.csv", "Deposits Held At Year End", ["Payment", "Driver", "Paid", "Refunded On", "Held"], depositRows, ["Total", "", "", "", money(heldReady, held)]),
    file("refunds", "tax-refunds.csv", "Refunds", ["Refund", "Date", "Deposit", "Amount"], refundRows, ["Total", "", "", money(refundsReady, refunded)]),
    file("fees", "tax-processing-fees.csv", "Processing Fees", ["Payment", "Paid", "Income", "Fee"], feeRows, ["Total", "", money(incomeReady, income), FEE_UNAVAILABLE]),
    file("expenses", "tax-vehicle-expenses.csv", "Vehicle Expenses", ["Date", "Vehicle", "Category", "Amount"], [...expenseRows, ...categoryRows], ["Total", "", "", money(expensesReady, expenseTotal)]),
    file("maintenance", "tax-maintenance.csv", "Maintenance", ["Date", "Vehicle", "Company Share"], maintenanceRows, ["Total", "", money(maintenanceReady, maintenanceTotal)]),
  ];
  return { year, from, through, files, gaps };
}

export function taxFileToCsv(taxFile: TaxFile): string {
  const lines = [[taxFile.title], taxFile.headers, ...taxFile.rows, taxFile.total];
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function file(id: string, filename: string, title: string, headers: string[], rows: string[][], total: string[]): TaxFile {
  return { id, filename, title, headers, rows, total };
}

function collectedCents(payment: TaxPayment): number | null {
  if (payment.netCollected != null && payment.netCollected !== "") return dollarsToCents(payment.netCollected);
  const amount = dollarsToCents(payment.amount);
  const refunded = payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : dollarsToCents(payment.refundedAmount);
  if (amount === null || refunded === null || refunded > amount) return null;
  return amount - refunded;
}

function heldAtYearEnd(payment: TaxPayment, through: string): number | "skip" | "undated" | null {
  const paid = placed(payment.paidDate);
  if (!paid) return "undated";
  if (paid > through) return "skip";
  const original = dollarsToCents(payment.amount);
  const refunded = payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : dollarsToCents(payment.refundedAmount);
  if (original === null || refunded === null || refunded > original) return null;
  if (refunded === 0) return original;
  const refundedOn = placed(payment.refundedAt);
  if (!refundedOn) return null;
  return refundedOn <= through ? original - refunded : original;
}

function placed(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (!match) return null;
  if (trimmed.length === 10) return match[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : etYmd(parsed);
}

function categoryLabel(category: string | null): string {
  if (!category?.trim()) return "Uncategorized";
  return statusLabel(category);
}

function statusLabel(status: string): string {
  return status.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function vehicleLabel(vehicle: TaxVehicle): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  const plate = vehicle.licensePlate?.trim();
  return [name, plate].filter(Boolean).join(" · ") || vehicle.id;
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
