import { escapeCsvCell } from "./driver-statement";

/**
 * Outstanding renter balances, aged in Eastern Time from payments rows.
 * A payments row is the invoice (due_date, balance_due, stripe_invoice_id)
 * and the payment (paid_date, status). Deposits are not renter balances.
 * Dates stored as calendar days are not shifted. Only the report clock is ET.
 */

export const RENT_AGING_INCOMPLETE = "Finance records were incomplete";

export const AGING_BUCKETS = [
  { id: "current", label: "Current" },
  { id: "d1_7", label: "1–7 Days" },
  { id: "d8_14", label: "8–14 Days" },
  { id: "d15_30", label: "15–30 Days" },
  { id: "d30_plus", label: "30+ Days" },
] as const;

export type AgingBucketId = (typeof AGING_BUCKETS)[number]["id"];

export type AgingCharge = {
  id: string;
  rentalId: string | null;
  driverId: string | null;
  type: string | null;
  status: string;
  /** Remaining balance. Null means the column was blank. */
  balanceDue: number | null;
  /** Original amount, used only when the balance column is blank. */
  amount: number | null;
  dueDate: string | null;
  paidDate: string | null;
};

export type AgingName = {
  applicationId: string | null;
  renterName: string;
};

export type AgingRow = {
  id: string;
  bucket: AgingBucketId;
  renterName: string;
  renterHref: string | null;
  rentalLabel: string;
  rentalHref: string | null;
  amountDue: number;
  oldestUnpaid: string | null;
  lastPayment: string | null;
};

export type AgingTotal = { id: AgingBucketId; label: string; count: number; amount: number };

export type AgingReport = {
  asOf: string;
  rows: AgingRow[];
  totals: AgingTotal[];
  totalAmount: number;
};

const EXCLUDED = new Set(["void", "waived", "cancelled", "canceled"]);
const CLOSED = new Set(["paid", "refunded"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function buildRentAging(input: {
  asOf: Date;
  charges: AgingCharge[];
  names: Map<string, AgingName>;
}): { ok: true; report: AgingReport } | { ok: false } {
  const asOf = etYmd(input.asOf);
  if (!asOf) return { ok: false };
  const groups = new Map<string, { charges: AgingCharge[]; rentalId: string | null; driverId: string | null }>();
  for (const charge of input.charges) {
    const key = charge.rentalId ? `rental:${charge.rentalId}` : charge.driverId ? `driver:${charge.driverId}` : `charge:${charge.id}`;
    const group = groups.get(key) ?? { charges: [], rentalId: charge.rentalId, driverId: charge.driverId };
    group.charges.push(charge);
    if (!group.driverId && charge.driverId) group.driverId = charge.driverId;
    groups.set(key, group);
  }

  const rows: AgingRow[] = [];
  for (const [key, group] of groups) {
    let amountDue = 0;
    let oldest: string | null = null;
    let undated = false;
    let lastPayment: string | null = null;
    for (const charge of group.charges) {
      if (isDeposit(charge.type)) continue;
      const due = owed(charge);
      if (due === "unreadable" || due < 0) return { ok: false };
      const status = charge.status.trim().toLowerCase();
      if (CLOSED.has(status)) {
        const paid = calendarDate(charge.paidDate);
        if (paid && (!lastPayment || paid > lastPayment)) lastPayment = paid;
        continue;
      }
      if (EXCLUDED.has(status) || due === 0) continue;
      const dated = calendarDate(charge.dueDate);
      if (!dated) undated = true;
      else if (!oldest || dated < oldest) oldest = dated;
      amountDue = roundCents(amountDue + due);
    }
    if (amountDue <= 0) continue;
    if (undated) return { ok: false };
    if (!oldest) return { ok: false };
    const days = daysPast(oldest, asOf);
    if (days === null) return { ok: false };
    const name = (group.driverId && input.names.get(group.driverId))
      || (group.rentalId && input.names.get(`rental:${group.rentalId}`))
      || null;
    const rentalId = group.rentalId;
    rows.push({
      id: key,
      bucket: bucketFor(days),
      renterName: name?.renterName || "Renter",
      renterHref: name?.applicationId ? `/admin?tab=drivers&id=${encodeURIComponent(name.applicationId)}` : null,
      rentalLabel: rentalId ? `Rental ${rentalId}` : "No Rental",
      rentalHref: rentalId ? `/admin?tab=bookings&id=${encodeURIComponent(rentalId)}` : null,
      amountDue,
      oldestUnpaid: oldest,
      lastPayment,
    });
  }

  const order = new Map(AGING_BUCKETS.map((bucket, index) => [bucket.id, index]));
  rows.sort((a, b) => (order.get(b.bucket)! - order.get(a.bucket)!) || (a.oldestUnpaid ?? "").localeCompare(b.oldestUnpaid ?? "") || a.renterName.localeCompare(b.renterName) || a.id.localeCompare(b.id));
  const totals = AGING_BUCKETS.map((bucket) => {
    const matched = rows.filter((row) => row.bucket === bucket.id);
    return {
      id: bucket.id,
      label: bucket.label,
      count: matched.length,
      amount: roundCents(matched.reduce((sum, row) => sum + row.amountDue, 0)),
    };
  });
  return {
    ok: true,
    report: {
      asOf,
      rows,
      totals,
      totalAmount: roundCents(rows.reduce((sum, row) => sum + row.amountDue, 0)),
    },
  };
}

export function rentAgingToCsv(report: AgingReport): string {
  const summary = [
    ["Bucket", "Rentals", "Amount Due"],
    ...report.totals.map((row) => [row.label, String(row.count), formatMoney(row.amount)]),
    ["Total", String(report.rows.length), formatMoney(report.totalAmount)],
  ];
  const detail = [["Bucket", "Renter", "Rental", "Amount Due", "Oldest Unpaid", "Last Payment", "Rental Link"]];
  for (const row of report.rows) {
    const bucket = AGING_BUCKETS.find((item) => item.id === row.bucket)?.label ?? row.bucket;
    detail.push([
      bucket,
      row.renterName,
      row.rentalLabel,
      formatMoney(row.amountDue),
      row.oldestUnpaid ?? "",
      row.lastPayment ?? "",
      row.rentalHref ?? "",
    ]);
  }
  const lines = [...summary, [], ...detail].map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function bucketFor(daysPastDue: number): AgingBucketId {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 7) return "d1_7";
  if (daysPastDue <= 14) return "d8_14";
  if (daysPastDue <= 30) return "d15_30";
  return "d30_plus";
}

function owed(charge: AgingCharge): number | "unreadable" {
  if (charge.balanceDue !== null) {
    if (!Number.isFinite(charge.balanceDue)) return "unreadable";
    return charge.balanceDue;
  }
  if (charge.amount === null || !Number.isFinite(charge.amount)) return "unreadable";
  return charge.amount;
}

function isDeposit(type: string | null): boolean {
  return (type ?? "rent").trim().toLowerCase() === "deposit";
}

function calendarDate(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const day = trimmed.slice(0, 10);
  return DATE.test(day) ? day : null;
}

function daysPast(due: string, today: string): number | null {
  if (!DATE.test(due) || !DATE.test(today)) return null;
  const start = Date.parse(`${due}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
