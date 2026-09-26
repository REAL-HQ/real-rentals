// Date ranges for the revenue card, and the prior period to compare against.
//
// Pure and client-safe so the arithmetic can be tested without a browser.
//
// The comparison period is always the same *length* immediately before the
// range. That is what makes a part-finished period honest: eleven days into
// the month, "This Month" compares against the eleven days before it started,
// not against a full previous month that would always look larger.

export type RangeKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7"
  | "this_month"
  | "last_30"
  | "this_quarter"
  | "this_year"
  | "custom";

export const RANGE_LABELS: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_7", label: "Last 7 Days" },
  { key: "this_month", label: "This Month" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "this_year", label: "This Year" },
  { key: "custom", label: "Custom" },
];

/** Inclusive day range, as the YYYY-MM-DD strings payments.paid_date stores. */
export type DayRange = { from: string; to: string };

const iso = (d: Date) => {
  // Local calendar date, not UTC: a payment taken at 7pm on the 3rd belongs to
  // the 3rd for whoever is reading the dashboard, not the 4th.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

export function resolveRange(
  key: RangeKey,
  today = new Date(),
  custom?: Partial<DayRange>,
): DayRange {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);

  switch (key) {
    case "today":
      return { from: iso(t), to: iso(t) };
    case "yesterday": {
      const y = addDays(t, -1);
      return { from: iso(y), to: iso(y) };
    }
    case "this_week": {
      // Weeks start Sunday, matching the Billed vs Collected buckets.
      const start = addDays(t, -t.getDay());
      return { from: iso(start), to: iso(t) };
    }
    case "last_7":
      return { from: iso(addDays(t, -6)), to: iso(t) };
    case "this_month":
      return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
    case "last_30":
      return { from: iso(addDays(t, -29)), to: iso(t) };
    case "this_quarter": {
      const q = Math.floor(t.getMonth() / 3) * 3;
      return { from: iso(new Date(t.getFullYear(), q, 1)), to: iso(t) };
    }
    case "this_year":
      return { from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) };
    case "custom": {
      const from = custom?.from || iso(addDays(t, -29));
      const to = custom?.to || iso(t);
      // Tolerate a backwards custom range rather than returning nothing.
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The equally long stretch ending the day before `range` starts. */
export function priorRange(range: DayRange): DayRange {
  const from = new Date(range.from + "T00:00:00");
  const to = new Date(range.to + "T00:00:00");
  const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -(days - 1));
  return { from: iso(priorFrom), to: iso(priorTo) };
}

/** Short human label for a resolved range, e.g. "Mar 1 – Mar 11". */
export function describeRange(r: DayRange): string {
  const f = new Date(r.from + "T00:00:00");
  const t = new Date(r.to + "T00:00:00");
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return r.from === r.to ? fmt(f) : `${fmt(f)} – ${fmt(t)}`;
}
