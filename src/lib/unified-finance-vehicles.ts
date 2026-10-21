import type { VehicleProfitLine, VehicleProfitSection } from "./unified-finance-contract";
import { validFinanceDate } from "./unified-finance";
import { decimalSourceCents } from "./unified-finance-live-mapping";

/**
 * Per-vehicle profitability from columns that already exist.
 * Classification matches public.vehicle_pl (migration 20261006020456):
 * revenue is net_collected on paid or refunded rent, late_fee, and other;
 * deposits are excluded; expenses are vehicle_expenses.amount;
 * maintenance is company_share, otherwise total_cost.
 * The report window is half-open [from, to). A qualifying row that cannot
 * be placed, or whose in-window amount is not exact cents, fails the section
 * and returns no dollar rows. Missing money is never stored as zero.
 */

const PLACE = "A payment, expense, or maintenance row could not be placed in the period";
const AMOUNT = "A payment, expense, or maintenance amount was missing or not exact cents";
const REVENUE_TYPES = new Set(["rent", "late_fee", "other"]);
const REVENUE_STATUSES = new Set(["paid", "refunded"]);

export type ProfitPayment = {
  vehicleId: string | null;
  status: string | null;
  type: string | null;
  netCollected: string | number | null;
  paidDate: string | null;
  dueDate: string | null;
};
export type ProfitExpense = { vehicleId: string | null; amount: string | number | null; incurredOn: string | null };
export type ProfitMaintenance = {
  vehicleId: string | null;
  companyShare: string | number | null;
  totalCost: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};
export type ProfitVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
};
type Bucket = { revenueCents: number; expenseCents: number; maintenanceCents: number };

export function calendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (validFinanceDate(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) return null;
  const date = new Date(value).toISOString().slice(0, 10);
  return validFinanceDate(date) ? date : null;
}

export function vehicleProfitLabel(vehicle: ProfitVehicle): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  const plate = vehicle.licensePlate?.trim();
  return [name, plate].filter(Boolean).join(" · ") || "Unnamed Vehicle";
}

/** First non-null candidate. A present value that is not a calendar date does not fall through. */
function placed(candidates: (string | null)[]): { date: string | null; unplaced: boolean } {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const date = calendarDate(candidate);
    return date ? { date, unplaced: false } : { date: null, unplaced: true };
  }
  return { date: null, unplaced: true };
}

export function vehicleProfitability(
  period: { from: string; to: string },
  input: { payments: ProfitPayment[]; expenses: ProfitExpense[]; maintenance: ProfitMaintenance[]; vehicles: ProfitVehicle[] },
): VehicleProfitSection {
  const reasons = new Set<string>();
  const sums = new Map<string, Bucket>();
  const inWindow = (date: string) => date >= period.from && date < period.to;
  const bucket = (id: string): Bucket => {
    const existing = sums.get(id);
    if (existing) return existing;
    const created = { revenueCents: 0, expenseCents: 0, maintenanceCents: 0 };
    sums.set(id, created);
    return created;
  };
  const add = (id: string, field: keyof Bucket, cents: number) => {
    const row = bucket(id);
    const next = row[field] + cents;
    if (!Number.isSafeInteger(next)) reasons.add(AMOUNT);
    else row[field] = next;
  };
  const take = (vehicleId: string | null, date: { date: string | null; unplaced: boolean }, amount: string | number | null, field: keyof Bucket) => {
    if (date.unplaced || !date.date) {
      reasons.add(PLACE);
      return;
    }
    if (!inWindow(date.date)) return;
    if (!vehicleId) {
      reasons.add(PLACE);
      return;
    }
    const cents = decimalSourceCents(amount);
    if (cents === null) {
      reasons.add(AMOUNT);
      return;
    }
    add(vehicleId, field, cents);
  };

  for (const payment of input.payments) {
    if (!REVENUE_STATUSES.has(payment.status ?? "") || !REVENUE_TYPES.has(payment.type ?? "")) continue;
    take(payment.vehicleId, placed([payment.paidDate, payment.dueDate]), payment.netCollected, "revenueCents");
  }
  for (const expense of input.expenses) {
    take(expense.vehicleId, placed([expense.incurredOn]), expense.amount, "expenseCents");
  }
  for (const record of input.maintenance) {
    const amount = record.companyShare !== null && record.companyShare !== undefined ? record.companyShare : record.totalCost;
    take(record.vehicleId, placed([record.performedOn, record.completedAt, record.createdAt]), amount, "maintenanceCents");
  }
  if (reasons.size) return { complete: false, rows: [], reasons: [...reasons] };

  const labels = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicleProfitLabel(vehicle)]));
  const ids = new Set<string>([...labels.keys(), ...sums.keys()]);
  const rows: VehicleProfitLine[] = [...ids].map((vehicleId) => {
    const sum = sums.get(vehicleId) ?? { revenueCents: 0, expenseCents: 0, maintenanceCents: 0 };
    const netCents = sum.revenueCents - sum.expenseCents - sum.maintenanceCents;
    return {
      vehicleId,
      label: labels.get(vehicleId) ?? "Unnamed Vehicle",
      revenueCents: sum.revenueCents,
      expenseCents: sum.expenseCents,
      maintenanceCents: sum.maintenanceCents,
      netCents,
    };
  });
  if (rows.some((row) => !Number.isSafeInteger(row.netCents))) return { complete: false, rows: [], reasons: [AMOUNT] };
  rows.sort((a, b) => b.netCents - a.netCents || a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));
  return { complete: true, rows, reasons: [] };
}
