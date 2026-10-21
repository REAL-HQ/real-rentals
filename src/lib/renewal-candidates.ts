/**
 * Renewal candidates. An active rental whose end date falls on the Eastern
 * today through 14 days later, and whose payment rows are a good history.
 *
 * This is not Renewal Due. That board is a 7-day billing-or-end list and
 * shows the latest payment status whatever it is. This list uses the end
 * date only, and a rental with a late, failed, or missing paid charge is
 * left off.
 *
 * No database access and no writes.
 */
export const RENEWAL_CANDIDATE_TIME_ZONE = "America/New_York";
export const RENEWAL_CANDIDATE_DAYS = 14;

/** Statuses that mean the renter has not kept a clean payment record. */
export const BAD_PAYMENT_STATUSES = [
  "failed",
  "late",
  "overdue",
  "past_due",
  "unpaid",
  "collections",
] as const;

export type CandidateRental = {
  id: string;
  status: string | null;
  applicationId: string | null;
  vehicleId: string | null;
  endDate: string | null;
};

export type CandidateApplication = {
  id: string;
  fullName: string | null;
};

export type CandidateVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  unitNumber: string | null;
};

export type CandidatePayment = {
  rentalId: string | null;
  status: string | null;
};

export type RenewalCandidateRow = {
  rentalId: string;
  driverName: string;
  applicationId: string | null;
  vehicleLabel: string;
  endDate: string;
  daysLeft: number;
  paidCharges: number;
  historyLabel: "Good";
};

export type RenewalCandidateList = {
  today: string;
  through: string;
  rows: RenewalCandidateRow[];
};

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RENEWAL_CANDIDATE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("Expected a calendar date");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function renewalCandidateHorizon(today: string): string {
  return addCalendarDays(today, RENEWAL_CANDIDATE_DAYS);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}` : null;
}

function daySerial(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return Number.NaN;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/** End date is on the Eastern today through 14 days later, inclusive. */
export function endsWithinCandidateWindow(endDate: string | null | undefined, today: string): boolean {
  const date = dateOnly(endDate);
  if (!date) return false;
  return date >= today && date <= renewalCandidateHorizon(today);
}

export function daysUntilEnd(endDate: string, today: string): number {
  return Math.max(0, daySerial(dateOnly(endDate) ?? "") - daySerial(today));
}

/**
 * Good means at least one paid charge and no failed, late, overdue, past-due,
 * unpaid, or collections row. An empty history is not good. An unknown
 * status is not good.
 */
export function hasGoodPaymentHistory(statuses: readonly (string | null | undefined)[]): boolean {
  let paid = 0;
  for (const status of statuses) {
    const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!raw) return false;
    if ((BAD_PAYMENT_STATUSES as readonly string[]).includes(raw)) return false;
    if (raw === "paid") paid += 1;
  }
  return paid > 0;
}

export function candidateVehicleLabel(vehicle: CandidateVehicle | null): string {
  if (!vehicle) return "Unknown Vehicle";
  const unit = vehicle.unitNumber ? `#${vehicle.unitNumber}` : "No Unit";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part != null && String(part) !== "").join(" ");
  return name ? `${unit} · ${name}` : unit;
}

export function formatCandidateDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function buildRenewalCandidates(input: {
  today: string;
  rentals: readonly CandidateRental[];
  applications: readonly CandidateApplication[];
  vehicles: readonly CandidateVehicle[];
  payments: readonly CandidatePayment[];
}): RenewalCandidateList {
  const names = new Map(input.applications.map((app) => [app.id, app.fullName?.trim() || "Unknown Driver"]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const paymentsByRental = new Map<string, string[]>();
  for (const payment of input.payments) {
    if (!payment.rentalId) continue;
    const list = paymentsByRental.get(payment.rentalId) ?? [];
    list.push(payment.status ?? "");
    paymentsByRental.set(payment.rentalId, list);
  }

  const rows: RenewalCandidateRow[] = [];
  for (const rental of input.rentals) {
    if ((rental.status ?? "").trim().toLowerCase() !== "active") continue;
    const endDate = dateOnly(rental.endDate);
    if (!endDate || !endsWithinCandidateWindow(endDate, input.today)) continue;
    const statuses = paymentsByRental.get(rental.id) ?? [];
    if (!hasGoodPaymentHistory(statuses)) continue;
    rows.push({
      rentalId: rental.id,
      driverName: rental.applicationId ? names.get(rental.applicationId) ?? "Unknown Driver" : "Unknown Driver",
      applicationId: rental.applicationId,
      vehicleLabel: candidateVehicleLabel(rental.vehicleId ? vehicles.get(rental.vehicleId) ?? null : null),
      endDate,
      daysLeft: daysUntilEnd(endDate, input.today),
      paidCharges: statuses.filter((status) => status.trim().toLowerCase() === "paid").length,
      historyLabel: "Good",
    });
  }

  rows.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.driverName.localeCompare(b.driverName) || a.rentalId.localeCompare(b.rentalId));
  return {
    today: input.today,
    through: renewalCandidateHorizon(input.today),
    rows,
  };
}
