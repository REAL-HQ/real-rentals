/**
 * Read-only weekly cash flow. Weeks are Monday through Sunday, Eastern Time,
 * including the week that contains today. Gross is succeeded captured charges.
 * Refunds are succeeded refunds. Cash flow is net minus expenses.
 * A non-USD succeeded amount withholds that week's Stripe totals and the
 * 12-week rollup, and is not converted.
 */

export const WEEK_COUNT = 12;

const CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration & Tags",
  insurance: "Insurance Premium",
  maintenance: "Routine Maintenance",
  repair: "Repair",
  tires: "Tires",
  fuel: "Fuel",
  cleaning: "Cleaning & Detailing",
  towing: "Towing",
  parking: "Parking & Storage",
  tolls: "Tolls",
  finance: "Finance / Lease Payment",
  purchase: "Purchase",
  gps: "GPS & Telematics",
  other: "Other",
};

export type CashCharge = { id: string; amountCents: number | null; currency: string; created: number; succeeded: boolean };
export type CashRefund = { id: string; amountCents: number | null; currency: string; created: number; status: string };
export type CashExpense = { id: string; amount: number | null; category: string | null; incurredOn: string | null };
export type CategoryTotal = { category: string; label: string; cents: number };
export type CashWeek = {
  from: string;
  through: string;
  gte: number;
  lt: number;
  grossCents: number | null;
  refundCents: number | null;
  netCents: number | null;
  expenseCents: number | null;
  cashFlowCents: number | null;
  categories: CategoryTotal[] | null;
};
export type CashTotals = {
  grossCents: number | null;
  refundCents: number | null;
  netCents: number | null;
  expenseCents: number | null;
  cashFlowCents: number | null;
  categories: CategoryTotal[] | null;
};
export type WeeklyCashFlowReport = { weeks: CashWeek[]; totals: CashTotals };

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function addCalendarDays(ymd: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
}

export function etMidnightUnix(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second")) - instant;
  };
  let utc = utcMidnight - offset(utcMidnight);
  const again = offset(utc);
  if (again !== offset(utcMidnight)) utc = utcMidnight - again;
  const seconds = Math.floor(utc / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** Monday of the Eastern calendar date, as YYYY-MM-DD. */
export function mondayOf(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return addCalendarDays(ymd, -((weekday + 6) % 7));
}

export function cashFlowWeeks(now: Date): Omit<CashWeek, "grossCents" | "refundCents" | "netCents" | "expenseCents" | "cashFlowCents" | "categories">[] | null {
  const today = etYmd(now);
  const monday = today ? mondayOf(today) : null;
  const first = monday ? addCalendarDays(monday, -7 * (WEEK_COUNT - 1)) : null;
  if (!first) return null;
  const weeks = [];
  for (let index = 0; index < WEEK_COUNT; index++) {
    const from = addCalendarDays(first, index * 7);
    const through = from ? addCalendarDays(from, 6) : null;
    const next = from ? addCalendarDays(from, 7) : null;
    const gte = from ? etMidnightUnix(from) : null;
    const lt = next ? etMidnightUnix(next) : null;
    if (!from || !through || gte === null || lt === null || lt <= gte) return null;
    weeks.push({ from, through, gte, lt });
  }
  return weeks;
}

export function categoryLabel(category: string | null): string {
  const key = category?.trim().toLowerCase() ?? "";
  if (!key) return "Uncategorized";
  return CATEGORY_LABELS[key] ?? key.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function dollarsToCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents;
}

export function buildWeeklyCashFlow(input: {
  now: Date;
  charges: CashCharge[];
  refunds: CashRefund[];
  expenses: CashExpense[];
}): WeeklyCashFlowReport | null {
  const bounds = cashFlowWeeks(input.now);
  if (!bounds) return null;
  const charges = unique(input.charges);
  const refunds = unique(input.refunds);
  const expenses = unique(input.expenses.map((row) => ({ ...row, amountCents: dollarsToCents(row.amount), currency: "usd" })));
  if (!charges || !refunds || !expenses) return null;
  if (expenses.some((row) => !row.incurredOn || !/^\d{4}-\d{2}-\d{2}/.test(row.incurredOn))) return null;
  const weeks: CashWeek[] = bounds.map((week) => {
    const gross = stripeSum(charges.filter((row) => row.succeeded && row.created >= week.gte && row.created < week.lt));
    const refunded = stripeSum(refunds.filter((row) => row.status === "succeeded" && row.created >= week.gte && row.created < week.lt));
    const net = gross === null || refunded === null || !Number.isSafeInteger(gross - refunded) ? null : gross - refunded;
    const inWeek = expenses.filter((row) => (row.incurredOn ?? "") >= week.from && (row.incurredOn ?? "").slice(0, 10) <= week.through);
    const expense = expenseSum(inWeek);
    const cash = net === null || expense.cents === null || !Number.isSafeInteger(net - expense.cents) ? null : net - expense.cents;
    return { ...week, grossCents: gross, refundCents: refunded, netCents: net, expenseCents: expense.cents, cashFlowCents: cash, categories: expense.categories };
  });
  return { weeks, totals: rollup(weeks) };
}

function stripeSum(rows: Array<{ amountCents: number | null; currency: string }>): number | null {
  if (rows.some((row) => row.amountCents === null || row.currency.toLowerCase() !== "usd")) return null;
  return sum(rows.map((row) => row.amountCents));
}
function expenseSum(rows: Array<{ amountCents: number | null; category: string | null }>): { cents: number | null; categories: CategoryTotal[] | null } {
  if (rows.some((row) => row.amountCents === null)) return { cents: null, categories: null };
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const key = row.category?.trim().toLowerCase() || "";
    const next = (byCategory.get(key) ?? 0) + (row.amountCents ?? 0);
    if (!Number.isSafeInteger(next)) return { cents: null, categories: null };
    byCategory.set(key, next);
  }
  const categories = [...byCategory.entries()]
    .map(([category, cents]) => ({ category: category || "uncategorized", label: categoryLabel(category), cents }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
  return { cents: sum(categories.map((row) => row.cents)), categories };
}
function rollup(weeks: CashWeek[]): CashTotals {
  const categories = new Map<string, { label: string; cents: number }>();
  let categoriesOk = weeks.every((week) => week.categories);
  if (categoriesOk) {
    for (const week of weeks) {
      for (const row of week.categories ?? []) {
        const next = (categories.get(row.category)?.cents ?? 0) + row.cents;
        if (!Number.isSafeInteger(next)) categoriesOk = false;
        else categories.set(row.category, { label: row.label, cents: next });
      }
    }
  }
  return {
    grossCents: sum(weeks.map((week) => week.grossCents)),
    refundCents: sum(weeks.map((week) => week.refundCents)),
    netCents: sum(weeks.map((week) => week.netCents)),
    expenseCents: sum(weeks.map((week) => week.expenseCents)),
    cashFlowCents: sum(weeks.map((week) => week.cashFlowCents)),
    categories: categoriesOk ? [...categories.entries()].map(([category, row]) => ({ category, label: row.label, cents: row.cents })).sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category)) : null,
  };
}
function sum(values: Array<number | null>): number | null {
  if (values.some((value) => value === null || !Number.isSafeInteger(value))) return null;
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
function unique<T extends { id: string; amountCents: number | null; currency: string }>(rows: T[]): T[] | null {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const prior = seen.get(row.id);
    if (!prior) { seen.set(row.id, row); continue; }
    if (prior.amountCents !== row.amountCents || prior.currency !== row.currency) return null;
  }
  return [...seen.values()];
}
