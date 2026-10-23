import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";
import { vehicleProfitLabel, type ProfitVehicle } from "./unified-finance-vehicles";

/**
 * Per-vehicle profitability for a half-open Eastern Time window.
 * Stripe revenue counts only when one existing payment or rental link names
 * the vehicle. Expenses reuse the vehicle_expenses and maintenance_records
 * columns: a linked service and its expense are one cost, not two.
 * Partner share uses partners.revenue_split_pct on vehicles.partner_id.
 * A missing partner or an unusable percent is "Split not configured".
 */

export type ProfitPeriodId = "this_month" | "last_month" | "last_90";

export type ProfitCharge = {
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
export type ProfitPaymentLink = {
  id: string;
  vehicleId: string | null;
  type: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
};
export type ProfitRentalLink = {
  id: string;
  vehicleId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
};
export type ProfitExpenseRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};
export type ProfitMaintenanceRow = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type ProfitPartner = { id: string; name: string | null; revenueSplitPct: number | string | null };
export type ProfitVehicleRow = ProfitVehicle & {
  partnerId: string | null;
  createdAt: string | null;
  archivedAt: string | null;
};

export type ExpenseLine = { category: string; label: string; cents: number };
export type VehicleProfitRow = {
  vehicleId: string;
  label: string;
  revenueCents: number | null;
  expenses: ExpenseLine[];
  expenseCents: number | null;
  netCents: number | null;
  daysRented: number | null;
  daysOwned: number | null;
  revenuePerRentedDayCents: number | null;
  partnerShareCents: number | null;
  partnerLabel: string | null;
  split: "configured" | "not_configured";
};
export type VehicleProfitReport = {
  period: ProfitPeriodId;
  from: string;
  to: string;
  through: string;
  rows: VehicleProfitRow[];
  unattributedStripeRevenueCents: number | null;
  conflictingCharges: number;
  depositsExcludedCents: number;
  revenueComplete: boolean;
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

const CANCELLED = new Set(["cancelled", "canceled", "void", "voided"]);

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

export function periodWindow(period: ProfitPeriodId, now: Date): { from: string; to: string; gte: number; lt: number } | null {
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

function splitBps(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(bps) && bps <= 10000 ? bps : null;
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day && day < to; day = addDays(day, 1) ?? "") days.push(day);
  return days;
}

function overlap(from: string, to: string, start: string, end: string): string[] {
  const lower = start > from ? start : from;
  const upper = end < to ? end : to;
  return lower < upper ? eachDay(lower, upper) : [];
}

type ChargeDecision = { kind: "vehicle"; vehicleId: string } | { kind: "unattributed"; conflict: boolean } | { kind: "deposit" };

function decideCharge(charge: ProfitCharge, payments: ProfitPaymentLink[], rentals: ProfitRentalLink[]): ChargeDecision {
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

type Bucket = { categories: Map<string, number>; complete: boolean };

export function buildVehicleProfitReport(input: {
  period: ProfitPeriodId;
  now: Date;
  charges: ProfitCharge[];
  payments: ProfitPaymentLink[];
  rentals: ProfitRentalLink[];
  expenses: ProfitExpenseRow[];
  maintenance: ProfitMaintenanceRow[];
  vehicles: ProfitVehicleRow[];
  partners: ProfitPartner[];
}): VehicleProfitReport | null {
  const window = periodWindow(input.period, input.now);
  if (!window) return null;
  const inWindow = (date: string) => date >= window.from && date < window.to;
  const today = etYmd(input.now);
  const tomorrow = today ? addDays(today, 1) : null;
  const clipTo = tomorrow && tomorrow < window.to ? tomorrow : window.to;
  const buckets = new Map<string, Bucket>();
  const bucket = (id: string): Bucket => {
    const existing = buckets.get(id);
    if (existing) return existing;
    const created = { categories: new Map<string, number>(), complete: true };
    buckets.set(id, created);
    return created;
  };
  const fail = (vehicleId: string | null) => {
    if (vehicleId) bucket(vehicleId).complete = false;
  };
  const add = (vehicleId: string | null, category: string | null, cents: number) => {
    if (!vehicleId) return;
    const row = bucket(vehicleId);
    const key = category?.trim() || "other";
    const next = (row.categories.get(key) ?? 0) + cents;
    if (!Number.isSafeInteger(next)) row.complete = false;
    else row.categories.set(key, next);
  };

  const linked = new Map<string, ProfitExpenseRow[]>();
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
    add(expense.vehicleId, expense.category, cents);
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
    const share = decimalSourceCents(record.companyShare);
    const amounts = expensesInside.map((link) => decimalSourceCents(link.expense.amount));
    if ((inside && share === null) || amounts.some((amount) => amount === null)) { fail(record.vehicleId); continue; }
    const linkedCents = (amounts as number[]).reduce((sum, amount) => sum + amount, 0);
    if (!Number.isSafeInteger(linkedCents)) { fail(record.vehicleId); continue; }
    if (expensesInside.length === 0) { if (inside && share) add(record.vehicleId, record.category, share); continue; }
    if (!inside || share === 0 || share === linkedCents) {
      for (const link of expensesInside) add(record.vehicleId, link.expense.category, decimalSourceCents(link.expense.amount) ?? 0);
      continue;
    }
    fail(record.vehicleId);
  }

  let unattributed = 0;
  let conflicting = 0;
  let deposits = 0;
  let revenueComplete = true;
  const revenue = new Map<string, number>();
  const takeRevenue = (vehicleId: string, cents: number) => {
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
    takeRevenue(decision.vehicleId, charge.amountCents);
  }

  const partners = new Map(input.partners.map((partner) => [partner.id, partner]));
  const rows: VehicleProfitRow[] = input.vehicles.map((vehicle) => {
    const money = buckets.get(vehicle.id) ?? { categories: new Map<string, number>(), complete: true };
    const expenseCents = money.complete ? [...money.categories.values()].reduce((sum, cents) => sum + cents, 0) : null;
    const revenueCents = revenueComplete ? revenue.get(vehicle.id) ?? 0 : null;
    const netCents = revenueCents !== null && expenseCents !== null && Number.isSafeInteger(revenueCents - expenseCents) ? revenueCents - expenseCents : null;
    const owned = ownedDays(vehicle, window.from, clipTo);
    const rented = rentedDays(vehicle.id, input.rentals, window.from, clipTo);
    const daysOwned = owned.complete ? owned.days : null;
    const daysRented = rented.complete && owned.complete ? rented.days : null;
    const revenuePerRentedDayCents = revenueCents !== null && daysRented !== null && daysRented > 0 && Number.isSafeInteger(revenueCents)
      ? Math.round(revenueCents / daysRented) : null;
    const partner = vehicle.partnerId ? partners.get(vehicle.partnerId) : undefined;
    const bps = partner ? splitBps(partner.revenueSplitPct) : null;
    const partnerShareCents = bps !== null && revenueCents !== null ? share(revenueCents, bps) : null;
    const expenses = money.complete
      ? [...money.categories.entries()].map(([category, cents]) => ({ category, label: categoryLabel(category), cents })).sort((a, b) => a.label.localeCompare(b.label))
      : [];
    return {
      vehicleId: vehicle.id,
      label: vehicleProfitLabel(vehicle),
      revenueCents,
      expenses,
      expenseCents: expenseCents !== null && Number.isSafeInteger(expenseCents) ? expenseCents : null,
      netCents,
      daysRented,
      daysOwned,
      revenuePerRentedDayCents,
      partnerShareCents,
      partnerLabel: bps !== null && partner ? `${partner.name?.trim() || "Partner"} ${String(partner.revenueSplitPct).trim()}%` : null,
      split: bps !== null ? "configured" : "not_configured",
    };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));
  const through = addDays(window.to, -1);
  if (!through) return null;
  return {
    period: input.period, from: window.from, to: window.to, through, rows,
    unattributedStripeRevenueCents: revenueComplete ? unattributed : null,
    conflictingCharges: conflicting,
    depositsExcludedCents: deposits,
    revenueComplete,
  };
}

function share(revenueCents: number, bps: number): number | null {
  const product = revenueCents * bps;
  if (!Number.isSafeInteger(product)) return null;
  return Math.round(product / 10000);
}
function ownedDays(vehicle: ProfitVehicleRow, from: string, to: string): { days: number; complete: boolean } {
  const created = calendarDay(vehicle.createdAt);
  if (created.invalid || !created.date) return { days: 0, complete: false };
  const archived = calendarDay(vehicle.archivedAt);
  if (archived.invalid) return { days: 0, complete: false };
  const end = archived.date ? addDays(archived.date, 1) : to;
  if (!end) return { days: 0, complete: false };
  return { days: overlap(from, to, created.date, end).length, complete: true };
}
function rentedDays(vehicleId: string, rentals: ProfitRentalLink[], from: string, to: string): { days: number; complete: boolean } {
  const days = new Set<string>();
  for (const rental of rentals) {
    if (rental.vehicleId !== vehicleId) continue;
    if (CANCELLED.has((rental.status ?? "").toLowerCase())) continue;
    const start = calendarDay(rental.startDate);
    if (start.invalid || !start.date) return { days: 0, complete: false };
    let end = rental.endDate;
    if (!end) {
      if ((rental.status ?? "").toLowerCase() === "active") end = to;
      else return { days: 0, complete: false };
    }
    const endDay = calendarDay(end);
    if (endDay.invalid || !endDay.date) return { days: 0, complete: false };
    for (const day of overlap(from, to, start.date, endDay.date)) days.add(day);
  }
  return { days: days.size, complete: true };
}
