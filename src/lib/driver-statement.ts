import { matchDriver, type DriverMatchApplication, type DriverMatchRental } from "./stripe-driver-match";

/**
 * Read-only driver statement. A row is included only when the #76 match
 * points at this driver. Paid counts succeeded captured charges. Refunded
 * counts succeeded refunds. Outstanding counts open subscription invoices.
 * A non-USD amount that would enter a total withholds every total.
 */

export type StatementCustomer = { id: string; email: string | null; phone: string | null };
export type StatementCharge = {
  id: string;
  amountCents: number | null;
  currency: string;
  created: number;
  description: string;
  status: string;
  succeeded: boolean;
  customer: StatementCustomer | null;
};
export type StatementRefund = {
  id: string;
  amountCents: number | null;
  currency: string;
  created: number;
  description: string;
  status: string;
  customer: StatementCustomer | null;
};
export type StatementInvoice = {
  id: string;
  amountCents: number | null;
  currency: string;
  created: number;
  description: string;
  status: string;
  outstandingCents: number | null;
  customer: StatementCustomer | null;
};
export type StatementTotals = { paidCents: number; refundedCents: number; outstandingCents: number } | null;
export type StatementRow = {
  id: string;
  date: string | null;
  description: string;
  amountCents: number | null;
  currency: string;
  status: string;
  kind: "charge" | "refund" | "invoice";
  runningPaid: number | null;
  runningRefunded: number | null;
  runningOutstanding: number | null;
};
export type DriverStatementReport = {
  rows: StatementRow[];
  totals: StatementTotals;
};

type Counted = {
  id: string;
  created: number;
  description: string;
  amountCents: number | null;
  currency: string;
  status: string;
  kind: StatementRow["kind"];
  paid: number | null;
  refunded: number | null;
  outstanding: number | null;
};

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function titleLabel(value: string | null): string {
  const text = value?.trim();
  if (!text) return "—";
  return text.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function buildDriverStatement(input: {
  driverId: string;
  applications: DriverMatchApplication[];
  rentals: DriverMatchRental[];
  charges: StatementCharge[];
  refunds: StatementRefund[];
  invoices: StatementInvoice[];
}): DriverStatementReport | null {
  const belongs = (customer: StatementCustomer | null) => {
    if (!customer) return false;
    return matchDriver({ applications: input.applications, rentals: input.rentals, customer }).driverId === input.driverId;
  };
  const charges = unique(input.charges.filter((row) => belongs(row.customer)));
  const refunds = unique(input.refunds.filter((row) => belongs(row.customer)));
  const invoices = unique(input.invoices.filter((row) => belongs(row.customer)));
  if (!charges || !refunds || !invoices) return null;
  const counted: Counted[] = [
    ...charges.map((row) => ({
      id: row.id, created: row.created, description: row.description, amountCents: row.amountCents, currency: row.currency,
      status: titleLabel(row.status), kind: "charge" as const,
      paid: row.succeeded ? usd(row.amountCents, row.currency) : 0,
      refunded: 0, outstanding: 0,
    })),
    ...refunds.map((row) => ({
      id: row.id, created: row.created, description: row.description, amountCents: row.amountCents, currency: row.currency,
      status: titleLabel(row.status), kind: "refund" as const,
      paid: 0, refunded: row.status === "succeeded" ? usd(row.amountCents, row.currency) : 0, outstanding: 0,
    })),
    ...invoices.map((row) => ({
      id: row.id, created: row.created, description: row.description, amountCents: row.amountCents, currency: row.currency,
      status: titleLabel(row.status), kind: "invoice" as const,
      paid: 0, refunded: 0, outstanding: row.status === "open" ? usd(row.outstandingCents, row.currency) : 0,
    })),
  ].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const blocked = counted.some((row) => row.paid === null || row.refunded === null || row.outstanding === null);
  let paid = 0;
  let refunded = 0;
  let outstanding = 0;
  const rows: StatementRow[] = counted.map((row) => {
    if (!blocked) {
      paid += row.paid ?? 0;
      refunded += row.refunded ?? 0;
      outstanding += row.outstanding ?? 0;
    }
    return {
      id: row.id,
      date: etYmd(new Date(row.created * 1000)),
      description: row.description,
      amountCents: row.kind === "refund" && row.amountCents !== null ? -row.amountCents : row.amountCents,
      currency: row.currency,
      status: row.status,
      kind: row.kind,
      runningPaid: blocked || !Number.isSafeInteger(paid) ? null : paid,
      runningRefunded: blocked || !Number.isSafeInteger(refunded) ? null : refunded,
      runningOutstanding: blocked || !Number.isSafeInteger(outstanding) ? null : outstanding,
    };
  });
  const last = rows.at(-1);
  return {
    rows,
    totals: !last || last.runningPaid === null || last.runningRefunded === null || last.runningOutstanding === null
      ? (rows.length === 0 ? { paidCents: 0, refundedCents: 0, outstandingCents: 0 } : null)
      : { paidCents: last.runningPaid, refundedCents: last.runningRefunded, outstandingCents: last.runningOutstanding },
  };
}

/** RFC 4180, with a leading apostrophe when a cell could be a spreadsheet formula. */
export function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function statementToCsv(report: DriverStatementReport): string {
  const header = ["Date", "Description", "Amount", "Status", "Paid", "Refunded", "Outstanding"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of report.rows) {
    lines.push([
      row.date ?? "",
      row.description,
      row.amountCents === null ? "" : (row.amountCents / 100).toFixed(2),
      row.status,
      centsField(row.runningPaid),
      centsField(row.runningRefunded),
      centsField(row.runningOutstanding),
    ].map(escapeCsvCell).join(","));
  }
  lines.push(["", "Paid", report.totals ? (report.totals.paidCents / 100).toFixed(2) : "", "", "", "", ""].map(escapeCsvCell).join(","));
  lines.push(["", "Refunded", report.totals ? (report.totals.refundedCents / 100).toFixed(2) : "", "", "", "", ""].map(escapeCsvCell).join(","));
  lines.push(["", "Outstanding", report.totals ? (report.totals.outstandingCents / 100).toFixed(2) : "", "", "", "", ""].map(escapeCsvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function centsField(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}
function usd(cents: number | null, currency: string): number | null {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return null;
  if (currency.toLowerCase() !== "usd") return null;
  return cents;
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
