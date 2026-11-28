/**
 * Default Payments ledger order: newest activity first.
 *
 * Activity date (single key):
 *   1. Paid time: stripe_paid_at (timestamp) when its America/New_York
 *      calendar date is not after today, else paid_date when that date
 *      is not after today. There is no paid_at column; these two fields
 *      are the paid time.
 *   2. Else created_at, when its ET calendar date is not after today.
 *   3. Else due_date, when due_date is on or before today (ET).
 *   4. Else no activity date. A future due date is not used, so scheduled
 *      upcoming rent does not jump above recent activity. Those rows sort
 *      last in both directions (same blank-last rule as other admin
 *      tables). Among themselves they follow due_date, soonest first when
 *      Newest First, and the reverse when Oldest First.
 *
 * Tie-break: created_at, then id, then original index, in the same
 * direction as the activity date.
 *
 * "Newest First" is activity date descending (the default). "Oldest First"
 * reverses that key. Clicking a column header (Due, Amount, and so on)
 * replaces this order until the header is cleared, which restores Newest
 * First.
 *
 * The Payments table loads the full list and sorts on the client after
 * filters. If the list becomes server-paginated, this order must move
 * onto the query so each page stays in the same order.
 */

const ET = "America/New_York";
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})/;

export type PaymentActivitySortDir = "asc" | "desc";

export type PaymentListSortRow = {
  id?: string | null;
  stripe_paid_at?: string | null;
  paid_date?: string | null;
  created_at?: string | null;
  due_date?: string | null;
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function dateOnly(value: string | null | undefined): string {
  const match = DATE_ONLY.exec(clean(value));
  return match ? match[1] : "";
}

/** YYYY-MM-DD in America/New_York. A date-only value is kept as written. */
export function etDateISO(value: Date | string = new Date()): string {
  if (typeof value === "string") {
    const day = dateOnly(value);
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return day;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return day;
    value = parsed;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function notAfterToday(day: string, todayEt: string): boolean {
  return Boolean(day && day <= todayEt);
}

/** Lexicographically comparable instant or date-only key. Empty if none or in the future. */
export function paymentActivitySortValue(row: PaymentListSortRow, todayEt: string): string {
  const paidAt = clean(row.stripe_paid_at);
  if (paidAt && notAfterToday(etDateISO(paidAt), todayEt)) {
    const time = Date.parse(paidAt);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
    const day = dateOnly(paidAt);
    if (day) return day;
  }

  const paidDate = dateOnly(row.paid_date);
  if (paidDate && notAfterToday(paidDate, todayEt)) return paidDate;

  const created = clean(row.created_at);
  if (created && notAfterToday(etDateISO(created), todayEt)) {
    const time = Date.parse(created);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
    const day = dateOnly(created);
    if (day) return day;
  }

  const due = dateOnly(row.due_date);
  if (due && notAfterToday(due, todayEt)) return due;

  return "";
}

export function sortPaymentsByActivity<T extends PaymentListSortRow>(
  rows: readonly T[],
  dir: PaymentActivitySortDir,
  todayEt: string,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ka = paymentActivitySortValue(a.row, todayEt);
      const kb = paymentActivitySortValue(b.row, todayEt);
      const aBlank = !ka;
      const bBlank = !kb;
      if (aBlank && bBlank) {
        const dueCmp = dateOnly(a.row.due_date).localeCompare(dateOnly(b.row.due_date));
        if (dueCmp !== 0) return dir === "desc" ? dueCmp : -dueCmp;
        const idCmp = clean(a.row.id).localeCompare(clean(b.row.id));
        if (idCmp !== 0) return dir === "desc" ? -idCmp : idCmp;
        return a.index - b.index;
      }
      if (aBlank) return 1;
      if (bBlank) return -1;
      const cmp = ka.localeCompare(kb);
      if (cmp !== 0) return dir === "desc" ? -cmp : cmp;
      const createdCmp = clean(a.row.created_at).localeCompare(clean(b.row.created_at));
      if (createdCmp !== 0) return dir === "desc" ? -createdCmp : createdCmp;
      const idCmp = clean(a.row.id).localeCompare(clean(b.row.id));
      if (idCmp !== 0) return dir === "desc" ? -idCmp : idCmp;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}
