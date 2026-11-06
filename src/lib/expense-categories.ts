import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";

/**
 * Read-only vehicle expenses grouped by category for one Eastern Time period.
 * Each vehicle_expenses row is counted once. Maintenance company share is
 * not read and is not added. A date outside the window is skipped before the
 * amount is checked. A date that cannot be placed, an unreadable amount, or
 * a repeated id withholds the totals.
 */

export const EXPENSE_ONCE_NOTE =
  "Each vehicle expense is counted once. Maintenance company share is not read.";

const WITHHELD_NOTE =
  "An expense could not be placed in the period, its amount could not be read, or it was repeated, so the category totals were withheld.";

export type ExpensePeriod = "this_month" | "last_month" | "last_90";

export const EXPENSE_PERIODS: readonly { id: ExpensePeriod; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_90", label: "90 Days" },
];

const CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration",
  insurance: "Insurance",
  maintenance: "Maintenance",
  repair: "Repair",
  tires: "Tires",
  fuel: "Fuel",
  cleaning: "Cleaning",
  towing: "Towing",
  parking: "Parking",
  tolls: "Tolls",
  finance: "Finance",
  purchase: "Purchase",
  gps: "GPS",
  other: "Other",
  uncategorized: "Uncategorized",
};

export type ExpenseCategoryRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
};

export type ExpenseCategoryLine = {
  category: string;
  label: string;
  count: number;
  cents: number;
};

export type ExpenseCategoriesResponse =
  | { status: "disabled"; summary: null }
  | { status: "unavailable"; reason: string; summary: null }
  | { status: "ready"; summary: ExpenseCategorySummary };

export type ExpenseCategorySummary = {
  period: ExpensePeriod;
  from: string;
  to: string;
  through: string;
  lines: ExpenseCategoryLine[];
  count: number | null;
  totalCents: number | null;
  notes: string[];
  coverage: "complete" | "unavailable";
  complete: boolean;
};

export function categoryLabel(category: string | null | undefined): string {
  const key = (category ?? "").trim().toLowerCase();
  if (!key) return "Uncategorized";
  const known = CATEGORY_LABELS[key];
  if (known) return known;
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function addDays(ymd: string, days: number): string | null {
  if (!validFinanceDate(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  const text = next.toISOString().slice(0, 10);
  return validFinanceDate(text) ? text : null;
}

export function periodWindow(
  period: ExpensePeriod,
  now: Date,
): { from: string; to: string; through: string } | null {
  const today = etYmd(now);
  if (!today) return null;
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth =
    month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
  const previousMonth =
    month === 1 ? `${year! - 1}-12-01` : `${year}-${String(month! - 1).padStart(2, "0")}-01`;
  const from =
    period === "this_month"
      ? monthStart
      : period === "last_month"
        ? previousMonth
        : addDays(today, -89);
  const to =
    period === "this_month" ? nextMonth : period === "last_month" ? monthStart : addDays(today, 1);
  if (!from || !to || !validFinanceDate(from) || !validFinanceDate(to) || from >= to) return null;
  const through = addDays(to, -1);
  return through ? { from, to, through } : null;
}

export function buildExpenseCategorySummary(input: {
  expenses: ExpenseCategoryRow[];
  period: ExpensePeriod;
  now: Date;
}): ExpenseCategorySummary | null {
  const window = periodWindow(input.period, input.now);
  if (!window) return null;
  const seen = new Set<string>();
  const buckets = new Map<string, { count: number; cents: number }>();
  let complete = true;
  for (const row of input.expenses) {
    const id = row.id?.trim() ?? "";
    if (!id || seen.has(id)) {
      complete = false;
      continue;
    }
    seen.add(id);
    const date = row.incurredOn && validFinanceDate(row.incurredOn) ? row.incurredOn : null;
    if (!date) {
      complete = false;
      continue;
    }
    if (date < window.from || date >= window.to) continue;
    const cents = decimalSourceCents(row.amount);
    if (cents === null) {
      complete = false;
      continue;
    }
    const key = (row.category ?? "").trim().toLowerCase() || "uncategorized";
    const bucket = buckets.get(key) ?? { count: 0, cents: 0 };
    const next = bucket.cents + cents;
    const nextCount = bucket.count + 1;
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(nextCount)) complete = false;
    else buckets.set(key, { count: nextCount, cents: next });
  }
  const lines = [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      label: categoryLabel(category),
      count: bucket.count,
      cents: bucket.cents,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
  const count = lines.reduce((sum, line) => sum + line.count, 0);
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  const totalsSafe = Number.isSafeInteger(count) && Number.isSafeInteger(total);
  if (!totalsSafe) complete = false;
  const notes = [EXPENSE_ONCE_NOTE];
  if (!complete) notes.push(WITHHELD_NOTE);
  return {
    period: input.period,
    from: window.from,
    to: window.to,
    through: window.through,
    lines: complete ? lines : [],
    count: complete ? count : null,
    totalCents: complete ? total : null,
    notes,
    coverage: complete ? "complete" : "unavailable",
    complete,
  };
}

export function expenseCategoriesToCsv(summary: ExpenseCategorySummary): string {
  const cell = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = ["Category,Count,Amount Cents"];
  for (const row of summary.lines) {
    lines.push(`${cell(row.label)},${row.count},${row.cents}`);
  }
  lines.push(`Total,${summary.count ?? ""},${summary.totalCents ?? ""}`);
  return `${lines.join("\n")}\n`;
}
