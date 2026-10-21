import type { VehiclePnlExpenseLine, VehiclePnlReport, VehiclePnlRow } from "./vehicle-pnl";

/**
 * CSV for one Vehicle Profit report. Amounts come from that report.
 * This file does not calculate revenue, expenses, tolls, or maintenance.
 * An unknown amount is a blank cell marked Unknown. A truncated read
 * starts the file with a TRUNCATED line.
 */

export const EXPENSE_EXPORT_TRUNCATED = "TRUNCATED";

export type ExpenseExportResponse =
  | { status: "disabled"; csv: null; truncated: false; month: null }
  | { status: "unavailable"; reason: string; csv: null; truncated: false; month: null }
  | { status: "ready"; csv: string; truncated: boolean; month: string };

type MoneyRow = {
  label: string;
  revenueCents: number | null;
  expenses: VehiclePnlExpenseLine[];
  expenseCents: number | null;
  tollsTicketsCents: number | null;
  maintenanceCents: number | null;
  netCents: number | null;
};

export function expenseExportCsv(report: VehiclePnlReport): string {
  const categories = categoryColumns(report);
  const header = [
    "Month",
    "Vehicle",
    "Verified Revenue",
    "Verified Revenue Status",
    ...categories.flatMap((category) => [category.label, `${category.label} Status`]),
    "Expense Total",
    "Expense Total Status",
    "Tolls And Tickets",
    "Tolls And Tickets Status",
    "Maintenance",
    "Maintenance Status",
    "Net",
    "Net Status",
  ];
  const lines: string[] = [];
  if (report.truncated) lines.push(EXPENSE_EXPORT_TRUNCATED);
  lines.push(header.map(escapeCsvCell).join(","));
  for (const row of report.rows) lines.push(line(report.month, row, categories));
  if (unattributedVisible(report)) {
    lines.push(line(report.month, unattributedRow(report), categories));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function line(month: string, row: MoneyRow, categories: { category: string; label: string }[]): string {
  const cells = [month, row.label, ...moneyCells(row.revenueCents)];
  for (const category of categories) cells.push(...categoryCells(row, category.category));
  cells.push(...moneyCells(row.expenseCents), ...moneyCells(row.tollsTicketsCents), ...moneyCells(row.maintenanceCents), ...moneyCells(row.netCents));
  return cells.map(escapeCsvCell).join(",");
}

function categoryCells(row: MoneyRow, category: string): [string, string] {
  const found = row.expenses.find((expense) => expense.category === category);
  if (found) return moneyCells(found.cents);
  if (row.expenseCents === null) return moneyCells(null);
  if (row.expenses.length === 0 && row.expenseCents !== 0) return moneyCells(null);
  return moneyCells(0);
}

function moneyCells(cents: number | null): [string, string] {
  if (cents === null || !Number.isSafeInteger(cents)) return ["", "Unknown"];
  return [dollars(cents), "Known"];
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function categoryColumns(report: VehiclePnlReport): { category: string; label: string }[] {
  const columns = new Map<string, string>();
  for (const row of report.rows) {
    for (const expense of row.expenses) columns.set(expense.category, expense.label);
  }
  return [...columns.entries()]
    .map(([category, label]) => ({ category, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
}

function unattributedVisible(report: VehiclePnlReport): boolean {
  const money = report.unattributed;
  return [money.revenueCents, money.expenseCents, money.tollsTicketsCents, money.maintenanceCents].some(
    (cents) => cents === null || cents !== 0,
  );
}

function unattributedRow(report: VehiclePnlReport): MoneyRow {
  const money = report.unattributed;
  return {
    label: "Unattributed",
    revenueCents: money.revenueCents,
    expenses: [],
    expenseCents: money.expenseCents,
    tollsTicketsCents: money.tollsTicketsCents,
    maintenanceCents: money.maintenanceCents,
    netCents: money.netCents,
  };
}

const NUMERIC_CELL = /^-?\d+\.\d{2}$/;
const FORMULA_CELL = /^[\s\u00a0]*[=+\-@\t\r|＝]/;

/** RFC 4180. Formula-like text is prefixed with an apostrophe. A money amount stays a number. */
export function escapeCsvCell(value: string): string {
  if (NUMERIC_CELL.test(value)) return value;
  const formula = FORMULA_CELL.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
