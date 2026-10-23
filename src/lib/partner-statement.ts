import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";
import { vehicleProfitLabel, type ProfitVehicle } from "./unified-finance-vehicles";

/**
 * Read-only partner statement for a half-open Eastern Time window.
 * Revenue uses the Vehicle Profitability charge rules: a succeeded USD charge
 * counts only when one payment or rental link names one vehicle, deposits are
 * excluded, and a charge with no single vehicle is unattributed. Unattributed
 * money is shown apart from the partner and is not in the share. A charge that
 * names another partner's vehicle is omitted. Expenses reuse vehicle_expenses
 * and maintenance_records, and a linked service and its expense are one cost.
 * Partner share is partners.revenue_split_pct of attributed revenue.
 * A missing or unusable percent is "Split not configured".
 */

export type PartnerStatementPeriod = "this_month" | "last_month" | "last_90";

export const PARTNER_STATEMENT_PERIODS: readonly { id: PartnerStatementPeriod; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_90", label: "90 Days" },
];

export type PartnerCharge = {
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
export type PartnerPaymentLink = {
  id: string;
  vehicleId: string | null;
  type: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
};
export type PartnerRentalLink = {
  id: string;
  vehicleId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
};
export type PartnerExpenseRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};
export type PartnerMaintenanceRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type PartnerRow = { id: string; name: string | null; revenueSplitPct: number | string | null };
export type PartnerVehicleRow = ProfitVehicle & { partnerId: string | null };

export type PartnerStatementDirectory = {
  vehicles: PartnerVehicleRow[];
  partners: PartnerRow[];
  expenses: PartnerExpenseRow[];
  maintenance: PartnerMaintenanceRow[];
  rentals: PartnerRentalLink[];
  payments: PartnerPaymentLink[];
};

export type PartnerOption = { id: string; name: string };
export type PartnerStatementVehicle = {
  vehicleId: string;
  label: string;
  revenueCents: number | null;
  expenseCents: number | null;
  netCents: number | null;
  partnerShareCents: number | null;
};
export type PartnerStatementResponse =
  | { status: "disabled"; partners: []; statement: null }
  | { status: "unavailable"; reason: string; partners: PartnerOption[]; statement: null }
  | { status: "ready"; partners: PartnerOption[]; statement: PartnerStatement | null };

export type PartnerStatement = {
  partnerId: string;
  partnerName: string;
  period: PartnerStatementPeriod;
  from: string;
  to: string;
  through: string;
  split: "configured" | "not_configured";
  splitLabel: string;
  vehicles: PartnerStatementVehicle[];
  revenueCents: number | null;
  expenseCents: number | null;
  netCents: number | null;
  partnerShareCents: number | null;
  unattributedStripeRevenueCents: number | null;
  depositsExcludedCents: number | null;
  conflictingCharges: number;
  revenueComplete: boolean;
};

const SPLIT_MISSING = "Split not configured";

export function periodLabel(period: PartnerStatementPeriod): string {
  return PARTNER_STATEMENT_PERIODS.find((item) => item.id === period)?.label ?? "This Month";
}

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function addDays(ymd: string, days: number): string | null {
  if (!validFinanceDate(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  const text = next.toISOString().slice(0, 10);
  return validFinanceDate(text) ? text : null;
}

/** Midnight at the start of an Eastern Time calendar date, as unix seconds. */
export function etMidnightUnix(ymd: string): number | null {
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

export function periodWindow(period: PartnerStatementPeriod, now: Date): { from: string; to: string; gte: number; lt: number } | null {
  const today = etYmd(now);
  if (!today) return null;
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
  const previousMonth = month === 1 ? `${year! - 1}-12-01` : `${year}-${String(month! - 1).padStart(2, "0")}-01`;
  const from = period === "this_month" ? monthStart : period === "last_month" ? previousMonth : addDays(today, -89);
  const to = period === "this_month" ? nextMonth : period === "last_month" ? monthStart : addDays(today, 1);
  if (!from || !to) return null;
  const gte = etMidnightUnix(from);
  const lt = etMidnightUnix(to);
  if (gte === null || lt === null || lt <= gte) return null;
  return { from, to, gte, lt };
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

/** Basis points, at most two decimal places, from 0 through 100. */
export function splitBps(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(bps) && bps <= 10000 ? bps : null;
}

function share(revenueCents: number, bps: number): number | null {
  const product = revenueCents * bps;
  if (!Number.isSafeInteger(product)) return null;
  return Math.round(product / 10000);
}

type ChargeDecision = { kind: "vehicle"; vehicleId: string } | { kind: "unattributed"; conflict: boolean } | { kind: "deposit" };

function decideCharge(charge: PartnerCharge, payments: PartnerPaymentLink[], rentals: PartnerRentalLink[]): ChargeDecision {
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

type Bucket = { cents: number; complete: boolean };

export function partnerOptions(partners: PartnerRow[]): PartnerOption[] {
  return partners
    .filter((partner) => partner.id.trim())
    .map((partner) => ({ id: partner.id, name: partner.name?.trim() || "Partner" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function buildPartnerStatement(input: PartnerStatementDirectory & {
  partnerId: string;
  period: PartnerStatementPeriod;
  now: Date;
  charges: PartnerCharge[];
}): PartnerStatement | null {
  const window = periodWindow(input.period, input.now);
  const through = window ? addDays(window.to, -1) : null;
  if (!window || !through) return null;
  const inWindow = (date: string) => date >= window.from && date < window.to;
  const partnerVehicles = input.vehicles.filter((vehicle) => vehicle.partnerId === input.partnerId);
  const partner = input.partners.find((row) => row.id === input.partnerId);
  const bps = partner ? splitBps(partner.revenueSplitPct) : null;
  const buckets = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    const existing = buckets.get(id);
    if (existing) return existing;
    const created = { cents: 0, complete: true };
    buckets.set(id, created);
    return created;
  };
  const fail = (vehicleId: string | null) => {
    if (vehicleId && partnerVehicles.some((vehicle) => vehicle.id === vehicleId)) bucket(vehicleId).complete = false;
  };
  const add = (vehicleId: string | null, cents: number) => {
    if (!vehicleId || !partnerVehicles.some((vehicle) => vehicle.id === vehicleId)) return;
    const row = bucket(vehicleId);
    const next = row.cents + cents;
    if (!Number.isSafeInteger(next)) row.complete = false;
    else row.cents = next;
  };

  const linked = new Map<string, PartnerExpenseRow[]>();
  for (const expense of input.expenses) {
    if (!expense.maintenanceRecordId) continue;
    const rows = linked.get(expense.maintenanceRecordId) ?? [];
    rows.push(expense);
    linked.set(expense.maintenanceRecordId, rows);
  }
  for (const expense of input.expenses) {
    if (expense.maintenanceRecordId) continue;
    const place = placed([expense.incurredOn]);
    if (place.invalid || !place.date) { fail(expense.vehicleId); continue; }
    if (!inWindow(place.date)) continue;
    const cents = decimalSourceCents(expense.amount);
    if (cents === null || !expense.vehicleId) { fail(expense.vehicleId); continue; }
    add(expense.vehicleId, cents);
  }
  const seenMaintenance = new Set(input.maintenance.map((record) => record.id));
  for (const [recordId, rows] of linked) {
    if (seenMaintenance.has(recordId)) continue;
    for (const expense of rows) fail(expense.vehicleId);
  }
  for (const record of input.maintenance) {
    const place = placed([record.performedOn, record.completedAt, record.createdAt]);
    const links = (linked.get(record.id) ?? []).map((expense) => ({ expense, place: placed([expense.incurredOn]) }));
    if (links.some((link) => link.place.invalid || !link.place.date)) fail(record.vehicleId);
    if (place.invalid || !place.date) { fail(record.vehicleId); continue; }
    const inside = inWindow(place.date);
    const expensesInside = links.filter((link) => link.place.date && inWindow(link.place.date));
    if (!inside && expensesInside.length === 0) continue;
    if (!record.vehicleId || expensesInside.some((link) => link.expense.vehicleId !== record.vehicleId)) {
      fail(record.vehicleId);
      continue;
    }
    const shareCents = decimalSourceCents(record.companyShare);
    const amounts = expensesInside.map((link) => decimalSourceCents(link.expense.amount));
    if ((inside && shareCents === null) || amounts.some((amount) => amount === null)) { fail(record.vehicleId); continue; }
    const linkedCents = (amounts as number[]).reduce((sum, amount) => sum + amount, 0);
    if (!Number.isSafeInteger(linkedCents)) { fail(record.vehicleId); continue; }
    if (expensesInside.length === 0) { if (inside && shareCents) add(record.vehicleId, shareCents); continue; }
    if (!inside || shareCents === 0 || shareCents === linkedCents) {
      for (const link of expensesInside) add(record.vehicleId, decimalSourceCents(link.expense.amount) ?? 0);
      continue;
    }
    fail(record.vehicleId);
  }

  let unattributed = 0;
  let conflicting = 0;
  let deposits = 0;
  let revenueComplete = true;
  const revenue = new Map<string, number>();
  const take = (vehicleId: string, cents: number) => {
    const next = (revenue.get(vehicleId) ?? 0) + cents;
    if (!Number.isSafeInteger(next)) revenueComplete = false;
    else revenue.set(vehicleId, next);
  };
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
    const vehicle = input.vehicles.find((row) => row.id === decision.vehicleId);
    if (vehicle?.partnerId === input.partnerId) take(decision.vehicleId, charge.amountCents);
  }

  const vehicles: PartnerStatementVehicle[] = partnerVehicles.map((vehicle) => {
    const money = buckets.get(vehicle.id) ?? { cents: 0, complete: true };
    const expenseCents = money.complete && Number.isSafeInteger(money.cents) ? money.cents : null;
    const revenueCents = revenueComplete ? revenue.get(vehicle.id) ?? 0 : null;
    const netCents = revenueCents !== null && expenseCents !== null && Number.isSafeInteger(revenueCents - expenseCents)
      ? revenueCents - expenseCents : null;
    const partnerShareCents = bps !== null && revenueCents !== null ? share(revenueCents, bps) : null;
    return { vehicleId: vehicle.id, label: vehicleProfitLabel(vehicle), revenueCents, expenseCents, netCents, partnerShareCents };
  });
  vehicles.sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));

  const sum = (values: Array<number | null>): number | null => {
    if (values.some((value) => value === null)) return null;
    const total = (values as number[]).reduce((acc, value) => acc + value, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  return {
    partnerId: input.partnerId,
    partnerName: partner?.name?.trim() || "Partner",
    period: input.period,
    from: window.from,
    to: window.to,
    through,
    split: bps !== null ? "configured" : "not_configured",
    splitLabel: bps !== null && partner ? `${String(partner.revenueSplitPct).trim()}%` : SPLIT_MISSING,
    vehicles,
    revenueCents: sum(vehicles.map((vehicle) => vehicle.revenueCents)),
    expenseCents: sum(vehicles.map((vehicle) => vehicle.expenseCents)),
    netCents: sum(vehicles.map((vehicle) => vehicle.netCents)),
    partnerShareCents: sum(vehicles.map((vehicle) => vehicle.partnerShareCents)),
    unattributedStripeRevenueCents: revenueComplete ? unattributed : null,
    depositsExcludedCents: revenueComplete ? deposits : null,
    conflictingCharges: conflicting,
    revenueComplete,
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

/** Client-side download. Money is dollars. Unattributed is below the partner total. */
export function partnerStatementCsv(statement: PartnerStatement): string {
  const lines = [
    ["Partner", statement.partnerName],
    ["Period", periodLabel(statement.period)],
    ["From", statement.from],
    ["Through", statement.through],
    ["Split", statement.splitLabel],
    [],
    ["Vehicle", "Revenue", "Expenses", "Net", "Partner Share"],
    ...statement.vehicles.map((vehicle) => [
      vehicle.label,
      centsText(vehicle.revenueCents),
      centsText(vehicle.expenseCents),
      centsText(vehicle.netCents),
      centsText(vehicle.partnerShareCents),
    ]),
    ["Total", centsText(statement.revenueCents), centsText(statement.expenseCents), centsText(statement.netCents), centsText(statement.partnerShareCents)],
    [],
    ["Unattributed Revenue", centsText(statement.unattributedStripeRevenueCents), "", "", ""],
    ["Deposits Excluded", centsText(statement.depositsExcludedCents), "", "", ""],
  ];
  return lines.map((line) => line.map((cell) => csvField(String(cell ?? ""))).join(",")).join("\n");
}
