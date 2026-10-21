import { categoryLabel } from "./expense-categories";
import { etYmd, monthWindow } from "./owner-pnl";
import { decimalSourceCents } from "./unified-finance-live-mapping";
import { validFinanceDate } from "./unified-finance";

/**
 * Read-only profit for one vehicle and one Eastern Time month.
 * Verified revenue matches Overview combined revenue: Stripe net after
 * refunds and fees, plus recorded non-Stripe net_collected. Deposits are
 * excluded. Revenue types are rent, late fee, and other. A Stripe-linked
 * payment is not added again as net_collected. Tolls and tickets are toll
 * charges, separate from expenses. Maintenance company share is the cost,
 * or total cost when the share is blank, and a service already on an
 * in-month expense is one cost. An amount that cannot be read stays null.
 * This module does not call Stripe or write.
 */

export const VEHICLE_PNL_PAGE = 100;
export const VEHICLE_PNL_MAX_PAGES = 20;

export const VEHICLE_PNL_REVENUE_NOTE =
  "Verified revenue is Stripe net after refunds and fees, plus recorded non-Stripe payments, for rent, late fee, and other. Deposits are excluded. A missing amount stays Unknown.";
export const VEHICLE_PNL_ONCE_NOTE =
  "A maintenance row linked to an expense in this month is counted once, on the expense.";
export const VEHICLE_PNL_TOLLS_NOTE =
  "Tolls And Tickets are toll charges. An expense categorized as tolls stays under expenses.";
export const VEHICLE_PNL_TRUNCATED_NOTE =
  "This read was truncated, so the affected amounts are Unknown.";
export const VEHICLE_PNL_STRIPE_NOTE =
  "Verified Stripe revenue is Unknown for this month.";

const REVENUE_TYPES = new Set(["rent", "late_fee", "other"]);
const PAID_STATUSES = new Set(["paid", "refunded"]);
const TOLL_TYPES = new Set(["toll", "citation", "parking", "red_light", "speeding", "impound"]);

export type VehiclePnlWindow = NonNullable<ReturnType<typeof monthWindow>>;

export type VehiclePnlVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
};

export type VehiclePnlRental = { id: string; vehicleId: string | null };

export type VehiclePnlPayment = {
  id: string;
  rentalId: string | null;
  vehicleId: string | null;
  status: string;
  type: string;
  netCollected: unknown;
  paidDate: string | null;
  stripePaymentIntentId: string | null;
};

export type VehiclePnlExpense = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: unknown;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
};

export type VehiclePnlToll = {
  id: string;
  vehicleId: string | null;
  chargeType: string;
  occurredAt: string | null;
  amount: unknown;
};

export type VehiclePnlMaintenance = {
  id: string;
  vehicleId: string | null;
  companyShare: unknown;
  totalCost: unknown;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

export type VehiclePnlCharge = {
  id: string;
  paymentIntentId: string | null;
  currency: string;
  amount: number;
  created: number;
  paid: boolean;
  captured: boolean;
  status: string;
  fee: number | null;
};

export type VehiclePnlRefund = {
  id: string;
  chargeId: string;
  currency: string;
  amount: number;
  created: number;
  status: string | null;
  fee: number | null;
};

export type VehiclePnlStripeRead =
  | { ok: true; truncated: boolean; charges: VehiclePnlCharge[]; refunds: VehiclePnlRefund[] }
  | { ok: false; truncated: boolean };

export type VehiclePnlExpenseLine = {
  category: string;
  label: string;
  cents: number | null;
};

export type VehiclePnlMoney = {
  revenueCents: number | null;
  expenseCents: number | null;
  tollsTicketsCents: number | null;
  maintenanceCents: number | null;
};

export type VehiclePnlRow = VehiclePnlMoney & {
  vehicleId: string;
  label: string;
  expenses: VehiclePnlExpenseLine[];
  netCents: number | null;
};

export type VehiclePnlReport = {
  month: string;
  from: string;
  through: string;
  rows: VehiclePnlRow[];
  unattributed: VehiclePnlMoney;
  truncated: boolean;
  notes: string[];
};

export type VehiclePnlResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: VehiclePnlReport };

type Place = "missing" | "invalid" | { date: string };

type MoneyBucket = {
  revenue: number | null;
  expense: number | null;
  tolls: number | null;
  maintenance: number | null;
  categories: Map<string, number | null>;
};

export function vehiclePnlWindow(month: string): VehiclePnlWindow | null {
  return monthWindow(month);
}

export function buildVehiclePnl(input: {
  window: VehiclePnlWindow;
  vehicles: VehiclePnlVehicle[];
  rentals: VehiclePnlRental[];
  payments: VehiclePnlPayment[];
  expenses: VehiclePnlExpense[];
  tolls: VehiclePnlToll[];
  maintenance: VehiclePnlMaintenance[];
  stripe: VehiclePnlStripeRead;
  caps: {
    vehicles: boolean;
    rentals: boolean;
    payments: boolean;
    expenses: boolean;
    tolls: boolean;
    maintenance: boolean;
  };
}): VehiclePnlReport {
  const { window } = input;
  const known = new Set(input.vehicles.map((vehicle) => vehicle.id).filter(Boolean));
  const rentals = new Map(input.rentals.filter((rental) => rental.id).map((rental) => [rental.id, rental]));
  const buckets = new Map<string, MoneyBucket>();
  const bucketFor = (vehicleId: string) => {
    const existing = buckets.get(vehicleId);
    if (existing) return existing;
    const created = emptyBucket();
    buckets.set(vehicleId, created);
    return created;
  };
  const unattributed = emptyBucket();
  const stripeKnown = input.stripe.ok && !input.stripe.truncated;
  const revenueBlocked =
    input.caps.vehicles ||
    input.caps.rentals ||
    input.caps.payments ||
    !stripeKnown ||
    !distinct(input.vehicles.map((row) => row.id)) ||
    !distinct(input.rentals.map((row) => row.id)) ||
    !distinct(input.payments.map((row) => row.id));
  const expenseBlocked = input.caps.vehicles || input.caps.expenses || !distinct(input.expenses.map((row) => row.id));
  const tollsBlocked = input.caps.vehicles || input.caps.tolls || !distinct(input.tolls.map((row) => row.id));
  const maintenanceBlocked =
    input.caps.vehicles || input.caps.maintenance || input.caps.expenses || !distinct(input.maintenance.map((row) => row.id));
  if (revenueBlocked) withhold(unattributed, "revenue");
  if (expenseBlocked) withhold(unattributed, "expense");
  if (tollsBlocked) withhold(unattributed, "tolls");
  if (maintenanceBlocked) withhold(unattributed, "maintenance");

  const placePayment = (payment: VehiclePnlPayment) => {
    const vehicleId = vehicleFor(payment, rentals, known);
    return vehicleId && known.has(vehicleId) ? bucketFor(vehicleId) : unattributed;
  };

  if (!revenueBlocked) {
    for (const vehicle of input.vehicles) bucketFor(vehicle.id);
    const charges = input.stripe.ok ? input.stripe.charges : [];
    const refunds = input.stripe.ok ? input.stripe.refunds : [];
    if (!distinct(charges.map((charge) => charge.id)) || !distinct(refunds.map((refund) => refund.id))) {
      withhold(unattributed, "revenue");
      for (const bucket of buckets.values()) withhold(bucket, "revenue");
    } else {
      const chargeById = new Map(charges.map((charge) => [charge.id, charge]));
      const chargeVehicle = new Map<string, MoneyBucket>();
      for (const charge of charges) {
        const links = input.payments.filter((payment) => payment.stripePaymentIntentId && payment.stripePaymentIntentId === charge.paymentIntentId);
        const vehicles = new Set(
          links
            .map((payment) => vehicleFor(payment, rentals, known))
            .filter((id): id is string => Boolean(id)),
        );
        chargeVehicle.set(charge.id, vehicles.size === 1 ? bucketFor([...vehicles][0]!) : unattributed);
      }
      for (const charge of charges) {
        const target = chargeVehicle.get(charge.id) ?? unattributed;
        if (!inUnix(charge.created, window) || !succeededCharge(charge)) continue;
        if (charge.currency.toLowerCase() !== "usd" || charge.fee === null || !Number.isSafeInteger(charge.amount) || !Number.isSafeInteger(charge.fee)) {
          withhold(target, "revenue");
          continue;
        }
        target.revenue = add(target.revenue, charge.amount);
        target.revenue = add(target.revenue, -charge.fee);
      }
      for (const refund of refunds) {
        if (!inUnix(refund.created, window) || refund.status !== "succeeded") continue;
        const charge = chargeById.get(refund.chargeId);
        const target = charge ? chargeVehicle.get(charge.id) : undefined;
        if (!charge || !succeededCharge(charge) || !target || refund.currency.toLowerCase() !== charge.currency.toLowerCase()) {
          withhold(unattributed, "revenue");
          for (const bucket of buckets.values()) withhold(bucket, "revenue");
          break;
        }
        if (refund.fee === null || !Number.isSafeInteger(refund.amount) || !Number.isSafeInteger(refund.fee)) {
          withhold(target, "revenue");
          continue;
        }
        target.revenue = add(target.revenue, -refund.amount);
        target.revenue = add(target.revenue, -refund.fee);
      }
      for (const payment of input.payments) {
        if (!PAID_STATUSES.has(payment.status.trim().toLowerCase())) continue;
        if (payment.type.trim().toLowerCase() === "deposit") continue;
        if (!REVENUE_TYPES.has(payment.type.trim().toLowerCase())) continue;
        const placed = placeDay(payment.paidDate);
        if (placed === "missing") continue;
        const target = placePayment(payment);
        if (placed === "invalid" || !inDay(placed.date, window)) {
          if (placed === "invalid") withhold(target, "revenue");
          continue;
        }
        if (payment.stripePaymentIntentId) {
          const matched = charges.some((charge) => charge.paymentIntentId === payment.stripePaymentIntentId && succeededCharge(charge));
          if (!matched) withhold(target, "revenue");
          continue;
        }
        target.revenue = add(target.revenue, centsOf(payment.netCollected));
      }
    }
  } else {
    for (const bucket of buckets.values()) withhold(bucket, "revenue");
    for (const vehicle of input.vehicles) withhold(bucketFor(vehicle.id), "revenue");
  }

  const linkedMaintenance = new Set<string>();
  if (!expenseBlocked) {
    for (const vehicle of input.vehicles) bucketFor(vehicle.id);
    for (const expense of input.expenses) {
      const placed = placeDay(expense.incurredOn);
      const target = expense.vehicleId && known.has(expense.vehicleId) ? bucketFor(expense.vehicleId) : unattributed;
      if (placed === "missing" || placed === "invalid") {
        withhold(target, "expense");
        continue;
      }
      if (!inDay(placed.date, window)) continue;
      if (target.expense === null) {
        const key = (expense.category ?? "").trim().toLowerCase() || "uncategorized";
        target.categories.set(key, null);
        continue;
      }
      if (expense.maintenanceRecordId) linkedMaintenance.add(expense.maintenanceRecordId);
      const cents = centsOf(expense.amount);
      const key = (expense.category ?? "").trim().toLowerCase() || "uncategorized";
      target.categories.set(key, add(target.categories.get(key) ?? 0, cents));
      target.expense = add(target.expense, cents);
    }
  } else {
    for (const bucket of buckets.values()) withhold(bucket, "expense");
    for (const vehicle of input.vehicles) withhold(bucketFor(vehicle.id), "expense");
  }

  if (!tollsBlocked) {
    for (const vehicle of input.vehicles) bucketFor(vehicle.id);
    for (const toll of input.tolls) {
      if (!TOLL_TYPES.has(toll.chargeType.trim().toLowerCase())) continue;
      const placed = placeDay(toll.occurredAt);
      const target = toll.vehicleId && known.has(toll.vehicleId) ? bucketFor(toll.vehicleId) : unattributed;
      if (placed === "missing" || placed === "invalid") {
        withhold(target, "tolls");
        continue;
      }
      if (!inDay(placed.date, window)) continue;
      target.tolls = add(target.tolls, centsOf(toll.amount));
    }
  } else {
    for (const bucket of buckets.values()) withhold(bucket, "tolls");
    for (const vehicle of input.vehicles) withhold(bucketFor(vehicle.id), "tolls");
  }

  if (!maintenanceBlocked) {
    for (const vehicle of input.vehicles) bucketFor(vehicle.id);
    for (const row of input.maintenance) {
      if (linkedMaintenance.has(row.id)) continue;
      const placed = firstPlace(row.performedOn, row.completedAt, row.createdAt);
      const target = row.vehicleId && known.has(row.vehicleId) ? bucketFor(row.vehicleId) : unattributed;
      if (placed === "missing" || placed === "invalid") {
        withhold(target, "maintenance");
        continue;
      }
      if (!inDay(placed.date, window)) continue;
      target.maintenance = add(target.maintenance, maintenanceCents(row.companyShare, row.totalCost));
    }
  } else {
    for (const bucket of buckets.values()) withhold(bucket, "maintenance");
    for (const vehicle of input.vehicles) withhold(bucketFor(vehicle.id), "maintenance");
  }

  if (revenueBlocked) {
    for (const bucket of buckets.values()) withhold(bucket, "revenue");
    withhold(unattributed, "revenue");
  }

  const rows = input.vehicles
    .filter((vehicle) => vehicle.id)
    .map((vehicle) => toRow(vehicle.id, vehicleLabel(vehicle), bucketFor(vehicle.id)))
    .sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));

  const truncated =
    input.caps.vehicles ||
    input.caps.rentals ||
    input.caps.payments ||
    input.caps.expenses ||
    input.caps.tolls ||
    input.caps.maintenance ||
    (input.stripe.ok && input.stripe.truncated) ||
    (!input.stripe.ok && input.stripe.truncated);
  const notes = [VEHICLE_PNL_REVENUE_NOTE, VEHICLE_PNL_ONCE_NOTE, VEHICLE_PNL_TOLLS_NOTE];
  if (!input.stripe.ok && !input.stripe.truncated) notes.push(VEHICLE_PNL_STRIPE_NOTE);
  if (truncated) notes.push(VEHICLE_PNL_TRUNCATED_NOTE);

  return {
    month: window.month,
    from: window.from,
    through: window.through,
    rows,
    unattributed: {
      revenueCents: unattributed.revenue,
      expenseCents: unattributed.expense,
      tollsTicketsCents: unattributed.tolls,
      maintenanceCents: unattributed.maintenance,
    },
    truncated,
    notes,
  };
}

function emptyBucket(): MoneyBucket {
  return { revenue: 0, expense: 0, tolls: 0, maintenance: 0, categories: new Map() };
}

function withhold(bucket: MoneyBucket, field: "revenue" | "expense" | "tolls" | "maintenance") {
  bucket[field] = null;
  if (field === "expense") {
    for (const key of bucket.categories.keys()) bucket.categories.set(key, null);
  }
}

function add(current: number | null, cents: number | null): number | null {
  if (current === null || cents === null) return null;
  const next = current + cents;
  return Number.isSafeInteger(next) ? next : null;
}

function centsOf(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number" && value !== null) return null;
  return decimalSourceCents(value);
}

function maintenanceCents(share: unknown, total: unknown): number | null {
  if (share === null || share === undefined || share === "") return centsOf(total);
  return centsOf(share);
}

function toRow(vehicleId: string, label: string, bucket: MoneyBucket): VehiclePnlRow {
  const expenses = [...bucket.categories.entries()]
    .map(([category, cents]) => ({ category, label: categoryLabel(category), cents }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.category.localeCompare(b.category));
  const expenseCents = bucket.expense === null || expenses.some((line) => line.cents === null) ? null : bucket.expense;
  return {
    vehicleId,
    label,
    revenueCents: bucket.revenue,
    expenses,
    expenseCents,
    tollsTicketsCents: bucket.tolls,
    maintenanceCents: bucket.maintenance,
    netCents: net(bucket.revenue, expenseCents, bucket.tolls, bucket.maintenance),
  };
}

function net(revenue: number | null, expense: number | null, tolls: number | null, maintenance: number | null): number | null {
  if (revenue === null || expense === null || tolls === null || maintenance === null) return null;
  const value = revenue - expense - tolls - maintenance;
  return Number.isSafeInteger(value) ? value : null;
}

function vehicleLabel(vehicle: VehiclePnlVehicle): string {
  const name = [vehicle.year, vehicle.make, vehicle.model]
    .filter((part) => part !== null && String(part).trim() !== "")
    .join(" ");
  const plate = vehicle.licensePlate?.trim();
  return [name, plate].filter(Boolean).join(" · ") || "Vehicle";
}

function vehicleFor(
  payment: VehiclePnlPayment,
  rentals: Map<string, VehiclePnlRental>,
  known: Set<string>,
): string | null {
  if (payment.vehicleId && known.has(payment.vehicleId)) return payment.vehicleId;
  const rental = payment.rentalId ? rentals.get(payment.rentalId) : undefined;
  if (rental?.vehicleId && known.has(rental.vehicleId)) return rental.vehicleId;
  return null;
}

function distinct(ids: string[]): boolean {
  return new Set(ids).size === ids.length && ids.every((id) => id.trim());
}

function succeededCharge(charge: VehiclePnlCharge): boolean {
  return charge.paid && charge.captured && charge.status === "succeeded" && charge.amount > 0;
}

function inUnix(created: number, window: VehiclePnlWindow): boolean {
  return Number.isSafeInteger(created) && created >= window.gte && created < window.lt;
}

function inDay(date: string, window: VehiclePnlWindow): boolean {
  return date >= window.from && date < window.to;
}

function placeDay(value: string | null | undefined): Place {
  if (value === null || value === undefined || value.trim() === "") return "missing";
  if (validFinanceDate(value)) return { date: value };
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    const date = Number.isNaN(parsed.getTime()) ? null : etYmd(parsed);
    return date && validFinanceDate(date) ? { date } : "invalid";
  }
  return "invalid";
}

function firstPlace(...values: (string | null)[]): Place {
  let saw = false;
  for (const value of values) {
    const placed = placeDay(value);
    if (placed === "missing") continue;
    saw = true;
    if (placed === "invalid") return "invalid";
    return placed;
  }
  return saw ? "invalid" : "missing";
}
