import { escapeCsvCell } from "./driver-statement";

/**
 * Per-rental deposit ledger from columns that already exist.
 * Collected is the deposit payment amount. Applied is deposit_deductions.
 * Refunded prefers the rental disposition amount.
 * The balance still held is derived, and only when collected, applied, and
 * refunded are all known. A blank cell is not zero.
 * payments.paid_date is a calendar date and is not shifted.
 * deposit_settled_at is a timestamp and is an Eastern Time day.
 */

export const DEPOSIT_LEDGER_INCOMPLETE = "Finance records were incomplete";

export const STANDING_GAPS = [
  "No column stores the balance still held. It is collected minus applied minus refunded, and only when all three amounts are known.",
  "No column stores cash collected on the rental. Collected is the amount on a paid or refunded deposit payment. The rental deposit amount is the amount required, not cash collected.",
  "Applied to charges is the sum of deposit deduction rows. No deduction row is not zero.",
  "The collected date is payments.paid_date, a calendar date, so it is not shifted into Eastern Time. deposit_settled_at is a timestamp and is shown as an Eastern Time day.",
  "There is no method column on the rental. Method is the deposit payment method.",
  "When no refund amount, refund row, or refunded status is stored, refunded is shown as zero and the row says so.",
  "Applicant deposit amount, deposit paid, and deposit status are a different record and are not read here.",
] as const;

const KNOWN_STATUS = new Set(["none", "held", "pending_disposition", "partially_refunded", "refunded", "forfeited"]);
const REFUND_STATUS = new Set(["refunded", "partially_refunded"]);
const COLLECTED_STATUS = new Set(["paid", "refunded"]);
const DEAD_REFUND = new Set(["failed", "canceled", "cancelled", "void"]);
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type LedgerRental = {
  id: string;
  applicationId: string | null;
  driverId: string | null;
  depositAmount: number | null;
  depositHeld: boolean | null;
  depositStatus: string;
  depositRefundAmount: number | null;
  depositSettledAt: string | null;
};

export type LedgerPayment = {
  id: string;
  rentalId: string | null;
  driverId: string | null;
  type: string;
  status: string;
  amount: number;
  netCollected: number | null;
  paidDate: string | null;
  method: string | null;
  refundedAmount: number;
  refundedAt: string | null;
};

export type LedgerDeduction = {
  id: string;
  rentalId: string;
  amount: number;
  reason: string;
};

export type LedgerRefund = {
  id: string;
  amount: number;
  paymentIds: string[];
  status: string | null;
};

export type LedgerName = {
  applicationId: string;
  renterName: string;
};

export type DepositLedgerRow = {
  id: string;
  renterName: string;
  rentalLabel: string;
  rentalHref: string | null;
  collected: number | null;
  collectedDate: string | null;
  method: string | null;
  held: string | null;
  applied: number | null;
  refunded: number | null;
  balance: number | null;
  settledDate: string | null;
  gaps: string[];
};

export type DepositLedgerReport = {
  rows: DepositLedgerRow[];
  totals: {
    rentals: number;
    collected: number | null;
    applied: number | null;
    refunded: number | null;
    balance: number | null;
    gapRows: number;
  };
  standingGaps: readonly string[];
};

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildDepositLedger(input: {
  rentals: LedgerRental[];
  payments: LedgerPayment[];
  deductions: LedgerDeduction[];
  refunds: LedgerRefund[];
  names: Map<string, LedgerName>;
}): { ok: true; report: DepositLedgerReport } | { ok: false } {
  const deposits = input.payments.filter((payment) => isDeposit(payment.type));
  const byRental = new Map<string, LedgerPayment[]>();
  const loose: LedgerPayment[] = [];
  for (const payment of deposits) {
    if (!payment.rentalId) {
      loose.push(payment);
      continue;
    }
    const list = byRental.get(payment.rentalId) ?? [];
    list.push(payment);
    byRental.set(payment.rentalId, list);
  }
  const deductions = new Map<string, LedgerDeduction[]>();
  for (const row of input.deductions) {
    const list = deductions.get(row.rentalId) ?? [];
    list.push(row);
    deductions.set(row.rentalId, list);
  }
  const rentalIds = new Set(input.rentals.map((rental) => rental.id));
  const rows: DepositLedgerRow[] = [];
  for (const rental of input.rentals) {
    const payments = byRental.get(rental.id) ?? [];
    const appliedRows = deductions.get(rental.id) ?? [];
    if (!hasSignal(rental, payments, appliedRows)) continue;
    const row = rentalRow(rental, payments, appliedRows, input.refunds, input.names);
    if (!row) return { ok: false };
    rows.push(row);
  }
  for (const [rentalId, payments] of byRental) {
    if (rentalIds.has(rentalId)) continue;
    const row = rentalRow(missingRental(rentalId), payments, deductions.get(rentalId) ?? [], input.refunds, input.names);
    if (!row) return { ok: false };
    row.gaps.unshift("The rental row was not in this read.");
    rows.push(row);
  }
  for (const payment of loose) {
    const row = looseRow(payment, input.names);
    if (!row) return { ok: false };
    rows.push(row);
  }
  rows.sort((a, b) => a.renterName.localeCompare(b.renterName) || a.id.localeCompare(b.id));
  return {
    ok: true,
    report: {
      rows,
      totals: totals(rows),
      standingGaps: STANDING_GAPS,
    },
  };
}

export function depositLedgerToCsv(report: DepositLedgerReport): string {
  const header = ["Renter", "Rental", "Collected", "Collected Date", "Method", "Held", "Applied To Charges", "Refunded", "Balance Still Held", "Settled (ET)", "Gaps"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of report.rows) {
    lines.push([
      row.renterName,
      row.rentalHref ?? row.rentalLabel,
      formatMoney(row.collected),
      row.collectedDate ?? "",
      row.method ?? "",
      row.held ?? "",
      formatMoney(row.applied),
      formatMoney(row.refunded),
      formatMoney(row.balance),
      row.settledDate ?? "",
      row.gaps.join("; "),
    ].map(escapeCsvCell).join(","));
  }
  lines.push(["Totals", String(report.totals.rentals), formatMoney(report.totals.collected), "", "", "", formatMoney(report.totals.applied), formatMoney(report.totals.refunded), formatMoney(report.totals.balance), "", `${report.totals.gapRows} rows with gaps`].map(escapeCsvCell).join(","));
  for (const gap of report.standingGaps) lines.push(["Not Stored", gap].map(escapeCsvCell).join(","));
  return `${lines.join("\n")}\n`;
}

function rentalRow(
  rental: LedgerRental,
  payments: LedgerPayment[],
  deductions: LedgerDeduction[],
  refunds: LedgerRefund[],
  names: Map<string, LedgerName>,
): DepositLedgerRow | null {
  if (rental.depositAmount !== null && cents(rental.depositAmount) === null) return null;
  const gaps: string[] = [];
  const collected = collectedFrom(payments, gaps);
  if (collected === "bad") return null;
  if (collected.amount === null && rental.depositAmount !== null) {
    gaps.push("Collected amount is not recorded. The rental deposit amount is the amount required, not cash collected.");
  }
  const applied = appliedFrom(deductions, rental.depositStatus, gaps);
  if (applied === "bad") return null;
  const refunded = refundedFrom(rental, payments, refunds, gaps);
  if (refunded === "bad") return null;
  const balance = balanceFrom(collected.amount, applied, refunded, gaps);
  if (balance === "bad") return null;
  const settled = settledDay(rental.depositSettledAt);
  if (rental.depositSettledAt && !settled) gaps.push("Settled time could not be read as an Eastern Time day.");
  if (REFUND_STATUS.has(normalize(rental.depositStatus)) && !settled) gaps.push("Settled time is not recorded.");
  return {
    id: rental.id,
    renterName: lookupName(rental.applicationId, rental.driverId, names),
    rentalLabel: "Rental",
    rentalHref: `/admin?tab=bookings&id=${rental.id}`,
    collected: collected.amount,
    collectedDate: collected.date,
    method: collected.method,
    held: heldLabel(rental, gaps),
    applied,
    refunded,
    balance,
    settledDate: settled,
    gaps: uniqueGaps(gaps),
  };
}

function looseRow(payment: LedgerPayment, names: Map<string, LedgerName>): DepositLedgerRow | null {
  const gaps = ["This deposit payment is not linked to a rental."];
  const collected = collectedFrom([payment], gaps);
  if (collected === "bad") return null;
  gaps.push("Applied to charges is not recorded. No deduction row is not the same as zero.");
  const refunded = refundedFrom(missingRental(payment.id), [payment], [], gaps);
  if (refunded === "bad") return null;
  return {
    id: `payment:${payment.id}`,
    renterName: lookupName(payment.driverId, null, names),
    rentalLabel: "No Rental",
    rentalHref: null,
    collected: collected.amount,
    collectedDate: collected.date,
    method: collected.method,
    held: null,
    applied: null,
    refunded,
    balance: null,
    settledDate: null,
    gaps: uniqueGaps([...gaps, "Held is not recorded.", "The balance still held needs the rental row."]),
  };
}

function uniqueGaps(gaps: string[]): string[] {
  return [...new Set(gaps)];
}

function hasSignal(rental: LedgerRental, payments: LedgerPayment[], deductions: LedgerDeduction[]): boolean {
  if (payments.length || deductions.length) return true;
  if (rental.depositHeld === true) return true;
  if (rental.depositAmount !== null || rental.depositRefundAmount !== null) return true;
  const status = normalize(rental.depositStatus);
  return status !== "" && status !== "none";
}

function collectedFrom(payments: LedgerPayment[], gaps: string[]): { amount: number | null; date: string | null; method: string | null } | "bad" {
  const collected = payments.filter((payment) => COLLECTED_STATUS.has(normalize(payment.status)));
  if (!collected.length) {
    if (payments.length) gaps.push("A deposit payment exists and is not paid or refunded, so collected cash is not recorded.");
    return { amount: null, date: null, method: null };
  }
  const amounts: number[] = [];
  const dates: string[] = [];
  const methods: string[] = [];
  let missingDate = false;
  let missingMethod = false;
  let shifted = false;
  for (const payment of collected) {
    const amount = cents(payment.amount);
    if (amount === null) return "bad";
    amounts.push(amount);
    const dated = calendarOrEastern(payment.paidDate);
    if (!dated.date) missingDate = true;
    else dates.push(dated.date);
    if (dated.shifted) shifted = true;
    const method = payment.method?.trim();
    if (!method) missingMethod = true;
    else methods.push(titleLabel(method));
    if (payment.netCollected !== null) {
      const net = cents(payment.netCollected);
      const refunded = cents(payment.refundedAmount);
      if (net === null || refunded === null) return "bad";
      if (net !== amount - refunded) gaps.push("Net collected does not equal the payment amount minus the refunded amount, so collected stays the payment amount.");
    } else if (cents(payment.refundedAmount) === null) return "bad";
  }
  const amount = sum(amounts);
  if (amount === null) return "bad";
  if (missingDate) gaps.push("A collected deposit has no paid date.");
  if (shifted) gaps.push("A collected date included a time, so it is shown as an Eastern Time day.");
  if (missingMethod) gaps.push("Payment method is not recorded.");
  return {
    amount,
    date: missingDate || !dates.length ? null : dates.sort()[0],
    method: missingMethod || !methods.length ? null : [...new Set(methods)].sort().join(", "),
  };
}

function appliedFrom(deductions: LedgerDeduction[], status: string, gaps: string[]): number | null | "bad" {
  if (!deductions.length) {
    if (normalize(status) === "forfeited") gaps.push("Forfeited is recorded and no deduction rows say what was applied.");
    else gaps.push("Applied to charges is not recorded. No deduction row is not the same as zero.");
    return null;
  }
  const amounts: number[] = [];
  for (const row of deductions) {
    const amount = cents(row.amount);
    if (amount === null || amount === 0) return "bad";
    amounts.push(amount);
  }
  return sum(amounts);
}

function refundedFrom(rental: LedgerRental, payments: LedgerPayment[], refunds: LedgerRefund[], gaps: string[]): number | null | "bad" {
  const paymentIds = new Set(payments.map((payment) => payment.id));
  let paymentSum = 0;
  let paymentKnown = false;
  for (const payment of payments) {
    const amount = cents(payment.refundedAmount);
    if (amount === null) return "bad";
    if (payment.refundedAt || amount > 0) {
      paymentKnown = true;
      paymentSum += amount;
      if (!Number.isSafeInteger(paymentSum)) return "bad";
    }
  }
  let ledgerSum = 0;
  let ledgerKnown = false;
  let ambiguous = false;
  for (const refund of refunds) {
    if (DEAD_REFUND.has(normalize(refund.status))) continue;
    if (!refund.paymentIds.length) continue;
    const hits = refund.paymentIds.filter((id) => paymentIds.has(id));
    if (!hits.length) continue;
    if (hits.length !== refund.paymentIds.length) {
      ambiguous = true;
      continue;
    }
    const amount = cents(refund.amount);
    if (amount === null) return "bad";
    ledgerKnown = true;
    ledgerSum += amount;
    if (!Number.isSafeInteger(ledgerSum)) return "bad";
  }
  if (ambiguous) gaps.push("A refund names this deposit along with other payments, so that refund was not used as the refunded amount.");
  const rentalAmount = rental.depositRefundAmount === null ? null : cents(rental.depositRefundAmount);
  if (rental.depositRefundAmount !== null && rentalAmount === null) return "bad";
  if (rentalAmount !== null) {
    if (paymentKnown && paymentSum !== rentalAmount) gaps.push("The rental refund amount does not match the deposit payment refunds. The rental amount is shown.");
    if (ledgerKnown && ledgerSum !== rentalAmount) gaps.push("The rental refund amount does not match payment refund rows. The rental amount is shown.");
    return rentalAmount;
  }
  if (paymentKnown) {
    if (ledgerKnown && ledgerSum !== paymentSum) gaps.push("Deposit payment refunds do not match payment refund rows. The payment refund amount is shown.");
    return paymentSum;
  }
  if (ledgerKnown) return ledgerSum;
  if (REFUND_STATUS.has(normalize(rental.depositStatus))) {
    gaps.push(`Deposit status is ${titleLabel(rental.depositStatus)} and no refund amount is recorded.`);
    return null;
  }
  gaps.push("Refunded amount is not stored, so this row uses zero.");
  return 0;
}

function balanceFrom(collected: number | null, applied: number | null, refunded: number | null, gaps: string[]): number | null | "bad" {
  if (collected === null || applied === null || refunded === null) return null;
  const balance = collected - applied - refunded;
  if (!Number.isSafeInteger(balance)) return "bad";
  if (balance < 0) {
    gaps.push("Collected minus applied minus refunded is below zero, so the balance still held is blank.");
    return null;
  }
  return balance;
}

function heldLabel(rental: LedgerRental, gaps: string[]): string | null {
  const status = normalize(rental.depositStatus);
  if (rental.depositHeld === null) gaps.push("Held is not recorded.");
  if (status && !KNOWN_STATUS.has(status)) {
    gaps.push("Deposit status is outside none, held, pending disposition, partially refunded, refunded, and forfeited.");
  }
  const held = rental.depositHeld === null ? null : rental.depositHeld ? "Yes" : "No";
  const label = status && status !== "none" ? titleLabel(status) : null;
  if (held && label) return `${held} · ${label}`;
  return held ?? label;
}

function settledDay(value: string | null): string | null {
  if (!value) return null;
  return etYmd(new Date(value));
}

function calendarOrEastern(value: string | null): { date: string | null; shifted: boolean } {
  if (!value) return { date: null, shifted: false };
  const trimmed = value.trim();
  if (CALENDAR_DAY.test(trimmed)) return { date: trimmed, shifted: false };
  return { date: etYmd(new Date(trimmed)), shifted: true };
}

function lookupName(applicationId: string | null, driverId: string | null, names: Map<string, LedgerName>): string {
  return names.get(applicationId ?? "")?.renterName || names.get(driverId ?? "")?.renterName || "Renter";
}

function missingRental(id: string): LedgerRental {
  return {
    id,
    applicationId: null,
    driverId: null,
    depositAmount: null,
    depositHeld: null,
    depositStatus: "none",
    depositRefundAmount: null,
    depositSettledAt: null,
  };
}

function totals(rows: DepositLedgerRow[]): DepositLedgerReport["totals"] {
  return {
    rentals: rows.length,
    collected: sumKnown(rows.map((row) => row.collected)),
    applied: sumKnown(rows.map((row) => row.applied)),
    refunded: sumKnown(rows.map((row) => row.refunded)),
    balance: sumKnown(rows.map((row) => row.balance)),
    gapRows: rows.filter((row) => row.gaps.length > 0).length,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return null;
  return sum(known);
}

function cents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const next = Math.round(value * 100);
  if (!Number.isSafeInteger(next) || next < 0) return null;
  return next;
}

function sum(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function isDeposit(type: string): boolean {
  return normalize(type) === "deposit";
}

function normalize(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function titleLabel(value: string): string {
  return value.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}
