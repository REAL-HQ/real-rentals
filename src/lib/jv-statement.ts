import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";
import { vehicleProfitLabel, type ProfitVehicle } from "./unified-finance-vehicles";

/**
 * Read-only partner statement for one vehicle and one Eastern Time period.
 *
 * Income matches Monthly Owner P&L (#163). A succeeded USD Stripe charge is
 * kept. A recorded Cash App, Zelle, Venmo, wire, cash, or other payment is
 * the same transaction when they share a PaymentIntent id, a charge id, an
 * invoice id, or metadata paymentIds. Amounts are never compared. The charge
 * is kept. A Stripe-method row with none of those references is unmatched,
 * excluded, and the period is Partial. Deposits stay off the split.
 *
 * Expenses count each vehicle_expenses row once. A maintenance record linked
 * by maintenance_record_id is not added again. Company share and partner
 * share are used only when they add up to that one cost. An unlinked service
 * uses the same rule against total_cost. A blank company share is total cost
 * minus partner share. Recorded zero shares count the one cost as the company
 * share. Live public.vehicle_pl sums every expense and then also adds
 * company_share or total_cost, so a linked service can be counted twice.
 * This module does not change that function and does not write company_share.
 *
 * PARTNER_REVENUE_BASE is the only switch for which payment types enter the
 * split. It stays null until the owner chooses rent only or all revenue types.
 *
 * Partner income is partners.revenue_split_pct of net income. The company
 * keeps the remainder. A missing percent is "Split Not Configured".
 * Stripe processing fees are not in this split.
 */

/**
 * Open owner question. Do not set this until the owner chooses.
 * "rent" counts rent only, as portal partner earnings does.
 * "all" counts rent, late_fee, other, toll, damage, and fee.
 * null counts rent, which both choices include, and withholds income and the
 * split when this vehicle has another revenue type in the window.
 */
export const PARTNER_REVENUE_BASE: "rent" | "all" | null = null;

export const VEHICLE_PL_DOUBLE_COUNT_NOTE =
  "Live vehicle P&L sums every vehicle expense and also adds maintenance company share or total cost, so a linked service can be counted twice. This statement counts each expense once.";

export const OPERATING_EXPENSE_NOTE =
  "A vehicle expense that is not linked to a service has no partner share. The amount is a company cost and is counted once.";

export type JvPeriod = "this_month" | "last_month" | "last_90";

export const JV_PERIODS: readonly { id: JvPeriod; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_90", label: "90 Days" },
];

export type JvIncomeSource = "stripe" | "cash_app" | "zelle" | "venmo" | "wire" | "cash" | "other";

export const JV_INCOME_SOURCES: readonly { source: JvIncomeSource; label: string }[] = [
  { source: "stripe", label: "Stripe" },
  { source: "cash_app", label: "Cash App" },
  { source: "zelle", label: "Zelle" },
  { source: "venmo", label: "Venmo" },
  { source: "wire", label: "Wire" },
  { source: "cash", label: "Cash" },
  { source: "other", label: "Other" },
];

export type JvCharge = {
  id: string;
  customerId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  amountCents: number;
  currency: string;
  succeeded: boolean;
  created: number;
  /** Payment row ids from charge metadata. Empty when the charge did not name them. */
  paymentIds?: string[];
};

export type JvPayment = {
  id: string;
  vehicleId: string | null;
  rentalId: string | null;
  type: string | null;
  status: string | null;
  amount: string | number | null;
  paymentMethod: string | null;
  paidDate: string | null;
  refundedAmount: string | number | null;
  refundedAt: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
};

export type JvRental = {
  id: string;
  vehicleId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
};

export type JvExpense = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};

export type JvMaintenance = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: string | number | null;
  partnerShare: string | number | null;
  totalCost: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type JvPartner = {
  id: string;
  name: string | null;
  revenueSplitPct: number | string | null;
};
export type JvVehicle = ProfitVehicle & { partnerId: string | null };

export type JvRefund = {
  id: string;
  amount: string | number | null;
  status: string | null;
  createdAt: string | null;
  paymentIds: string[];
};

export type JvDirectory = {
  vehicles: JvVehicle[];
  partners: JvPartner[];
  expenses: JvExpense[];
  maintenance: JvMaintenance[];
  rentals: JvRental[];
  payments: JvPayment[];
  refunds: JvRefund[];
};

export type JvSourceLine = { source: JvIncomeSource; label: string; cents: number };
export type JvUnmatched = { id: string; method: string | null; reason: string };
export type JvCoverage = "complete" | "partial" | "unavailable";

export type JvVehicleOption = { id: string; label: string; partnerName: string | null };

export type JvStatement = {
  vehicleId: string;
  vehicleLabel: string;
  partnerId: string | null;
  partnerName: string | null;
  period: JvPeriod;
  from: string;
  to: string;
  through: string;
  split: "configured" | "not_configured";
  splitLabel: string;
  sources: JvSourceLine[];
  incomeCents: number | null;
  refundsCents: number | null;
  netIncomeCents: number | null;
  companyIncomeCents: number | null;
  partnerIncomeCents: number | null;
  companyExpenseCents: number | null;
  partnerExpenseCents: number | null;
  expenseCents: number | null;
  companyNetCents: number | null;
  partnerNetCents: number | null;
  depositsExcludedCents: number | null;
  depositRefundsExcludedCents: number | null;
  unattributedStripeCents: number | null;
  conflictingCharges: number;
  unmatched: JvUnmatched[];
  notes: string[];
  coverage: JvCoverage;
  incomeComplete: boolean;
  expensesComplete: boolean;
  refundsComplete: boolean;
};

export type JvStatementResponse =
  | { status: "disabled"; vehicles: []; statement: null }
  | { status: "unavailable"; reason: string; vehicles: JvVehicleOption[]; statement: null }
  | { status: "ready"; vehicles: JvVehicleOption[]; statement: JvStatement | null };

const SPLIT_MISSING = "Split Not Configured";
const UNMATCHED_REASON = "No Payment Intent, charge, invoice, or payment reference.";
const REFUND_SKIP = new Set(["pending", "failed", "canceled", "cancelled"]);
const COLLECTED = new Set(["paid", "refunded"]);
const ALL_REVENUE_TYPES = new Set(["rent", "late_fee", "other", "toll", "damage", "fee"]);
const DISPUTED_REVENUE_TYPES = new Set(["late_fee", "other", "toll", "damage", "fee"]);
const REVENUE_BASE_NOTE =
  "Partner revenue base is not chosen. Rent only, as on partner earnings, and all revenue types (late fee, toll, damage, fee, and other) are both open. This vehicle has one of those types in the period, or its date cannot be placed, so income and the split are withheld.";
const CUSTOMER_ONLY_NOTE =
  "Partner revenue base is not chosen. A Stripe charge is tied only to the customer, not to a rent payment, so income and the split are withheld.";

function acceptedRevenueTypes(): ReadonlySet<string> {
  if (PARTNER_REVENUE_BASE === "rent") return new Set(["rent"]);
  if (PARTNER_REVENUE_BASE === "all") return ALL_REVENUE_TYPES;
  return new Set(["rent"]);
}
const STRIPE_METHODS = new Set([
  "stripe",
  "card",
  "credit",
  "credit_card",
  "debit",
  "debit_card",
  "visa",
  "mastercard",
  "amex",
  "american_express",
  "apple_pay",
]);
const RECORDED_SOURCES: Record<string, JvIncomeSource> = {
  cash_app: "cash_app",
  cashapp: "cash_app",
  cash_app_pay: "cash_app",
  zelle: "zelle",
  venmo: "venmo",
  wire: "wire",
  wire_transfer: "wire",
  domestic_wire: "wire",
  cash: "cash",
};

const CATEGORY_LABELS: Record<string, string> = {
  registration: "Registration",
  insurance: "Insurance",
  maintenance: "Maintenance",
  repair: "Repair",
  tires: "Tires",
  fuel: "Fuel",
  cleaning: "Cleaning",
  towing: "Towing",
  parking: "Parking",
  tolls: "Tolls",
  finance: "Finance",
  purchase: "Purchase",
  gps: "GPS",
  other: "Other",
  routine: "Routine",
};

export function periodLabel(period: JvPeriod): string {
  return JV_PERIODS.find((item) => item.id === period)?.label ?? "This Month";
}

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
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
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second"),
    );
    return asUtc - instant;
  };
  let utc = utcMidnight - offset(utcMidnight);
  const again = offset(utc);
  if (again !== offset(utcMidnight)) utc = utcMidnight - again;
  const seconds = Math.floor(utc / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function periodWindow(
  period: JvPeriod,
  now: Date,
): { from: string; to: string; through: string; gte: number; lt: number } | null {
  const today = etYmd(now);
  if (!today) return null;
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth =
    month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
  const previousMonth =
    month === 1 ? `${year! - 1}-12-01` : `${year}-${String(month! - 1).padStart(2, "0")}-01`;
  const from =
    period === "this_month"
      ? monthStart
      : period === "last_month"
        ? previousMonth
        : addDays(today, -89);
  const to =
    period === "this_month" ? nextMonth : period === "last_month" ? monthStart : addDays(today, 1);
  if (!from || !to) return null;
  const through = addDays(to, -1);
  const gte = etMidnightUnix(from);
  const lt = etMidnightUnix(to);
  if (!through || gte === null || lt === null || lt <= gte) return null;
  return { from, to, through, gte, lt };
}

/** Basis points, at most two decimal places, from 0 through 100. The partner's share of net income. */
export function splitBps(value: number | string | null | undefined): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(bps) && bps <= 10000 ? bps : null;
}

function shareOf(cents: number, bps: number): number | null {
  const product = cents * bps;
  if (!Number.isSafeInteger(product)) return null;
  const share = Math.round(product / 10000);
  return Number.isSafeInteger(share) ? share : null;
}

function normalizeMethod(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function referenceText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function paymentSource(payment: JvPayment): JvIncomeSource {
  const method = normalizeMethod(payment.paymentMethod);
  const named = RECORDED_SOURCES[method];
  if (named) return named;
  if (STRIPE_METHODS.has(method)) return "stripe";
  if (!method && (referenceText(payment.paymentIntentId) || referenceText(payment.invoiceId)))
    return "stripe";
  return "other";
}

function readCents(value: string | number | null | undefined): {
  blank: boolean;
  invalid: boolean;
  cents: number | null;
} {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === ""))
    return { blank: true, invalid: false, cents: null };
  const cents = decimalSourceCents(value);
  if (cents === null) return { blank: false, invalid: true, cents: null };
  return { blank: false, invalid: false, cents };
}

function centsText(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "an unreadable amount";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function categoryLabel(category: string | null): string {
  if (!category?.trim()) return "Uncategorized";
  const known = CATEGORY_LABELS[category.trim().toLowerCase()];
  if (known) return known;
  return category
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function calendarDay(value: string | null | undefined): { date: string | null; invalid: boolean } {
  if (value === null || value === undefined || value === "") return { date: null, invalid: false };
  if (validFinanceDate(value)) return { date: value, invalid: false };
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    const date = Number.isNaN(parsed.getTime()) ? null : etYmd(parsed);
    return date && validFinanceDate(date)
      ? { date, invalid: false }
      : { date: null, invalid: true };
  }
  return { date: null, invalid: true };
}

function placed(candidates: (string | null | undefined)[]): {
  date: string | null;
  invalid: boolean;
} {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const day = calendarDay(candidate);
    return day.invalid ? { date: null, invalid: true } : { date: day.date, invalid: false };
  }
  return { date: null, invalid: true };
}

function paymentVehicleId(payment: JvPayment, rentals: JvRental[]): string | null {
  if (payment.rentalId) {
    const rental = rentals.find((row) => row.id === payment.rentalId);
    if (rental?.vehicleId) return rental.vehicleId;
  }
  return payment.vehicleId ?? null;
}

function sharesReference(payment: JvPayment, charge: JvCharge): boolean {
  const intent = referenceText(payment.paymentIntentId);
  const invoice = referenceText(payment.invoiceId);
  if (intent && (intent === referenceText(charge.paymentIntentId) || intent === charge.id))
    return true;
  if (invoice && (invoice === referenceText(charge.invoiceId) || invoice === charge.id))
    return true;
  return (charge.paymentIds ?? []).some((id) => id === payment.id);
}

function hasAuthoritativeReference(payment: JvPayment, charges: JvCharge[]): boolean {
  if (referenceText(payment.paymentIntentId) || referenceText(payment.invoiceId)) return true;
  return charges.some((charge) => (charge.paymentIds ?? []).some((id) => id === payment.id));
}

type ChargeDecision =
  | { kind: "vehicle"; vehicleId: string; basis: "rent" | "non_rent" | "customer" }
  | { kind: "deposit"; vehicleId: string | null }
  | { kind: "unattributed"; conflict: boolean };

function revenueBasis(rows: JvPayment[]): "rent" | "non_rent" {
  const types = rows
    .filter((payment) => !isDeposit(payment))
    .map((payment) => (payment.type ?? "").trim().toLowerCase());
  return types.length > 0 && types.every((type) => type === "rent") ? "rent" : "non_rent";
}

function isDeposit(payment: JvPayment): boolean {
  return (payment.type ?? "").trim().toLowerCase() === "deposit";
}

function decideCharge(
  charge: JvCharge,
  payments: JvPayment[],
  rentals: JvRental[],
): ChargeDecision {
  const namedIds = (charge.paymentIds ?? []).filter(Boolean);
  if (namedIds.length) {
    const named = namedIds.map((id) => payments.find((payment) => payment.id === id));
    if (named.every((payment) => payment)) {
      const rows = named as JvPayment[];
      const vehicles = new Set(
        rows
          .map((payment) => paymentVehicleId(payment, rentals))
          .filter((id): id is string => Boolean(id)),
      );
      if (rows.every(isDeposit)) {
        if (vehicles.size > 1) return { kind: "unattributed", conflict: true };
        return { kind: "deposit", vehicleId: vehicles.size === 1 ? [...vehicles][0]! : null };
      }
      if (rows.some(isDeposit)) return { kind: "unattributed", conflict: true };
      if (vehicles.size === 1)
        return { kind: "vehicle", vehicleId: [...vehicles][0]!, basis: revenueBasis(rows) };
      if (vehicles.size > 1) return { kind: "unattributed", conflict: true };
    }
  }
  const paymentHits = payments.filter(
    (payment) =>
      payment.vehicleId &&
      ((charge.paymentIntentId && payment.paymentIntentId === charge.paymentIntentId) ||
        (charge.invoiceId && payment.invoiceId === charge.invoiceId) ||
        (charge.subscriptionId && payment.subscriptionId === charge.subscriptionId)),
  );
  const subscriptionHits = charge.subscriptionId
    ? rentals.filter(
        (rental) => rental.vehicleId && rental.subscriptionId === charge.subscriptionId,
      )
    : [];
  const ids = new Set<string>([
    ...paymentHits.map((payment) => payment.vehicleId as string),
    ...subscriptionHits.map((rental) => rental.vehicleId as string),
  ]);
  if (paymentHits.length || subscriptionHits.length) {
    if (ids.size !== 1) return { kind: "unattributed", conflict: true };
    const vehicleId = [...ids][0]!;
    if (paymentHits.some(isDeposit) && paymentHits.some((payment) => !isDeposit(payment)))
      return { kind: "unattributed", conflict: true };
    if (paymentHits.length > 0 && paymentHits.every(isDeposit))
      return { kind: "deposit", vehicleId };
    return {
      kind: "vehicle",
      vehicleId,
      basis: paymentHits.length > 0 ? revenueBasis(paymentHits) : "rent",
    };
  }
  const customerHits = charge.customerId
    ? rentals.filter((rental) => rental.vehicleId && rental.customerId === charge.customerId)
    : [];
  const customers = new Set(customerHits.map((rental) => rental.vehicleId as string));
  if (customers.size > 1) return { kind: "unattributed", conflict: true };
  if (customers.size === 1)
    return { kind: "vehicle", vehicleId: [...customers][0]!, basis: "customer" };
  return { kind: "unattributed", conflict: false };
}

export function jvVehicleOptions(input: {
  vehicles: JvVehicle[];
  partners: JvPartner[];
}): JvVehicleOption[] {
  const names = new Map(
    input.partners.map((partner) => [partner.id, partner.name?.trim() || "Partner"]),
  );
  return input.vehicles
    .filter((vehicle) => vehicle.id.trim())
    .map((vehicle) => ({
      id: vehicle.id,
      label: vehicleProfitLabel(vehicle),
      partnerName: vehicle.partnerId ? (names.get(vehicle.partnerId) ?? null) : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function buildJvStatement(
  input: JvDirectory & {
    vehicleId: string;
    period: JvPeriod;
    now: Date;
    charges: JvCharge[];
  },
): JvStatement | null {
  const window = periodWindow(input.period, input.now);
  if (!window) return null;
  const vehicle = input.vehicles.find((row) => row.id === input.vehicleId);
  if (!vehicle) return null;
  const partner = vehicle.partnerId
    ? (input.partners.find((row) => row.id === vehicle.partnerId) ?? null)
    : null;
  const bps = partner ? splitBps(partner.revenueSplitPct) : null;
  const inWindow = (date: string) => date >= window.from && date < window.to;
  const notes: string[] = [VEHICLE_PL_DOUBLE_COUNT_NOTE];
  const serviceName = (record: JvMaintenance) =>
    `${categoryLabel(record.category)} for ${vehicleProfitLabel(vehicle)}`;

  let expensesComplete = true;
  let companyExpense = 0;
  let partnerExpense = 0;
  let sawOperating = false;
  const addSplit = (company: number, partnerShare: number) => {
    const nextCompany = companyExpense + company;
    const nextPartner = partnerExpense + partnerShare;
    if (!Number.isSafeInteger(nextCompany) || !Number.isSafeInteger(nextPartner))
      expensesComplete = false;
    else {
      companyExpense = nextCompany;
      partnerExpense = nextPartner;
    }
  };

  const linked = new Map<string, JvExpense[]>();
  for (const expense of input.expenses) {
    if (!expense.maintenanceRecordId) continue;
    const rows = linked.get(expense.maintenanceRecordId) ?? [];
    rows.push(expense);
    linked.set(expense.maintenanceRecordId, rows);
  }
  for (const expense of input.expenses) {
    if (expense.maintenanceRecordId) continue;
    if (expense.vehicleId !== input.vehicleId) continue;
    const place = placed([expense.incurredOn]);
    if (place.invalid || !place.date) {
      expensesComplete = false;
      continue;
    }
    if (!inWindow(place.date)) continue;
    const cents = decimalSourceCents(expense.amount);
    if (cents === null) {
      expensesComplete = false;
      continue;
    }
    addSplit(cents, 0);
    sawOperating = true;
  }
  if (sawOperating) notes.push(OPERATING_EXPENSE_NOTE);

  const seenMaintenance = new Set(input.maintenance.map((record) => record.id));
  for (const [recordId, rows] of linked) {
    if (seenMaintenance.has(recordId)) continue;
    if (rows.some((row) => row.vehicleId === input.vehicleId)) {
      expensesComplete = false;
      notes.push(
        "A vehicle expense points at a service record that was not loaded. That expense was not counted.",
      );
    }
  }

  for (const record of input.maintenance) {
    const place = placed([record.performedOn, record.completedAt, record.createdAt]);
    const links = (linked.get(record.id) ?? []).map((expense) => ({
      expense,
      place: placed([expense.incurredOn]),
    }));
    const thisVehicle = record.vehicleId === input.vehicleId;
    const serviceInWindow = Boolean(place.date && inWindow(place.date) && thisVehicle);
    const serviceDateUnreadable = thisVehicle && (place.invalid || !place.date);
    const vehicleLinks = links.filter((link) => link.expense.vehicleId === input.vehicleId);
    const expensesInside = vehicleLinks.filter(
      (link) => link.place.date && inWindow(link.place.date),
    );
    const expenseDateUnreadable = vehicleLinks.some(
      (link) => link.place.invalid || !link.place.date,
    );
    if (
      !serviceInWindow &&
      !serviceDateUnreadable &&
      expensesInside.length === 0 &&
      !expenseDateUnreadable
    ) {
      continue;
    }
    if (serviceDateUnreadable || expenseDateUnreadable) {
      expensesComplete = false;
      continue;
    }
    const inside = serviceInWindow;
    const name = serviceName(record);
    if (
      links.some((link) => link.expense.vehicleId !== record.vehicleId) ||
      (inside && record.vehicleId !== input.vehicleId)
    ) {
      expensesComplete = false;
      notes.push(
        `The service and the linked expense name different vehicles for ${name}. Nothing was added.`,
      );
      continue;
    }
    if (expensesInside.length === 0) {
      if (links.length > 0) {
        if (vehicleLinks.length !== 1) {
          expensesComplete = false;
          notes.push(
            `More than one expense is linked to ${name}. Those amounts were not added on top of the service, and the split was withheld.`,
          );
          continue;
        }
        continue;
      }
      const company = readCents(record.companyShare);
      const partnerShare = readCents(record.partnerShare);
      const total = readCents(record.totalCost);
      const sharesAreZero =
        !company.invalid &&
        !company.blank &&
        company.cents === 0 &&
        !partnerShare.invalid &&
        !partnerShare.blank &&
        partnerShare.cents === 0;
      if (sharesAreZero) {
        if (total.invalid || total.blank || total.cents === null) {
          expensesComplete = false;
          notes.push(
            `Partner share was not recorded for ${name}. Total cost could not be read, so the split was withheld.`,
          );
          continue;
        }
        addSplit(total.cents, 0);
        notes.push(
          `Partner share was not recorded for ${name}. The service cost is the company share and is counted once.`,
        );
        continue;
      }
      if (company.blank) {
        if (
          partnerShare.invalid ||
          partnerShare.blank ||
          partnerShare.cents === null ||
          total.invalid ||
          total.blank ||
          total.cents === null ||
          partnerShare.cents > total.cents
        ) {
          expensesComplete = false;
          notes.push(
            `Company share was blank for ${name}. Total cost minus partner share could not be used, so the split was withheld.`,
          );
          continue;
        }
        addSplit(total.cents - partnerShare.cents, partnerShare.cents);
        notes.push(
          `Company share was blank for ${name}. Total cost minus partner share was used once.`,
        );
        continue;
      }
      if (
        company.invalid ||
        company.cents === null ||
        partnerShare.invalid ||
        partnerShare.blank ||
        partnerShare.cents === null ||
        total.invalid ||
        total.blank ||
        total.cents === null ||
        company.cents + partnerShare.cents !== total.cents
      ) {
        expensesComplete = false;
        notes.push(
          `Company share and partner share do not add up to total cost for ${name}. The split was withheld.`,
        );
        continue;
      }
      addSplit(company.cents, partnerShare.cents);
      continue;
    }
    if (vehicleLinks.length !== 1) {
      expensesComplete = false;
      notes.push(
        `More than one expense is linked to ${name}. Those amounts were not added on top of the service, and the split was withheld.`,
      );
      continue;
    }
    const expense = expensesInside[0]!.expense;
    const amount = decimalSourceCents(expense.amount);
    const company = readCents(record.companyShare);
    const partnerShare = readCents(record.partnerShare);
    if (
      amount === null ||
      company.invalid ||
      partnerShare.invalid ||
      company.blank ||
      partnerShare.blank ||
      company.cents === null ||
      partnerShare.cents === null
    ) {
      expensesComplete = false;
      notes.push(
        `The linked expense for ${name} is counted once and was not added again. The share could not be read, so the split was withheld.`,
      );
      continue;
    }
    if (company.cents === 0 && partnerShare.cents === 0) {
      addSplit(amount, 0);
      notes.push(
        `Partner share was not recorded for ${name}. The linked expense is the company share and is counted once.`,
      );
      continue;
    }
    if (company.cents + partnerShare.cents === amount) {
      addSplit(company.cents, partnerShare.cents);
      continue;
    }
    expensesComplete = false;
    notes.push(
      `Company share ${centsText(company.cents)} and partner share ${centsText(partnerShare.cents)} do not add up to the linked expense ${centsText(amount)} for ${name}. The linked expense is counted once and was not added again.`,
    );
  }

  let income = 0;
  let unattributed = 0;
  let conflicting = 0;
  let deposits = 0;
  let incomeComplete = true;
  let undated = 0;
  const sourceTotals = new Map<JvIncomeSource, number>(
    JV_INCOME_SOURCES.map((row) => [row.source, 0]),
  );
  const verifiedCharges = input.charges.filter(
    (charge) =>
      charge.succeeded &&
      charge.currency === "usd" &&
      Number.isSafeInteger(charge.amountCents) &&
      charge.amountCents >= 0 &&
      charge.created >= window.gte &&
      charge.created < window.lt,
  );
  const addIncome = (cents: number, source: JvIncomeSource) => {
    const next = income + cents;
    const sourceNext = (sourceTotals.get(source) ?? 0) + cents;
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(sourceNext)) incomeComplete = false;
    else {
      income = next;
      sourceTotals.set(source, sourceNext);
    }
  };
  const chargeMoneyOk = (charge: JvCharge) =>
    charge.currency === "usd" &&
    Number.isSafeInteger(charge.amountCents) &&
    charge.amountCents >= 0;
  for (const charge of input.charges) {
    if (!charge.succeeded) continue;
    if (charge.created < window.gte || charge.created >= window.lt) continue;
    const decision = decideCharge(charge, input.payments, input.rentals);
    if (decision.kind === "deposit") {
      if (decision.vehicleId !== input.vehicleId) continue;
      if (!chargeMoneyOk(charge)) {
        incomeComplete = false;
        continue;
      }
      const next = deposits + charge.amountCents;
      if (!Number.isSafeInteger(next)) incomeComplete = false;
      else deposits = next;
      continue;
    }
    if (decision.kind === "unattributed") {
      if (!chargeMoneyOk(charge)) continue;
      if (decision.conflict) conflicting += 1;
      const next = unattributed + charge.amountCents;
      if (!Number.isSafeInteger(next)) incomeComplete = false;
      else unattributed = next;
      continue;
    }
    if (decision.vehicleId !== input.vehicleId) continue;
    if (!chargeMoneyOk(charge)) {
      incomeComplete = false;
      continue;
    }
    if (PARTNER_REVENUE_BASE === null && decision.basis !== "rent") {
      incomeComplete = false;
      notes.push(decision.basis === "customer" ? CUSTOMER_ONLY_NOTE : REVENUE_BASE_NOTE);
      continue;
    }
    addIncome(charge.amountCents, "stripe");
  }

  const unmatched: JvUnmatched[] = [];
  const recordedIncome: JvPayment[] = [];
  for (const payment of input.payments) {
    const status = (payment.status ?? "").trim().toLowerCase();
    if (!COLLECTED.has(status)) continue;
    const type = (payment.type ?? "").trim().toLowerCase();
    const source = paymentSource(payment);
    const matched = verifiedCharges.some((charge) => sharesReference(payment, charge));
    const vehicleId = paymentVehicleId(payment, input.rentals);
    const missingDate =
      payment.paidDate === null || payment.paidDate === undefined || payment.paidDate === "";
    const place = missingDate ? { date: null, invalid: false } : placed([payment.paidDate]);
    if (place.invalid) {
      if (vehicleId === input.vehicleId) incomeComplete = false;
      continue;
    }
    if (type === "deposit") {
      if (vehicleId !== input.vehicleId || matched || source === "stripe") continue;
      if (!place.date) {
        undated += 1;
        continue;
      }
      if (!inWindow(place.date)) continue;
      const amount = readCents(payment.amount);
      if (amount.blank || amount.invalid || amount.cents === null) {
        incomeComplete = false;
        continue;
      }
      const next = deposits + amount.cents;
      if (!Number.isSafeInteger(next)) incomeComplete = false;
      else deposits = next;
      continue;
    }
    if (
      PARTNER_REVENUE_BASE === null &&
      DISPUTED_REVENUE_TYPES.has(type) &&
      vehicleId === input.vehicleId &&
      (place.invalid || !place.date || inWindow(place.date))
    ) {
      incomeComplete = false;
      notes.push(REVENUE_BASE_NOTE);
      continue;
    }
    if (!acceptedRevenueTypes().has(type) || vehicleId !== input.vehicleId) continue;
    if (!place.date) {
      if (source === "stripe" && !hasAuthoritativeReference(payment, verifiedCharges))
        unmatched.push({
          id: payment.id,
          method: payment.paymentMethod ?? null,
          reason: UNMATCHED_REASON,
        });
      else undated += 1;
      continue;
    }
    if (!inWindow(place.date) || matched) continue;
    if (source === "stripe") {
      if (!hasAuthoritativeReference(payment, verifiedCharges))
        unmatched.push({
          id: payment.id,
          method: payment.paymentMethod ?? null,
          reason: UNMATCHED_REASON,
        });
      continue;
    }
    const amount = readCents(payment.amount);
    if (amount.blank || amount.invalid || amount.cents === null) {
      incomeComplete = false;
      continue;
    }
    addIncome(amount.cents, source);
    recordedIncome.push(payment);
  }
  if (undated)
    notes.push(
      `${undated} paid ${undated === 1 ? "payment has" : "payments have"} no paid date, so ${undated === 1 ? "it is" : "they are"} not in this period.`,
    );

  const paymentsById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const countedRefundPayments = new Set<string>();
  let refunds = 0;
  let depositRefunds = 0;
  let refundsComplete = true;
  const addRefund = (cents: number, deposit: boolean) => {
    const next = (deposit ? depositRefunds : refunds) + cents;
    if (!Number.isSafeInteger(next)) refundsComplete = false;
    else if (deposit) depositRefunds = next;
    else refunds = next;
  };
  for (const refund of input.refunds) {
    const place = placed([refund.createdAt]);
    if (place.date && !inWindow(place.date)) continue;
    if (!refund.paymentIds.length) {
      refundsComplete = false;
      continue;
    }
    const linkedPayments = refund.paymentIds.map((id) => paymentsById.get(id));
    if (linkedPayments.some((payment) => !payment)) {
      refundsComplete = false;
      continue;
    }
    const rows = linkedPayments as JvPayment[];
    const vehicles = new Set(rows.map((payment) => paymentVehicleId(payment, input.rentals) ?? ""));
    const touches = vehicles.has(input.vehicleId);
    if (!touches && vehicles.size > 0 && ![...vehicles].includes("")) continue;
    if (vehicles.size !== 1 || !touches) {
      refundsComplete = false;
      continue;
    }
    if (place.invalid || !place.date) {
      refundsComplete = false;
      continue;
    }
    const status = (refund.status ?? "").trim().toLowerCase();
    if (REFUND_SKIP.has(status)) continue;
    if (status !== "succeeded") {
      refundsComplete = false;
      continue;
    }
    const cents = decimalSourceCents(refund.amount);
    if (cents === null) {
      refundsComplete = false;
      continue;
    }
    const types = rows.map((payment) => (payment.type ?? "").trim().toLowerCase());
    if (types.some((type) => type === "deposit") && types.some((type) => type !== "deposit")) {
      refundsComplete = false;
      continue;
    }
    for (const id of refund.paymentIds) countedRefundPayments.add(id);
    addRefund(
      cents,
      types.every((type) => type === "deposit"),
    );
  }
  for (const payment of recordedIncome) {
    if (countedRefundPayments.has(payment.id)) continue;
    const refunded = readCents(payment.refundedAmount);
    if (refunded.blank || refunded.cents === 0) continue;
    if (refunded.invalid || refunded.cents === null) {
      refundsComplete = false;
      continue;
    }
    const place = placed([payment.refundedAt, payment.paidDate]);
    if (place.invalid || !place.date || !inWindow(place.date)) {
      if (place.invalid || !place.date) refundsComplete = false;
      continue;
    }
    addRefund(refunded.cents, false);
  }

  const incomeCents = incomeComplete ? income : null;
  const refundsCents = refundsComplete ? refunds : null;
  const netIncomeCents =
    incomeCents !== null &&
    refundsCents !== null &&
    Number.isSafeInteger(incomeCents - refundsCents)
      ? incomeCents - refundsCents
      : null;
  let companyIncomeCents: number | null = null;
  let partnerIncomeCents: number | null = null;
  if (bps !== null && netIncomeCents !== null) {
    const partnerShare = shareOf(netIncomeCents, bps);
    if (partnerShare !== null && Number.isSafeInteger(netIncomeCents - partnerShare)) {
      partnerIncomeCents = partnerShare;
      companyIncomeCents = netIncomeCents - partnerShare;
    }
  }
  const companyExpenseCents = expensesComplete ? companyExpense : null;
  const partnerExpenseCents = expensesComplete ? partnerExpense : null;
  const expenseCents =
    companyExpenseCents !== null &&
    partnerExpenseCents !== null &&
    Number.isSafeInteger(companyExpenseCents + partnerExpenseCents)
      ? companyExpenseCents + partnerExpenseCents
      : null;
  const companyNetCents =
    companyIncomeCents !== null &&
    companyExpenseCents !== null &&
    Number.isSafeInteger(companyIncomeCents - companyExpenseCents)
      ? companyIncomeCents - companyExpenseCents
      : null;
  const partnerNetCents =
    partnerIncomeCents !== null &&
    partnerExpenseCents !== null &&
    Number.isSafeInteger(partnerIncomeCents - partnerExpenseCents)
      ? partnerIncomeCents - partnerExpenseCents
      : null;
  const coverage: JvCoverage =
    !incomeComplete || !expensesComplete || !refundsComplete
      ? "unavailable"
      : unmatched.length || undated
        ? "partial"
        : "complete";

  return {
    vehicleId: vehicle.id,
    vehicleLabel: vehicleProfitLabel(vehicle),
    partnerId: vehicle.partnerId,
    partnerName: partner?.name?.trim() || null,
    period: input.period,
    from: window.from,
    to: window.to,
    through: window.through,
    split: bps !== null ? "configured" : "not_configured",
    splitLabel:
      bps !== null && partner ? `${String(partner.revenueSplitPct).trim()}%` : SPLIT_MISSING,
    sources: incomeComplete
      ? JV_INCOME_SOURCES.map((row) => ({
          source: row.source,
          label: row.label,
          cents: sourceTotals.get(row.source) ?? 0,
        }))
      : [],
    incomeCents,
    refundsCents,
    netIncomeCents,
    companyIncomeCents,
    partnerIncomeCents,
    companyExpenseCents,
    partnerExpenseCents,
    expenseCents,
    companyNetCents,
    partnerNetCents,
    depositsExcludedCents: incomeComplete ? deposits : null,
    depositRefundsExcludedCents: refundsComplete ? depositRefunds : null,
    unattributedStripeCents: incomeComplete ? unattributed : null,
    conflictingCharges: conflicting,
    unmatched,
    notes: [...new Set(notes)],
    coverage,
    incomeComplete,
    expensesComplete,
    refundsComplete,
  };
}
