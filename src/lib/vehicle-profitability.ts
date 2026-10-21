import { addCalendarDays, etYmd } from "./weekly-cash-flow";
import { vehicleProfitLabel } from "./unified-finance-vehicles";

/**
 * Read-only vehicle profitability for an inclusive Eastern Time date range.
 * Collected revenue is a paid or refunded payment, net of refunds, attributed
 * through the rental's vehicle. Expenses are vehicle_expenses.amount.
 * Maintenance is maintenance_records.company_share, or total_cost when the
 * share is blank. A service that already has an in-range expense is one cost.
 * This module does not call Stripe or write.
 */

export const PROFIT_WINDOW_DAYS = 90;
export const DIRECTORY_INCOMPLETE = "Vehicle records were incomplete";
export const MISSING_COST_SOURCES = [
  "Depreciation is not a vehicle column.",
  "Acquisition, lender, and payoff are owner finance and are not read on this report.",
] as const;

const REVENUE_TYPES = new Set(["rent", "late_fee", "other", "toll", "damage", "fee"]);
const PAID_STATUSES = new Set(["paid", "refunded"]);
const CANCELLED = new Set(["cancelled", "canceled", "void", "voided"]);

export type ProfitRange = { from: string; through: string };

export type ProfitVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
  createdAt: string | null;
  archivedAt: string | null;
};

export type ProfitRental = {
  id: string;
  vehicleId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
};

export type ProfitPayment = {
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

export type ProfitExpense = {
  id: string;
  vehicleId: string | null;
  amount: unknown;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};

export type ProfitMaintenance = {
  id: string;
  vehicleId: string | null;
  companyShare: unknown;
  totalCost: unknown;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type VehicleProfitRow = {
  vehicleId: string;
  label: string;
  revenueCents: number | null;
  expenseCents: number | null;
  maintenanceCents: number | null;
  netCents: number | null;
  daysRented: number | null;
  daysAvailable: number | null;
  utilizationPercent: number | null;
  revenuePerRentedDayCents: number | null;
};

export type UnattributedPayment = {
  id: string;
  paidDate: string | null;
  status: string;
  type: string;
  amountCents: number | null;
};

export type VehicleProfitReport = {
  from: string;
  through: string;
  rows: VehicleProfitRow[];
  unattributed: UnattributedPayment[];
  depositsExcludedCents: number | null;
  missingCostSources: readonly string[];
};

export function defaultProfitRange(now: Date): ProfitRange | null {
  const through = etYmd(now);
  const from = through ? addCalendarDays(through, 1 - PROFIT_WINDOW_DAYS) : null;
  if (!from || !through || from > through) return null;
  return { from, through };
}

export function profitRange(from: string, through: string): ProfitRange | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)) return null;
  if (!addCalendarDays(from, 0) || !addCalendarDays(through, 0) || from > through) return null;
  return { from, through };
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatUtilization(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "";
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

export function buildVehicleProfit(input: {
  range: ProfitRange;
  vehicles: ProfitVehicle[];
  rentals: ProfitRental[];
  payments: ProfitPayment[];
  expenses: ProfitExpense[];
  maintenance: ProfitMaintenance[];
}): VehicleProfitReport {
  const { from, through } = input.range;
  const end = addCalendarDays(through, 1);
  const vehicles = input.vehicles.filter((vehicle) => vehicle.id);
  const known = new Set(vehicles.map((vehicle) => vehicle.id));
  const rentals = new Map(input.rentals.filter((rental) => rental.id).map((rental) => [rental.id, rental]));
  const revenue = new Map<string, number | null>();
  const expense = new Map<string, number | null>();
  const maintenance = new Map<string, number | null>();
  const touch = (bucket: Map<string, number | null>, vehicleId: string, cents: number | null) => {
    if (bucket.get(vehicleId) === null) return;
    if (cents === null || !Number.isSafeInteger((bucket.get(vehicleId) ?? 0) + cents)) bucket.set(vehicleId, null);
    else bucket.set(vehicleId, (bucket.get(vehicleId) ?? 0) + cents);
  };
  const unattributed: UnattributedPayment[] = [];
  let deposits = 0;
  let depositsComplete = true;
  const linkedInRange = new Set<string>();

  for (const payment of input.payments) {
    if (!PAID_STATUSES.has(payment.status.trim().toLowerCase())) continue;
    const paid = paidYmd(payment.paidDate);
    if (!paid || paid < from || paid > through) continue;
    const cents = collectedCents(payment);
    if (payment.type.trim().toLowerCase() === "deposit") {
      if (cents === null || !Number.isSafeInteger(deposits + cents)) depositsComplete = false;
      else deposits += cents;
      continue;
    }
    if (!REVENUE_TYPES.has(payment.type.trim().toLowerCase())) continue;
    const vehicleId = vehicleForPayment(payment, rentals, known);
    if (!vehicleId) {
      unattributed.push({
        id: payment.id,
        paidDate: paid,
        status: statusLabel(payment.status),
        type: statusLabel(payment.type),
        amountCents: cents,
      });
      continue;
    }
    touch(revenue, vehicleId, cents);
  }

  for (const row of input.expenses) {
    const day = paidYmd(row.incurredOn);
    if (!day || day < from || day > through || !row.vehicleId || !known.has(row.vehicleId)) continue;
    if (row.maintenanceRecordId) linkedInRange.add(row.maintenanceRecordId);
    touch(expense, row.vehicleId, dollarsToCents(row.amount));
  }
  for (const row of input.maintenance) {
    if (linkedInRange.has(row.id)) continue;
    const day = firstDay(row.performedOn, row.completedAt, row.createdAt);
    if (!day || day < from || day > through || !row.vehicleId || !known.has(row.vehicleId)) continue;
    const share = row.companyShare == null || row.companyShare === "" ? null : dollarsToCents(row.companyShare);
    touch(maintenance, row.vehicleId, share ?? dollarsToCents(row.totalCost));
  }

  const rows = vehicles.map((vehicle) => {
    const revenueCents = revenue.get(vehicle.id) ?? 0;
    const expenseCents = expense.get(vehicle.id) ?? 0;
    const maintenanceCents = maintenance.get(vehicle.id) ?? 0;
    const available = availableDays(vehicle, from, end);
    const rented = available === null || !end ? null : rentedDays(vehicle.id, input.rentals, available.start, available.end);
    const daysAvailable = available?.days ?? null;
    const daysRented = rented;
    const utilizationPercent = daysAvailable !== null && daysRented !== null && daysAvailable > 0
      ? Math.round((daysRented / daysAvailable) * 1000) / 10
      : null;
    const cost = expenseCents !== null && maintenanceCents !== null && Number.isSafeInteger(expenseCents + maintenanceCents)
      ? expenseCents + maintenanceCents : null;
    const netCents = revenueCents !== null && cost !== null && Number.isSafeInteger(revenueCents - cost) ? revenueCents - cost : null;
    const revenuePerRentedDayCents = revenueCents !== null && daysRented !== null && daysRented > 0
      ? Math.round(revenueCents / daysRented) : null;
    return {
      vehicleId: vehicle.id,
      label: vehicleProfitLabel(vehicle),
      revenueCents,
      expenseCents,
      maintenanceCents,
      netCents,
      daysRented,
      daysAvailable,
      utilizationPercent,
      revenuePerRentedDayCents,
    };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));
  unattributed.sort((a, b) => (a.paidDate ?? "").localeCompare(b.paidDate ?? "") || a.id.localeCompare(b.id));
  return {
    from,
    through,
    rows,
    unattributed,
    depositsExcludedCents: depositsComplete ? deposits : null,
    missingCostSources: MISSING_COST_SOURCES,
  };
}

export function vehicleProfitToCsv(report: VehicleProfitReport): string {
  const lines: string[][] = [
    ["Vehicle Profitability"],
    ["Eastern Time"],
    ["From", report.from],
    ["Through", report.through],
    [],
    ["Vehicle", "Revenue", "Expenses", "Maintenance", "Net", "Days Rented", "Days Available", "Utilization", "Revenue Per Rented Day"],
    ...report.rows.map((row) => [
      row.label,
      formatCents(row.revenueCents),
      formatCents(row.expenseCents),
      formatCents(row.maintenanceCents),
      formatCents(row.netCents),
      row.daysRented == null ? "" : String(row.daysRented),
      row.daysAvailable == null ? "" : String(row.daysAvailable),
      formatUtilization(row.utilizationPercent),
      row.daysRented === 0 ? "No Rented Days" : formatCents(row.revenuePerRentedDayCents),
    ]),
    [],
    ["Unattributed Payments"],
    ["Payment", "Paid", "Status", "Type", "Amount"],
    ...report.unattributed.map((row) => [row.id, row.paidDate ?? "", row.status, row.type, formatCents(row.amountCents)]),
    [],
    ["Missing Cost Sources"],
    ...report.missingCostSources.map((source) => [source]),
  ];
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function collectedCents(payment: ProfitPayment): number | null {
  if (payment.netCollected != null && payment.netCollected !== "") return dollarsToCents(payment.netCollected);
  const amount = dollarsToCents(payment.amount);
  const refunded = payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : dollarsToCents(payment.refundedAmount);
  if (amount === null || refunded === null || refunded > amount) return null;
  return amount - refunded;
}

function vehicleForPayment(payment: ProfitPayment, rentals: Map<string, ProfitRental>, known: Set<string>): string | null {
  if (payment.rentalId) {
    const rental = rentals.get(payment.rentalId);
    const vehicleId = rental?.vehicleId ?? null;
    return vehicleId && known.has(vehicleId) ? vehicleId : null;
  }
  return payment.vehicleId && known.has(payment.vehicleId) ? payment.vehicleId : null;
}

function availableDays(vehicle: ProfitVehicle, from: string, end: string | null): { start: string; end: string; days: number } | null {
  if (!end) return null;
  const created = calendarDay(vehicle.createdAt);
  if (!created.date) return null;
  const archived = calendarDay(vehicle.archivedAt);
  if (vehicle.archivedAt && !archived.date) return null;
  const archiveEnd = archived.date ? addCalendarDays(archived.date, 1) : end;
  if (!archiveEnd) return null;
  const start = created.date > from ? created.date : from;
  const stop = archiveEnd < end ? archiveEnd : end;
  return { start, end: stop, days: start < stop ? eachDay(start, stop).length : 0 };
}

function rentedDays(vehicleId: string, rentals: ProfitRental[], start: string, end: string): number | null {
  const days = new Set<string>();
  for (const rental of rentals) {
    if (rental.vehicleId !== vehicleId) continue;
    if (CANCELLED.has((rental.status ?? "").trim().toLowerCase())) continue;
    const rentalStart = calendarDay(rental.startDate);
    if (!rentalStart.date) return null;
    const open = !rental.endDate && (rental.status ?? "").trim().toLowerCase() === "active";
    const rentalEnd = open ? { date: end } : calendarDay(rental.endDate);
    if (!rentalEnd.date) return null;
    const lower = rentalStart.date > start ? rentalStart.date : start;
    const upper = rentalEnd.date < end ? rentalEnd.date : end;
    if (lower < upper) for (const day of eachDay(lower, upper)) days.add(day);
  }
  return days.size;
}

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day && day < end; day = addCalendarDays(day, 1) ?? "") days.push(day);
  return days;
}

function firstDay(...values: (string | null)[]): string | null {
  for (const value of values) {
    const day = paidYmd(value);
    if (day) return day;
  }
  return null;
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

function calendarDay(value: string | null | undefined): { date: string | null } {
  if (value == null || value === "") return { date: null };
  return { date: paidYmd(value) };
}

function statusLabel(status: string): string {
  return status.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
