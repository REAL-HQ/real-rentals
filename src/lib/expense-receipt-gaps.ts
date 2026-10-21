/**
 * Expenses with no receipt on the expense row.
 * public.documents has no expense link, so the attachment is vehicle_expenses.receipt_path.
 * A blank path is missing. A recorded path is on file. Months are Eastern Time.
 */

export const EXPENSE_RECEIPT_GAP_LIMIT = 1000;

export const EXPENSE_RECEIPT_GAP_CAP =
  "Missing receipt rows passed the page cap. The count is withheld.";

export const MISSING_RECEIPTS_UNREAD = "Missing receipts could not be read.";

/**
 * Same missing paths as receiptOnFile: null, empty, or whitespace only.
 * PostgREST `match` is POSIX `[[:space:]]`, which covers the spaces trim() removes.
 * The handler still drops any row receiptOnFile would keep.
 */
export const MISSING_RECEIPT_PATH_OR =
  'receipt_path.is.null,receipt_path.eq.,receipt_path.match."^[[:space:]]+$"';

const EASTERN = "America/New_York";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type GapPeriod = "this_month" | "last_3" | "last_12" | "all";

export type ReceiptGapInput = {
  category: string | null;
  incurredOn: string | null;
  receiptPath: string | null;
};

export type ReceiptGapCount = {
  month: string;
  category: string;
  count: number;
};

export function receiptOnFile(path: string | null | undefined): boolean {
  return typeof path === "string" && path.trim() !== "";
}

export function easternYmd(now: Date): string | null {
  if (Number.isNaN(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function easternMonth(now: Date): string | null {
  const day = easternYmd(now);
  return day ? day.slice(0, 7) : null;
}

/** Inclusive start and exclusive end, as calendar dates. All Time has neither bound. */
export function easternGapWindow(
  period: GapPeriod,
  now: Date,
): { from: string | null; to: string | null } | null {
  if (period === "all") return { from: null, to: null };
  const today = easternYmd(now);
  if (!today) return null;
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) return null;
  const monthsBack = period === "this_month" ? 0 : period === "last_3" ? 2 : 11;
  const start = monthStart(year * 12 + (month - 1) - monthsBack);
  const end = monthStart(year * 12 + month);
  if (!start || !end) return null;
  return { from: start, to: end };
}

/**
 * Inclusive dates for listExpenses, which uses lte on `to`.
 * The gap query keeps easternGapWindow's exclusive end.
 * All Time has neither bound. A bad clock returns null.
 */
export function easternLedgerRange(
  period: GapPeriod,
  now: Date,
): { from: string | null; to: string | null } | null {
  const window = easternGapWindow(period, now);
  if (!window) return null;
  if (window.to == null) return { from: null, to: null };
  const through = previousDate(window.to);
  if (!through) return null;
  return { from: window.from, to: through };
}

function previousDate(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() - 1);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthLabel(month: string): string {
  if (month === "unknown") return "Unknown";
  const [year, monthText] = month.split("-");
  const name = MONTHS[Number(monthText) - 1];
  return name && year ? `${name} ${year}` : month;
}

export function formatExpenseAmount(value: unknown): string {
  if (value == null || value === "") return "Not Recorded";
  if (typeof value === "number" && !Number.isFinite(value)) return "Not Recorded";
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "Not Recorded";
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return "Not Recorded";
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

export function summarizeReceiptGaps(
  rows: ReceiptGapInput[],
  limit = EXPENSE_RECEIPT_GAP_LIMIT,
): { capped: true } | { capped: false; total: number; counts: ReceiptGapCount[] } {
  if (rows.length > limit) return { capped: true };
  const grouped = new Map<string, ReceiptGapCount>();
  let total = 0;
  for (const row of rows) {
    if (receiptOnFile(row.receiptPath)) continue;
    const month = monthOf(row.incurredOn);
    const category = row.category?.trim() || "unknown";
    const key = `${month}\0${category}`;
    const current = grouped.get(key) ?? { month, category, count: 0 };
    current.count += 1;
    grouped.set(key, current);
    total += 1;
  }
  const counts = [...grouped.values()].sort((a, b) => {
    const month = monthRank(b.month).localeCompare(monthRank(a.month));
    return month || a.category.localeCompare(b.category);
  });
  return { capped: false, total, counts };
}

function monthRank(month: string): string {
  return month === "unknown" ? "" : month;
}

function monthOf(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "unknown";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
  return valid ? value.slice(0, 7) : "unknown";
}

function monthStart(index: number): string | null {
  if (!Number.isSafeInteger(index)) return null;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
