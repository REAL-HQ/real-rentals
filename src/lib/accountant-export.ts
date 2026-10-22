import type { OwnerFeeRead } from "./owner-pnl-fees";
import {
  buildOwnerPnlMonth,
  categoryLabel,
  currentEtMonth,
  monthWindow,
  type OwnerCharge,
  type OwnerPnlDirectory,
} from "./owner-pnl";
import { decimalSourceCents } from "./unified-finance-live-mapping";

/**
 * Year-to-date owner export. Each month is buildOwnerPnlMonth, so attributed
 * revenue, unattributed charges, deposit handling, refunds, category expenses,
 * fees, and net match Monthly Owner P&L. Fee totals come from the caller.
 * This module does not call Stripe or the database.
 * A receipt is a yes or no. The path is never copied onto the report.
 */

export type ExpenseDetailSource = {
  incurredOn: string | null;
  vehicleId: string | null;
  category: string | null;
  vendorId: string | null;
  description: string | null;
  amount: string | number | null;
  receiptOnFile: boolean;
};

export type AccountantMoney = {
  revenueCents: number | null;
  unattributedCents: number | null;
  refundsCents: number | null;
  depositsCollectedCents: number | null;
  depositsRefundedCents: number | null;
  expenseCents: number | null;
  feesCents: number | null;
  feesComplete: boolean;
  expenses: { category: string; label: string; cents: number }[];
  netCents: number | null;
};

export type AccountantMonthRow = AccountantMoney & { month: string };

export type AccountantExpenseDetail = {
  date: string;
  vehicle: string;
  category: string;
  vendor: string;
  description: string;
  amountCents: number;
  receiptOnFile: boolean;
};

export type AccountantYearReport = {
  year: string;
  from: string;
  through: string;
  months: AccountantMonthRow[];
  ytd: AccountantMoney;
  details: AccountantExpenseDetail[];
  warnings: string[];
};

const MONEY_KEYS = [
  "revenueCents",
  "unattributedCents",
  "refundsCents",
  "depositsCollectedCents",
  "depositsRefundedCents",
  "expenseCents",
  "feesCents",
  "netCents",
] as const;

export function currentEtYear(now: Date): string | null {
  const month = currentEtMonth(now);
  return month ? month.slice(0, 4) : null;
}

/** January through December, or through the current Eastern Time month when the year is this year. */
export function monthsInYear(year: string, now: Date): string[] | null {
  if (!/^\d{4}$/.test(year)) return null;
  const current = currentEtMonth(now);
  if (!current) return null;
  const currentYear = current.slice(0, 4);
  if (year > currentYear) return null;
  const last = year < currentYear ? 12 : Number(current.slice(5, 7));
  if (!Number.isInteger(last) || last < 1 || last > 12) return null;
  return Array.from({ length: last }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function sumKey(months: AccountantMonthRow[], key: (typeof MONEY_KEYS)[number]): number | null {
  if (months.some((month) => month[key] === null)) return null;
  const total = months.reduce((acc, month) => acc + (month[key] as number), 0);
  return Number.isSafeInteger(total) ? total : null;
}

function netOf(revenue: number | null, refunds: number | null, expenses: number | null, fees: number | null): number | null {
  if (revenue === null || refunds === null || expenses === null || fees === null) return null;
  const net = revenue - refunds - expenses - fees;
  return Number.isSafeInteger(net) ? net : null;
}

function yearCategories(months: AccountantMonthRow[]): AccountantMoney["expenses"] {
  if (months.some((month) => month.expenseCents === null)) return [];
  const labels = new Map<string, string>();
  for (const month of months) for (const row of month.expenses) labels.set(row.category, row.label);
  return [...labels.entries()]
    .map(([category, label]) => {
      const cents = months.reduce((acc, month) => acc + (month.expenses.find((row) => row.category === category)?.cents ?? 0), 0);
      return { category, label, cents };
    })
    .filter((row) => Number.isSafeInteger(row.cents))
    .sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
}

export function buildAccountantYear(input: {
  year: string;
  now: Date;
  directory: OwnerPnlDirectory;
  charges: OwnerCharge[];
  detailRows: ExpenseDetailSource[];
  vehicles: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  blankRevenue?: boolean;
  blankExpenses?: boolean;
  blankRefunds?: boolean;
  omitDetails?: boolean;
  warnings?: string[];
  /** Omitted means each month has a complete fee cost of zero. */
  feesByMonth?: Record<string, OwnerFeeRead>;
}): AccountantYearReport | null {
  const months = monthsInYear(input.year, input.now);
  if (!months?.length) return null;
  const first = monthWindow(months[0]!);
  const last = monthWindow(months[months.length - 1]!);
  if (!first || !last) return null;
  const warnings = [...(input.warnings ?? [])];
  let revenueIncomplete = false;
  let expensesIncomplete = false;
  let refundsIncomplete = false;
  const rows: AccountantMonthRow[] = [];
  for (const month of months) {
    const feeRead = input.feesByMonth ? input.feesByMonth[month] ?? { ok: false as const } : undefined;
    const built = buildOwnerPnlMonth({ ...input.directory, month, charges: input.charges, fees: feeRead });
    if (!built) return null;
    if (!built.revenueComplete) revenueIncomplete = true;
    if (!built.expensesComplete) expensesIncomplete = true;
    if (!built.refundsComplete) refundsIncomplete = true;
    const revenueCents = input.blankRevenue || !built.revenueComplete ? null : built.revenueCents;
    const unattributedCents = input.blankRevenue || !built.revenueComplete ? null : built.unattributedRevenueCents;
    const depositsCollectedCents = input.blankRevenue || !built.revenueComplete ? null : built.depositsExcludedCents;
    const refundsCents = input.blankRefunds || !built.refundsComplete ? null : built.refundsCents;
    const depositsRefundedCents = input.blankRefunds || !built.refundsComplete ? null : built.depositRefundsExcludedCents;
    const expenseCents = input.blankExpenses || !built.expensesComplete ? null : built.expenseCents;
    const expenses = input.blankExpenses || !built.expensesComplete ? [] : built.expenses;
    const feesCents = built.feesComplete ? built.feesCents : null;
    rows.push({
      month,
      revenueCents,
      unattributedCents,
      refundsCents,
      depositsCollectedCents,
      depositsRefundedCents,
      expenseCents,
      feesCents,
      feesComplete: built.feesComplete,
      expenses,
      netCents: netOf(revenueCents, refundsCents, expenseCents, feesCents),
    });
  }
  if (!input.blankRevenue && revenueIncomplete) warnings.push("Revenue Is Incomplete. Amounts that depend on it are blank.");
  if (!input.blankExpenses && expensesIncomplete) warnings.push("Expenses Are Incomplete. Amounts that depend on them are blank.");
  if (!input.blankRefunds && refundsIncomplete) warnings.push("Refunds Are Incomplete. Amounts that depend on them are blank.");
  if (rows.some((month) => !month.feesComplete && month.revenueCents !== null && month.refundsCents !== null && month.expenseCents !== null)) {
    warnings.push("Stripe fees are Unavailable, so the net is Partial.");
  }
  const expenseCents = sumKey(rows, "expenseCents");
  const feesCents = sumKey(rows, "feesCents");
  const ytd: AccountantMoney = {
    revenueCents: sumKey(rows, "revenueCents"),
    unattributedCents: sumKey(rows, "unattributedCents"),
    refundsCents: sumKey(rows, "refundsCents"),
    depositsCollectedCents: sumKey(rows, "depositsCollectedCents"),
    depositsRefundedCents: sumKey(rows, "depositsRefundedCents"),
    expenseCents,
    feesCents,
    feesComplete: rows.every((month) => month.feesComplete),
    expenses: expenseCents === null ? [] : yearCategories(rows),
    netCents: sumKey(rows, "netCents"),
  };
  return {
    year: input.year,
    from: first.from,
    through: last.through,
    months: rows,
    ytd,
    details: input.omitDetails ? [] : detailLines(input, first.from, last.to, warnings),
    warnings,
  };
}

function detailLines(
  input: { detailRows: ExpenseDetailSource[]; vehicles: { id: string; label: string }[]; vendors: { id: string; name: string }[] },
  from: string,
  to: string,
  warnings: string[],
): AccountantExpenseDetail[] {
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.label]));
  const vendors = new Map(input.vendors.map((vendor) => [vendor.id, vendor.name]));
  const lines: AccountantExpenseDetail[] = [];
  let dropped = 0;
  for (const row of input.detailRows) {
    const date = row.incurredOn ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date >= to) continue;
    const amountCents = decimalSourceCents(row.amount);
    if (amountCents === null) { dropped += 1; continue; }
    lines.push({
      date,
      vehicle: (row.vehicleId && vehicles.get(row.vehicleId)) || "Vehicle Not Listed",
      category: categoryLabel(row.category),
      vendor: (row.vendorId && vendors.get(row.vendorId)) || "",
      description: (row.description ?? "").trim(),
      amountCents,
      receiptOnFile: row.receiptOnFile === true,
    });
  }
  if (dropped > 0) warnings.push("Some Expense Rows Were Left Out Of The Detail Because The Amount Could Not Be Read.");
  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.vehicle.localeCompare(b.vehicle) || a.category.localeCompare(b.category) || a.description.localeCompare(b.description));
}

function feeCsv(row: AccountantMoney): string {
  return row.feesComplete ? centsText(row.feesCents) : "Unavailable";
}

function netCsv(row: AccountantMoney): string {
  if (!row.feesComplete && row.revenueCents !== null && row.refundsCents !== null && row.expenseCents !== null) return "Partial";
  return centsText(row.netCents);
}

function centsText(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function csvField(value: string): string {
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !numeric && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvLine(cells: string[]): string {
  return cells.map((cell) => csvField(cell)).join(",");
}

/** Browser download of the month table, including category columns and the year total. */
export function accountantMonthlyCsv(report: AccountantYearReport): string {
  const categories = report.ytd.expenses.length
    ? report.ytd.expenses
    : (() => {
      const labels = new Map<string, string>();
      for (const month of report.months) for (const row of month.expenses) labels.set(row.category, row.label);
      return [...labels.entries()].map(([category, label]) => ({ category, label, cents: 0 }));
    })();
  const header = [
    "Month", "Attributed Revenue", "Unattributed Charges", "Refunds", "Deposits Collected", "Deposits Refunded",
    ...categories.map((row) => row.label), "Expenses", "Fees", "Net",
  ];
  const line = (label: string, row: AccountantMoney) => [
    label,
    centsText(row.revenueCents),
    centsText(row.unattributedCents),
    centsText(row.refundsCents),
    centsText(row.depositsCollectedCents),
    centsText(row.depositsRefundedCents),
    ...categories.map((category) => centsText(row.expenseCents === null ? null : row.expenses.find((item) => item.category === category.category)?.cents ?? 0)),
    centsText(row.expenseCents),
    feeCsv(row),
    netCsv(row),
  ];
  const lines = [
    ["Year", report.year],
    ["From", report.from],
    ["Through", report.through],
    [],
    header,
    ...report.months.map((month) => line(month.month, month)),
    line("Year To Date", report.ytd),
    ...report.warnings.map((warning) => ["Warning", warning]),
  ];
  return lines.map((row) => csvLine(row)).join("\n");
}

/** Browser download of one row per vehicle expense. Receipt is Yes or No. */
export function accountantDetailCsv(report: AccountantYearReport): string {
  const lines = [
    ["Year", report.year],
    ["Date", "Vehicle", "Category", "Vendor", "Description", "Amount", "Receipt On File"],
    ...report.details.map((row) => [
      row.date,
      row.vehicle,
      row.category,
      row.vendor,
      row.description,
      centsText(row.amountCents),
      row.receiptOnFile ? "Yes" : "No",
    ]),
    ...report.warnings.map((warning) => ["Warning", warning]),
  ];
  return lines.map((row) => csvLine(row)).join("\n");
}
