import { matchDriver, type DriverMatchApplication, type DriverMatchRental } from "./stripe-driver-match";

/**
 * Read-only deposits and refunds ledger. Refund totals count succeeded
 * refunds. Gross collected counts succeeded, paid, captured charges.
 * A non-USD succeeded amount withholds the total instead of converting it.
 * Held deposits come from rental and payment rows; a blank amount stays blank.
 */

export type DepositPeriod = "this_month" | "last_month" | "last_90";

export const PERIOD_LABELS: Record<DepositPeriod, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  last_90: "90 Days",
};

export type LedgerWindow = { from: string; to: string; gte: number; lt: number };

export type LedgerCharge = {
  id: string;
  amountCents: number | null;
  currency: string;
  created: number;
  succeeded: boolean;
};
export type LedgerCustomer = { id: string; email: string | null; phone: string | null };
export type LedgerRefund = {
  id: string;
  amountCents: number | null;
  currency: string;
  status: string;
  reason: string | null;
  created: number;
  chargeCreated: number;
  customer: LedgerCustomer | null;
};
export type LedgerMatch = {
  driverId: string | null;
  driverName: string | null;
  phone: string | null;
  confidence: "high" | "medium" | "low" | null;
  reason: string;
};
export type RefundRow = {
  id: string;
  amountCents: number | null;
  currency: string;
  reason: string | null;
  status: string;
  chargeDate: string | null;
  match: LedgerMatch;
};
export type DepositRentalRow = {
  id: string;
  applicationId: string | null;
  driverUserId: string | null;
  vehicleId: string | null;
  depositAmount: number | null;
  depositHeld: boolean | null;
  depositStatus: string | null;
};
export type DepositPaymentRow = {
  id: string;
  rentalId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  status: string | null;
  netCollected: number | null;
  paidDate: string | null;
};
export type DepositVehicleRow = { id: string; year: number | null; make: string | null; model: string | null; unitNumber: string | null };
export type DepositPerson = { id: string; fullName: string; userId: string | null; phone: string | null };
export type HeldDepositRow = {
  id: string;
  amountCents: number | null;
  driverId: string | null;
  driverName: string | null;
  phone: string | null;
  vehicle: string | null;
  collectedDate: string | null;
  status: string;
};
export type LedgerTotals = { grossCents: number; refundCents: number; netCents: number } | null;
export type DepositsLedgerReport = {
  period: DepositPeriod;
  from: string;
  through: string;
  totals: LedgerTotals;
  refunds: RefundRow[];
  deposits: HeldDepositRow[];
};

const CLOSED = new Set(["refunded", "partially_refunded", "applied", "forfeited"]);

export function etYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function addCalendarDays(ymd: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null;
}

export function etMidnightUnix(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second")) - instant;
  };
  let utc = utcMidnight - offset(utcMidnight);
  const again = offset(utc);
  if (again !== offset(utcMidnight)) utc = utcMidnight - again;
  const seconds = Math.floor(utc / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** Inclusive Eastern dates. `to` is the exclusive midnight after the last day. 90 Days includes today. */
export function periodWindow(period: DepositPeriod, now: Date): LedgerWindow | null {
  const today = etYmd(now);
  if (!today) return null;
  const [year, month] = today.split("-").map(Number);
  if (!year || !month) return null;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const previousMonth = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`;
  const from = period === "this_month" ? monthStart : period === "last_month" ? previousMonth : addCalendarDays(today, -89);
  const to = period === "this_month" ? nextMonth : period === "last_month" ? monthStart : addCalendarDays(today, 1);
  if (!from || !to) return null;
  const gte = etMidnightUnix(from);
  const lt = etMidnightUnix(to);
  if (gte === null || lt === null || lt <= gte) return null;
  return { from, to, gte, lt };
}

export function dollarsToCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents;
}

export function titleLabel(value: string | null): string {
  const text = value?.trim();
  if (!text) return "—";
  return text.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function buildDepositsLedger(input: {
  period: DepositPeriod;
  now: Date;
  applications: DriverMatchApplication[];
  rentals: DriverMatchRental[];
  charges: LedgerCharge[];
  refunds: LedgerRefund[];
  depositRentals: DepositRentalRow[];
  depositPayments: DepositPaymentRow[];
  vehicles: DepositVehicleRow[];
  people: DepositPerson[];
}): DepositsLedgerReport | null {
  const window = periodWindow(input.period, input.now);
  if (!window) return null;
  const charges = unique(input.charges.filter((row) => row.created >= window.gte && row.created < window.lt));
  const refunds = unique(input.refunds.filter((row) => row.created >= window.gte && row.created < window.lt));
  if (!charges || !refunds) return null;
  const through = addCalendarDays(window.to, -1);
  if (!through) return null;
  return {
    period: input.period,
    from: window.from,
    through,
    totals: ledgerTotals(charges, refunds),
    refunds: refunds.map((refund) => ({
      id: refund.id,
      amountCents: refund.amountCents,
      currency: refund.currency,
      reason: refund.reason,
      status: titleLabel(refund.status),
      chargeDate: etYmd(new Date(refund.chargeCreated * 1000)),
      match: refund.customer
        ? matchOf(matchDriver({ applications: input.applications, rentals: input.rentals, customer: refund.customer }))
        : { driverId: null, driverName: null, phone: null, confidence: null, reason: "No Match" },
    })).sort((a, b) => (b.chargeDate ?? "").localeCompare(a.chargeDate ?? "") || a.id.localeCompare(b.id)),
    deposits: heldDeposits(input),
  };
}

export function ledgerTotals(charges: LedgerCharge[], refunds: LedgerRefund[]): LedgerTotals {
  const collected = charges.filter((row) => row.succeeded);
  const returned = refunds.filter((row) => row.status === "succeeded");
  if ([...collected, ...returned].some((row) => row.currency.toLowerCase() !== "usd" || row.amountCents === null)) return null;
  const gross = sum(collected.map((row) => row.amountCents));
  const refunded = sum(returned.map((row) => row.amountCents));
  if (gross === null || refunded === null || !Number.isSafeInteger(gross - refunded)) return null;
  return { grossCents: gross, refundCents: refunded, netCents: gross - refunded };
}

export function heldDeposits(input: {
  depositRentals: DepositRentalRow[];
  depositPayments: DepositPaymentRow[];
  vehicles: DepositVehicleRow[];
  people: DepositPerson[];
}): HeldDepositRow[] {
  const vehicles = new Map(input.vehicles.map((row) => [row.id, row]));
  const people = input.people.filter((person) => person.id);
  const byId = new Map(people.map((person) => [person.id, person]));
  const rows: HeldDepositRow[] = [];
  const knownRentals = new Set(input.depositRentals.map((rental) => rental.id));
  for (const rental of input.depositRentals) {
    if (!isHeld(rental)) continue;
    const paid = input.depositPayments.filter((payment) => payment.rentalId === rental.id && payment.status === "paid");
    const person = onePerson(rental, paid, byId, people);
    rows.push({
      id: rental.id,
      amountCents: paid.length ? sum(paid.map((payment) => dollarsToCents(payment.netCollected))) : dollarsToCents(rental.depositAmount),
      driverId: person?.id ?? null,
      driverName: person?.fullName ?? null,
      phone: person?.phone ?? null,
      vehicle: vehicleLabel(vehicles.get(rental.vehicleId ?? "")),
      collectedDate: earliestDate(paid.map((payment) => payment.paidDate)),
      status: titleLabel(heldStatus(rental)),
    });
  }
  for (const payment of input.depositPayments) {
    if (payment.status !== "paid" || (payment.rentalId && knownRentals.has(payment.rentalId))) continue;
    const person = payment.driverId ? byId.get(payment.driverId) ?? null : null;
    rows.push({
      id: payment.id,
      amountCents: dollarsToCents(payment.netCollected),
      driverId: person?.id ?? null,
      driverName: person?.fullName ?? null,
      phone: person?.phone ?? null,
      vehicle: vehicleLabel(vehicles.get(payment.vehicleId ?? "")),
      collectedDate: dateOnly(payment.paidDate),
      status: "Paid",
    });
  }
  return rows.sort((a, b) => (b.collectedDate ?? "").localeCompare(a.collectedDate ?? "") || a.id.localeCompare(b.id));
}

function matchOf(found: ReturnType<typeof matchDriver>): LedgerMatch {
  return { driverId: found.driverId, driverName: found.driverName, phone: found.phone, confidence: found.confidence, reason: found.reason };
}
function isHeld(rental: DepositRentalRow): boolean {
  const status = rental.depositStatus?.trim().toLowerCase() ?? "";
  if (CLOSED.has(status)) return false;
  return rental.depositHeld === true || status === "held" || status === "pending_disposition";
}
function heldStatus(rental: DepositRentalRow): string {
  const status = rental.depositStatus?.trim().toLowerCase() ?? "";
  if ((status === "" || status === "none") && rental.depositHeld === true) return "held";
  return status || "held";
}
function onePerson(rental: DepositRentalRow, paid: DepositPaymentRow[], byId: Map<string, DepositPerson>, people: DepositPerson[]): DepositPerson | null {
  const ids = new Set<string>();
  if (rental.applicationId && byId.has(rental.applicationId)) ids.add(rental.applicationId);
  if (rental.driverUserId) for (const person of people) if (person.userId === rental.driverUserId) ids.add(person.id);
  for (const payment of paid) if (payment.driverId && byId.has(payment.driverId)) ids.add(payment.driverId);
  if (ids.size !== 1) return null;
  return byId.get([...ids][0]!) ?? null;
}
function vehicleLabel(vehicle: DepositVehicleRow | undefined): string | null {
  if (!vehicle) return null;
  const name = [vehicle.year, vehicle.make?.trim(), vehicle.model?.trim()].filter((part) => part !== null && part !== undefined && String(part).trim() !== "").join(" ");
  const unit = vehicle.unitNumber?.trim() || null;
  if (unit && name) return `${unit} · ${name}`;
  return unit || name || null;
}
function dateOnly(value: string | null): string | null {
  const text = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}
function earliestDate(values: Array<string | null>): string | null {
  const dates = values.map(dateOnly).filter((date): date is string => !!date).sort();
  return dates[0] ?? null;
}
function sum(values: Array<number | null>): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || !Number.isSafeInteger(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
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
