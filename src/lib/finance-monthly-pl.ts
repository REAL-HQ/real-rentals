import { escapeCsvCell } from "./driver-statement";
import { categoryLabel } from "./maintenance-rules";
import { addCalendarDays, etYmd } from "./weekly-cash-flow";

/**
 * One Eastern Time month.
 * Collected revenue matches Vehicle Profitability (#140): a paid or refunded
 * payment uses net collected when stored, otherwise amount minus the refunded
 * amount. Deposits are excluded. Toll, damage, and fee sit in Other with the
 * other type. Expenses are vehicle_expenses.amount. Maintenance is
 * company_share, or total_cost when the share is blank. An in-month expense
 * that names a maintenance row suppresses that row. This module does not call
 * Stripe. The reader does not expose a stored fee, so Stripe fees are
 * Unavailable and are not subtracted.
 */

export const MONTHLY_PL_INCOMPLETE = "Finance records were incomplete";
export const MONTHLY_PL_MONTH = "Choose a month as YYYY-MM.";

export const STANDING_GAPS = [
  "Stripe fees are Unavailable. The read-only Stripe reader does not expose a stored fee for this month, and this report does not call Stripe. Net does not subtract fees.",
  "Depreciation is not a vehicle column.",
  "Acquisition, lender, and payoff are owner finance and are not read.",
  "payments.late_fees is not added on top of collected revenue. A payment whose type is late_fee is the Late Fees line, so the payment is counted once, as Vehicle Profitability counts it.",
  "Refundable deposits are excluded. The rental deposit amount is not income.",
  "Income minus refunds is the Vehicle Profitability collected amount: net collected when it is stored, otherwise amount minus the refunded amount.",
  "A maintenance row is omitted when an expense in this month names it, so that service is one cost.",
  "Payment types other than rent, late fee, other, toll, damage, and fee are omitted. Toll, damage, and fee are included in Other.",
] as const;

const PAID = new Set(["paid", "refunded"]);
const OTHER_TYPES = new Set(["other", "toll", "damage", "fee"]);

const EXPENSE_LABELS: Record<string, string> = {
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

export type PlVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
};

export type PlRental = { id: string; vehicleId: string | null };

export type PlPayment = {
  id: string;
  rentalId: string | null;
  vehicleId: string | null;
  status: string;
  type: string;
  amount: unknown;
  netCollected: unknown;
  refundedAmount: unknown;
  paidDate: string | null;
};

export type PlExpense = {
  id: string;
  vehicleId: string | null;
  amount: unknown;
  category: string | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};

export type PlMaintenance = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: unknown;
  totalCost: unknown;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type PlLine = { label: string; cents: number };
export type PlVehicleRow = {
  id: string;
  label: string;
  rentCents: number;
  lateFeeCents: number;
  otherCents: number;
  refundCents: number;
  expenseCents: number;
  maintenanceCents: number;
  netCents: number;
};

export type MonthlyPlReport = {
  month: string;
  from: string;
  through: string;
  income: PlLine[];
  refundCents: number;
  fees: "unavailable";
  expenses: PlLine[];
  maintenance: PlLine[];
  expenseCents: number;
  maintenanceCents: number;
  netCents: number;
  depositsExcludedCents: number;
  vehicles: PlVehicleRow[];
  standingGaps: readonly string[];
  gaps: string[];
};

type Bucket = {
  rent: number;
  late: number;
  other: number;
  refunds: number;
  expenses: number;
  maintenance: number;
};

export function monthBounds(month: string): { from: string; through: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const mon = Number(month.slice(5, 7));
  const year = Number(month.slice(0, 4));
  if (mon < 1 || mon > 12) return null;
  const from = `${month}-01`;
  if (!addCalendarDays(from, 0)) return null;
  const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  const through = addCalendarDays(next, -1);
  if (!through || through < from) return null;
  return { from, through };
}

export function currentMonth(asOf: Date): string | null {
  const day = etYmd(asOf);
  return day ? day.slice(0, 7) : null;
}

/** Same cents rule as Vehicle Profitability. A negative or unreadable amount is null. */
export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** #140 collected amount: net collected when stored, otherwise amount minus refunded. */
export function profitabilityCollectedCents(payment: { netCollected: unknown; amount: unknown; refundedAmount: unknown }): number | null {
  if (payment.netCollected != null && payment.netCollected !== "") return dollarsToCents(payment.netCollected);
  const amount = dollarsToCents(payment.amount);
  const refunded = payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : dollarsToCents(payment.refundedAmount);
  if (amount === null || refunded === null || refunded > amount) return null;
  return amount - refunded;
}

/** #140 maintenance amount: company share, or total cost when the share is blank. */
export function maintenanceCostCents(row: { companyShare: unknown; totalCost: unknown }): number | null {
  const share = row.companyShare == null || row.companyShare === "" ? null : dollarsToCents(row.companyShare);
  if (row.companyShare != null && row.companyShare !== "" && share === null) return null;
  return share ?? dollarsToCents(row.totalCost);
}

export function formatMoney(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildMonthlyPl(input: {
  month: string;
  vehicles: PlVehicle[];
  rentals: PlRental[];
  payments: PlPayment[];
  expenses: PlExpense[];
  maintenance: PlMaintenance[];
}): { ok: true; report: MonthlyPlReport } | { ok: false } {
  const range = monthBounds(input.month);
  if (!range) return { ok: false };
  const known = new Set(input.vehicles.map((vehicle) => vehicle.id).filter(Boolean));
  const rentals = new Map(input.rentals.filter((rental) => rental.id).map((rental) => [rental.id, rental]));
  const labels = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicleLabel(vehicle)]));
  const company = emptyBucket();
  const byVehicle = new Map<string, Bucket>();
  const expenseCategories = new Map<string, number>();
  const maintenanceCategories = new Map<string, number>();
  const gaps: string[] = [];
  const skipped = new Set<string>();
  let undatedPayments = 0;
  let undatedCosts = 0;
  let deposits = 0;
  let foreignVehicle = false;
  const linked = new Set<string>();

  const vehicleBucket = (id: string) => {
    const existing = byVehicle.get(id);
    if (existing) return existing;
    const created = emptyBucket();
    byVehicle.set(id, created);
    return created;
  };
  const add = (bucket: Bucket, key: keyof Bucket, cents: number) => {
    const next = bucket[key] + cents;
    if (!Number.isSafeInteger(next)) return false;
    bucket[key] = next;
    return true;
  };

  for (const payment of input.payments) {
    if (!PAID.has(payment.status.trim().toLowerCase())) continue;
    const kind = incomeKind(payment.type);
    const parts = incomeParts(payment);
    if (!parts) return { ok: false };
    const paid = paidYmd(payment.paidDate);
    if (!paid) {
      if (kind !== "skip") undatedPayments += 1;
      continue;
    }
    if (paid < range.from || paid > range.through) continue;
    if (kind === "deposit") {
      if (!Number.isSafeInteger(deposits + parts.collected)) return { ok: false };
      deposits += parts.collected;
      continue;
    }
    if (kind === "skip") {
      skipped.add(titleLabel(payment.type || "blank"));
      continue;
    }
    const vehicleId = vehicleForPayment(payment, rentals, known);
    if (!vehicleId) foreignVehicle = foreignVehicle || Boolean(payment.vehicleId || payment.rentalId);
    const bucket = vehicleBucket(vehicleId ?? "");
    const key = kind === "rent" ? "rent" : kind === "late" ? "late" : "other";
    if (!add(company, key, parts.gross) || !add(bucket, key, parts.gross)) return { ok: false };
    if (!add(company, "refunds", parts.refund) || !add(bucket, "refunds", parts.refund)) return { ok: false };
    if (parts.disagrees) gaps.push("Net collected does not equal amount minus the refunded amount. Income minus refunds uses net collected.");
  }

  for (const row of input.expenses) {
    const day = paidYmd(row.incurredOn);
    if (!day) {
      undatedCosts += 1;
      continue;
    }
    if (day < range.from || day > range.through) continue;
    const cents = dollarsToCents(row.amount);
    if (cents === null) return { ok: false };
    if (row.maintenanceRecordId) linked.add(row.maintenanceRecordId);
    const vehicleId = row.vehicleId && known.has(row.vehicleId) ? row.vehicleId : "";
    if (row.vehicleId && !known.has(row.vehicleId)) foreignVehicle = true;
    if (!add(company, "expenses", cents) || !add(vehicleBucket(vehicleId), "expenses", cents)) return { ok: false };
    if (!addMap(expenseCategories, expenseCategoryLabel(row.category), cents)) return { ok: false };
  }

  for (const row of input.maintenance) {
    if (linked.has(row.id)) continue;
    const day = firstDay(row.performedOn, row.completedAt, row.createdAt);
    if (!day) {
      undatedCosts += 1;
      continue;
    }
    if (day < range.from || day > range.through) continue;
    const cents = maintenanceCostCents(row);
    if (cents === null) return { ok: false };
    const vehicleId = row.vehicleId && known.has(row.vehicleId) ? row.vehicleId : "";
    if (row.vehicleId && !known.has(row.vehicleId)) foreignVehicle = true;
    if (!add(company, "maintenance", cents) || !add(vehicleBucket(vehicleId), "maintenance", cents)) return { ok: false };
    if (!addMap(maintenanceCategories, categoryLabel(row.category), cents)) return { ok: false };
  }

  const netCents = netOf(company);
  if (netCents === null) return { ok: false };
  if (undatedPayments) gaps.push(`${undatedPayments} paid ${undatedPayments === 1 ? "payment has" : "payments have"} no paid date, so ${undatedPayments === 1 ? "it is" : "they are"} not in this month.`);
  if (undatedCosts) gaps.push(`${undatedCosts} cost ${undatedCosts === 1 ? "row has" : "rows have"} no date, so ${undatedCosts === 1 ? "it is" : "they are"} not in this month.`);
  if (skipped.size) gaps.push(`Omitted payment types: ${[...skipped].sort().join(", ")}.`);
  if (foreignVehicle) gaps.push("A row names a vehicle that is not in the directory, so that amount is listed under No Vehicle. Vehicle Profitability omits it from the vehicle rows.");

  const vehicles = [...byVehicle.entries()].map(([id, bucket]) => {
    const rowNet = netOf(bucket);
    if (rowNet === null) return null;
    return {
      id: id || "none",
      label: id ? labels.get(id) ?? "Vehicle" : "No Vehicle",
      rentCents: bucket.rent,
      lateFeeCents: bucket.late,
      otherCents: bucket.other,
      refundCents: bucket.refunds,
      expenseCents: bucket.expenses,
      maintenanceCents: bucket.maintenance,
      netCents: rowNet,
    };
  });
  if (vehicles.some((row) => row === null)) return { ok: false };
  const rows = vehicles.filter((row): row is PlVehicleRow => row !== null);
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  return {
    ok: true,
    report: {
      month: input.month,
      from: range.from,
      through: range.through,
      income: [
        { label: "Rent", cents: company.rent },
        { label: "Late Fees", cents: company.late },
        { label: "Other", cents: company.other },
      ],
      refundCents: company.refunds,
      fees: "unavailable",
      expenses: linesFrom(expenseCategories),
      maintenance: linesFrom(maintenanceCategories),
      expenseCents: company.expenses,
      maintenanceCents: company.maintenance,
      netCents,
      depositsExcludedCents: deposits,
      vehicles: rows,
      standingGaps: STANDING_GAPS,
      gaps: unique(gaps),
    },
  };
}

export function monthlyPlToCsv(report: MonthlyPlReport): string {
  const lines: string[][] = [
    ["Monthly P&L Statement"],
    ["Month", report.month],
    ["From", report.from],
    ["Through", report.through],
    ["Eastern Time"],
    [],
    ["Income", "Amount"],
    ...report.income.map((line) => [line.label, formatMoney(line.cents)]),
    ["Refunds", formatMoney(report.refundCents)],
    ["Stripe Fees", "Unavailable"],
    ["Expenses", formatMoney(report.expenseCents)],
    ["Maintenance", formatMoney(report.maintenanceCents)],
    ["Net", formatMoney(report.netCents)],
    [],
    ["Expenses By Category", "Amount"],
    ...(report.expenses.length ? report.expenses.map((line) => [line.label, formatMoney(line.cents)]) : [["None", formatMoney(0)]]),
    [],
    ["Maintenance By Category", "Amount"],
    ...(report.maintenance.length ? report.maintenance.map((line) => [line.label, formatMoney(line.cents)]) : [["None", formatMoney(0)]]),
    [],
    ["Vehicle", "Rent", "Late Fees", "Other", "Refunds", "Expenses", "Maintenance", "Net"],
    ...report.vehicles.map((row) => [
      row.label,
      formatMoney(row.rentCents),
      formatMoney(row.lateFeeCents),
      formatMoney(row.otherCents),
      formatMoney(row.refundCents),
      formatMoney(row.expenseCents),
      formatMoney(row.maintenanceCents),
      formatMoney(row.netCents),
    ]),
    [],
    ["Deposits Excluded", formatMoney(report.depositsExcludedCents)],
    ["Not Stored"],
    ...report.standingGaps.map((gap) => [gap]),
    ...report.gaps.map((gap) => [gap]),
  ];
  return `${lines.map((line) => line.map((cell) => escapeCsvCell(cell)).join(",")).join("\n")}\n`;
}

function incomeParts(payment: PlPayment): { gross: number; refund: number; collected: number; disagrees: boolean } | null {
  const collected = profitabilityCollectedCents(payment);
  if (collected === null) return null;
  const refund = payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : dollarsToCents(payment.refundedAmount);
  if (refund === null || !Number.isSafeInteger(collected + refund)) return null;
  const amount = payment.amount == null || payment.amount === "" ? null : dollarsToCents(payment.amount);
  const netStored = payment.netCollected != null && payment.netCollected !== "";
  const disagrees = netStored && amount !== null && amount - refund !== collected;
  return { gross: collected + refund, refund, collected, disagrees };
}

function incomeKind(type: string): "rent" | "late" | "other" | "deposit" | "skip" {
  const value = type.trim().toLowerCase();
  if (value === "deposit") return "deposit";
  if (value === "rent") return "rent";
  if (value === "late_fee") return "late";
  if (OTHER_TYPES.has(value)) return "other";
  return "skip";
}

function vehicleForPayment(payment: PlPayment, rentals: Map<string, PlRental>, known: Set<string>): string | null {
  if (payment.rentalId) {
    const vehicleId = rentals.get(payment.rentalId)?.vehicleId ?? null;
    return vehicleId && known.has(vehicleId) ? vehicleId : null;
  }
  return payment.vehicleId && known.has(payment.vehicleId) ? payment.vehicleId : null;
}

function paidYmd(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (!match) return null;
  if (trimmed.length === 10) return match[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? match[1] : etYmd(parsed);
}

function firstDay(...values: (string | null)[]): string | null {
  for (const value of values) {
    const day = paidYmd(value);
    if (day) return day;
  }
  return null;
}

function expenseCategoryLabel(category: string | null): string {
  if (!category?.trim()) return "Uncategorized";
  const known = EXPENSE_LABELS[category.trim().toLowerCase()];
  if (known) return known;
  return titleLabel(category);
}

function vehicleLabel(vehicle: PlVehicle): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  const plate = vehicle.licensePlate?.trim();
  return [name, plate].filter(Boolean).join(" · ") || "Unnamed Vehicle";
}

function emptyBucket(): Bucket {
  return { rent: 0, late: 0, other: 0, refunds: 0, expenses: 0, maintenance: 0 };
}

function netOf(bucket: Bucket): number | null {
  const income = bucket.rent + bucket.late + bucket.other;
  const net = income - bucket.refunds - bucket.expenses - bucket.maintenance;
  return Number.isSafeInteger(net) ? net : null;
}

function addMap(map: Map<string, number>, key: string, cents: number): boolean {
  const next = (map.get(key) ?? 0) + cents;
  if (!Number.isSafeInteger(next)) return false;
  map.set(key, next);
  return true;
}

function linesFrom(map: Map<string, number>): PlLine[] {
  return [...map.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => a.label.localeCompare(b.label));
}

function titleLabel(value: string): string {
  return value.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
