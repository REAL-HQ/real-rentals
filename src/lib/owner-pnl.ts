import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";

/**
 * Company P&L for one Eastern Time month and the month before it.
 * Revenue uses the Vehicle Profitability / Partner Statement charge rules:
 * a succeeded USD charge counts when one payment or rental link names one
 * vehicle; deposits are excluded; a charge with no single vehicle is
 * unattributed and is not in net. Expenses use vehicle_expenses.category
 * (that column exists). A linked service and its expense are one cost.
 * Refunds are payment_refunds rows. A refund of a deposit is excluded,
 * because that deposit was never revenue. Net is attributed revenue minus
 * those refunds minus expenses.
 * Charge lists come from readLivePartnerCharges. This module does not call Stripe.
 */

export type OwnerCharge = {
  id: string;
  customerId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  amountCents: number;
  currency: string;
  succeeded: boolean;
  created: number;
};
export type OwnerPaymentLink = {
  id: string;
  vehicleId: string | null;
  type: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
};
export type OwnerRentalLink = {
  id: string;
  vehicleId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
};
export type OwnerExpenseRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};
export type OwnerMaintenanceRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type OwnerRefundRow = {
  id: string;
  amount: string | number | null;
  status: string | null;
  createdAt: string | null;
  paymentIds: string[];
};
export type OwnerPnlDirectory = {
  payments: OwnerPaymentLink[];
  rentals: OwnerRentalLink[];
  expenses: OwnerExpenseRow[];
  maintenance: OwnerMaintenanceRow[];
  refunds: OwnerRefundRow[];
};

export type OwnerExpenseGroup = { category: string; label: string; cents: number };
export type OwnerPnlMonth = {
  month: string;
  from: string;
  to: string;
  through: string;
  revenueCents: number | null;
  unattributedRevenueCents: number | null;
  depositsExcludedCents: number | null;
  depositRefundsExcludedCents: number | null;
  refundsCents: number | null;
  expenseCents: number | null;
  expenses: OwnerExpenseGroup[];
  netCents: number | null;
  revenueComplete: boolean;
  expensesComplete: boolean;
  refundsComplete: boolean;
  conflictingCharges: number;
};
export type OwnerPnlChange = {
  revenueCents: number | null;
  unattributedRevenueCents: number | null;
  depositsExcludedCents: number | null;
  depositRefundsExcludedCents: number | null;
  refundsCents: number | null;
  expenseCents: number | null;
  netCents: number | null;
};
export type OwnerPnlReport = {
  current: OwnerPnlMonth;
  previous: OwnerPnlMonth;
  change: OwnerPnlChange;
};

const CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration And Tags",
  insurance: "Insurance Premium",
  maintenance: "Routine Maintenance",
  repair: "Repair",
  tires: "Tires",
  fuel: "Fuel",
  cleaning: "Cleaning And Detailing",
  towing: "Towing",
  parking: "Parking And Storage",
  tolls: "Tolls Absorbed",
  finance: "Finance And Lease",
  purchase: "Purchase",
  gps: "GPS And Telematics",
  other: "Other",
};
const REFUND_SKIP = new Set(["pending", "failed", "canceled", "cancelled"]);

export function categoryLabel(category: string | null): string {
  if (!category?.trim()) return "Uncategorized";
  const known = CATEGORY_LABELS[category.trim().toLowerCase()];
  if (known) return known;
  return category.trim().split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function currentEtMonth(now: Date): string | null {
  const today = etYmd(now);
  return today ? today.slice(0, 7) : null;
}

function addDays(ymd: string, days: number): string | null {
  if (!validFinanceDate(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  const text = next.toISOString().slice(0, 10);
  return validFinanceDate(text) ? text : null;
}

function etMidnightUnix(ymd: string): number | null {
  if (!validFinanceDate(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
    return asUtc - instant;
  };
  let utc = utcMidnight - offset(utcMidnight);
  const again = offset(utc);
  if (again !== offset(utcMidnight)) utc = utcMidnight - again;
  const seconds = Math.floor(utc / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function previousMonth(month: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return null;
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
}

export function monthWindow(month: string): { month: string; from: string; to: string; through: string; gte: number; lt: number } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const from = `${month}-01`;
  if (!validFinanceDate(from)) return null;
  const [year, mon] = month.split("-").map(Number);
  const to = mon === 12 ? `${year! + 1}-01-01` : `${year}-${String(mon! + 1).padStart(2, "0")}-01`;
  const through = addDays(to, -1);
  const gte = etMidnightUnix(from);
  const lt = etMidnightUnix(to);
  if (!through || gte === null || lt === null || lt <= gte) return null;
  return { month, from, to, through, gte, lt };
}

function calendarDay(value: string | null | undefined): { date: string | null; invalid: boolean } {
  if (value === null || value === undefined || value === "") return { date: null, invalid: false };
  if (validFinanceDate(value)) return { date: value, invalid: false };
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    const date = Number.isNaN(parsed.getTime()) ? null : etYmd(parsed);
    return date && validFinanceDate(date) ? { date, invalid: false } : { date: null, invalid: true };
  }
  return { date: null, invalid: true };
}

function placed(candidates: (string | null | undefined)[]): { date: string | null; invalid: boolean } {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const day = calendarDay(candidate);
    return day.invalid ? { date: null, invalid: true } : { date: day.date, invalid: false };
  }
  return { date: null, invalid: true };
}

type ChargeDecision = { kind: "vehicle"; vehicleId: string } | { kind: "unattributed"; conflict: boolean } | { kind: "deposit" };

function decideCharge(charge: OwnerCharge, payments: OwnerPaymentLink[], rentals: OwnerRentalLink[]): ChargeDecision {
  const paymentHits = payments.filter((payment) => payment.vehicleId && (
    (charge.paymentIntentId && payment.paymentIntentId === charge.paymentIntentId)
    || (charge.invoiceId && payment.invoiceId === charge.invoiceId)
    || (charge.subscriptionId && payment.subscriptionId === charge.subscriptionId)
  ));
  const subscriptionHits = charge.subscriptionId
    ? rentals.filter((rental) => rental.vehicleId && rental.subscriptionId === charge.subscriptionId)
    : [];
  const ids = new Set<string>([
    ...paymentHits.map((payment) => payment.vehicleId as string),
    ...subscriptionHits.map((rental) => rental.vehicleId as string),
  ]);
  if (paymentHits.length || subscriptionHits.length) {
    if (ids.size !== 1) return { kind: "unattributed", conflict: true };
    if (paymentHits.some((payment) => payment.type === "deposit") && paymentHits.some((payment) => payment.type !== "deposit")) return { kind: "unattributed", conflict: true };
    if (paymentHits.length > 0 && paymentHits.every((payment) => payment.type === "deposit")) return { kind: "deposit" };
    return { kind: "vehicle", vehicleId: [...ids][0]! };
  }
  const customerHits = charge.customerId ? rentals.filter((rental) => rental.vehicleId && rental.customerId === charge.customerId) : [];
  const customers = new Set(customerHits.map((rental) => rental.vehicleId as string));
  if (customers.size > 1) return { kind: "unattributed", conflict: true };
  if (customers.size === 1) return { kind: "vehicle", vehicleId: [...customers][0]! };
  return { kind: "unattributed", conflict: false };
}

function sum(values: number[]): number | null {
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  const value = current - previous;
  return Number.isSafeInteger(value) ? value : null;
}

export function buildOwnerPnlMonth(input: OwnerPnlDirectory & { month: string; charges: OwnerCharge[] }): OwnerPnlMonth | null {
  const window = monthWindow(input.month);
  if (!window) return null;
  const inWindow = (date: string) => date >= window.from && date < window.to;
  const categories = new Map<string, number>();
  let expensesComplete = true;
  const addExpense = (category: string | null, cents: number) => {
    const key = category?.trim() || "other";
    const next = (categories.get(key) ?? 0) + cents;
    if (!Number.isSafeInteger(next)) expensesComplete = false;
    else categories.set(key, next);
  };

  const linked = new Map<string, OwnerExpenseRow[]>();
  for (const expense of input.expenses) {
    if (!expense.maintenanceRecordId) continue;
    const rows = linked.get(expense.maintenanceRecordId) ?? [];
    rows.push(expense);
    linked.set(expense.maintenanceRecordId, rows);
  }
  for (const expense of input.expenses) {
    if (expense.maintenanceRecordId) continue;
    const place = placed([expense.incurredOn]);
    if (place.invalid || !place.date) { expensesComplete = false; continue; }
    if (!inWindow(place.date)) continue;
    const cents = decimalSourceCents(expense.amount);
    if (cents === null || !expense.vehicleId) { expensesComplete = false; continue; }
    addExpense(expense.category, cents);
  }
  const seenMaintenance = new Set(input.maintenance.map((record) => record.id));
  for (const [recordId, rows] of linked) {
    if (seenMaintenance.has(recordId)) continue;
    if (rows.length) expensesComplete = false;
  }
  for (const record of input.maintenance) {
    const place = placed([record.performedOn, record.completedAt, record.createdAt]);
    const links = (linked.get(record.id) ?? []).map((expense) => ({ expense, place: placed([expense.incurredOn]) }));
    if (links.some((link) => link.place.invalid || !link.place.date)) expensesComplete = false;
    if (place.invalid || !place.date) { expensesComplete = false; continue; }
    const inside = inWindow(place.date);
    const expensesInside = links.filter((link) => link.place.date && inWindow(link.place.date));
    if (!inside && expensesInside.length === 0) continue;
    if (!record.vehicleId || expensesInside.some((link) => link.expense.vehicleId !== record.vehicleId)) { expensesComplete = false; continue; }
    const shareCents = decimalSourceCents(record.companyShare);
    const amounts = expensesInside.map((link) => decimalSourceCents(link.expense.amount));
    if ((inside && shareCents === null) || amounts.some((amount) => amount === null)) { expensesComplete = false; continue; }
    const linkedCents = (amounts as number[]).reduce((acc, amount) => acc + amount, 0);
    if (!Number.isSafeInteger(linkedCents)) { expensesComplete = false; continue; }
    if (expensesInside.length === 0) { if (inside && shareCents) addExpense(record.category, shareCents); continue; }
    if (!inside || shareCents === 0 || shareCents === linkedCents) {
      for (const link of expensesInside) addExpense(link.expense.category, decimalSourceCents(link.expense.amount) ?? 0);
      continue;
    }
    expensesComplete = false;
  }

  let unattributed = 0;
  let conflicting = 0;
  let deposits = 0;
  let revenue = 0;
  let revenueComplete = true;
  for (const charge of input.charges) {
    if (!charge.succeeded) continue;
    if (charge.currency !== "usd" || !Number.isSafeInteger(charge.amountCents) || charge.amountCents < 0) { revenueComplete = false; continue; }
    if (charge.created < window.gte || charge.created >= window.lt) continue;
    const decision = decideCharge(charge, input.payments, input.rentals);
    if (decision.kind === "deposit") {
      const next = deposits + charge.amountCents;
      if (!Number.isSafeInteger(next)) revenueComplete = false;
      else deposits = next;
      continue;
    }
    if (decision.kind === "unattributed") {
      if (decision.conflict) conflicting += 1;
      const next = unattributed + charge.amountCents;
      if (!Number.isSafeInteger(next)) revenueComplete = false;
      else unattributed = next;
      continue;
    }
    const next = revenue + charge.amountCents;
    if (!Number.isSafeInteger(next)) revenueComplete = false;
    else revenue = next;
  }

  const paymentsById = new Map(input.payments.map((payment) => [payment.id, payment]));
  let refunds = 0;
  let depositRefunds = 0;
  let refundsComplete = true;
  for (const refund of input.refunds) {
    const place = placed([refund.createdAt]);
    if (place.invalid || !place.date) { refundsComplete = false; continue; }
    if (!inWindow(place.date)) continue;
    const status = (refund.status ?? "").trim().toLowerCase();
    if (REFUND_SKIP.has(status)) continue;
    if (status !== "succeeded") { refundsComplete = false; continue; }
    const cents = decimalSourceCents(refund.amount);
    if (cents === null) { refundsComplete = false; continue; }
    if (!refund.paymentIds.length) { refundsComplete = false; continue; }
    const linkedPayments = refund.paymentIds.map((id) => paymentsById.get(id));
    if (linkedPayments.some((payment) => !payment)) { refundsComplete = false; continue; }
    const types = linkedPayments.map((payment) => payment?.type ?? null);
    if (types.some((type) => type === "deposit") && types.some((type) => type !== "deposit")) { refundsComplete = false; continue; }
    if (types.every((type) => type === "deposit")) {
      const next = depositRefunds + cents;
      if (!Number.isSafeInteger(next)) refundsComplete = false;
      else depositRefunds = next;
      continue;
    }
    const next = refunds + cents;
    if (!Number.isSafeInteger(next)) refundsComplete = false;
    else refunds = next;
  }

  const expenseValues = [...categories.values()];
  const expenseCents = expensesComplete ? sum(expenseValues) : null;
  const revenueCents = revenueComplete ? revenue : null;
  const refundsCents = refundsComplete ? refunds : null;
  const net = revenueCents !== null && refundsCents !== null && expenseCents !== null ? revenueCents - refundsCents - expenseCents : null;
  const expenses = expensesComplete
    ? [...categories.entries()].map(([category, cents]) => ({ category, label: categoryLabel(category), cents })).sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category))
    : [];
  return {
    month: window.month,
    from: window.from,
    to: window.to,
    through: window.through,
    revenueCents,
    unattributedRevenueCents: revenueComplete ? unattributed : null,
    depositsExcludedCents: revenueComplete ? deposits : null,
    depositRefundsExcludedCents: refundsComplete ? depositRefunds : null,
    refundsCents,
    expenseCents,
    expenses,
    netCents: net !== null && Number.isSafeInteger(net) ? net : null,
    revenueComplete,
    expensesComplete,
    refundsComplete,
    conflictingCharges: conflicting,
  };
}

export function buildOwnerPnl(input: OwnerPnlDirectory & { month: string; currentCharges: OwnerCharge[]; previousCharges: OwnerCharge[] }): OwnerPnlReport | null {
  const previous = previousMonth(input.month);
  if (!previous) return null;
  const current = buildOwnerPnlMonth({ ...input, month: input.month, charges: input.currentCharges });
  const prior = buildOwnerPnlMonth({ ...input, month: previous, charges: input.previousCharges });
  if (!current || !prior) return null;
  return {
    current,
    previous: prior,
    change: {
      revenueCents: delta(current.revenueCents, prior.revenueCents),
      unattributedRevenueCents: delta(current.unattributedRevenueCents, prior.unattributedRevenueCents),
      depositsExcludedCents: delta(current.depositsExcludedCents, prior.depositsExcludedCents),
      depositRefundsExcludedCents: delta(current.depositRefundsExcludedCents, prior.depositRefundsExcludedCents),
      refundsCents: delta(current.refundsCents, prior.refundsCents),
      expenseCents: delta(current.expenseCents, prior.expenseCents),
      netCents: delta(current.netCents, prior.netCents),
    },
  };
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

/** Client-side download. Amounts are dollars. */
export function ownerPnlCsv(report: OwnerPnlReport): string {
  const categories = new Map<string, { label: string; current: number | null; previous: number | null }>();
  for (const row of report.current.expenses) categories.set(row.category, { label: row.label, current: row.cents, previous: 0 });
  for (const row of report.previous.expenses) {
    const existing = categories.get(row.category);
    if (existing) existing.previous = row.cents;
    else categories.set(row.category, { label: row.label, current: 0, previous: row.cents });
  }
  const lines: string[][] = [
    ["Month", report.current.month],
    ["From", report.current.from],
    ["Through", report.current.through],
    ["Previous Month", report.previous.month],
    [],
    ["Line", "This Month", "Previous Month", "Change"],
    ["Revenue", centsText(report.current.revenueCents), centsText(report.previous.revenueCents), centsText(report.change.revenueCents)],
    ["Unattributed Revenue", centsText(report.current.unattributedRevenueCents), centsText(report.previous.unattributedRevenueCents), centsText(report.change.unattributedRevenueCents)],
    ["Deposits Excluded", centsText(report.current.depositsExcludedCents), centsText(report.previous.depositsExcludedCents), centsText(report.change.depositsExcludedCents)],
    ["Deposit Refunds Excluded", centsText(report.current.depositRefundsExcludedCents), centsText(report.previous.depositRefundsExcludedCents), centsText(report.change.depositRefundsExcludedCents)],
    ["Refunds", centsText(report.current.refundsCents), centsText(report.previous.refundsCents), centsText(report.change.refundsCents)],
    ["Expenses", centsText(report.current.expenseCents), centsText(report.previous.expenseCents), centsText(report.change.expenseCents)],
    ["Net", centsText(report.current.netCents), centsText(report.previous.netCents), centsText(report.change.netCents)],
    [],
    ["Category", "This Month", "Previous Month", "Change"],
    ...[...categories.values()].sort((a, b) => a.label.localeCompare(b.label)).map((row) => [
      row.label,
      centsText(row.current),
      centsText(row.previous),
      centsText(delta(row.current, row.previous)),
    ]),
  ];
  return lines.map((line) => line.map((cell) => csvField(String(cell ?? ""))).join(",")).join("\n");
}
