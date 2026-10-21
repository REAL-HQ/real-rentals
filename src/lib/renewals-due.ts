// Rental Renewal Due rules. No database access and no writes.

export const RENEWALS_TIME_ZONE = "America/New_York";
export const RENEWAL_WINDOW_DAYS = 7;
export const RENEWALS_FETCH_LIMIT = 1000;

/**
 * Same words as PaymentsPanel STATUS_LABEL. An unknown payments.status stays
 * as stored. This board does not invent a label and does not use
 * rentals.payment_status.
 */
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  pending: "Processing",
  current: "Due",
  paid: "Paid",
  overdue: "Overdue",
  past_due: "Past Due",
  failed: "Failed",
  unpaid: "Unpaid",
  collections: "In Collections",
  refunded: "Refunded",
  waived: "Waived",
  void: "Void",
  late: "Late",
};

export const RENEWALS_DUE_OMITTED = [
  "There is no paid-through or coverage-through column on rentals or payments. payments.late_fee_applied_through is a late-fee watermark and is not used as paid-through.",
  "Next billing is rentals.next_payment_due. End is rentals.end_date. A rental is listed when status is active and at least one of those dates is on the Eastern today through seven days later, inclusive.",
  "Dates before the Eastern today are not in the next 7 days. A date eight or more days out is not in the next 7 days.",
  "Overdue Return is a separate list of active rentals whose end_date is before the Eastern today. It is not the next 7 days. That read and the due-soon end-date read are capped on their own, so an overdue row cannot push a due-soon row past the cap.",
  "Active means rentals.status is active, the spelling activate_rental_tx writes. Other statuses are omitted.",
  "Last payment status is payments.status on the newest payments row for that rental by created_at, then id. There is no last-payment pointer. rentals.payment_status is a rental-level field and is not shown as the last charge. A rental with no payment row reads No Payment.",
  "Driver name and the Drivers link use rentals.application_id and applications.full_name. rentals.driver_id is the auth user and is not the Drivers screen id. A rental with no application_id has no driver link.",
  "The Payments screen has no rental deep link. The link opens Payments.",
  "Stripe is not read. This board does not write.",
  "Each read is capped at 1000 rows. Payments keep the newest created_at values. A payment outside that cap is not used, so that rental can read No Payment.",
] as const;

export function easternCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RENEWALS_TIME_ZONE,
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

export function renewalHorizon(today: string, days = RENEWAL_WINDOW_DAYS): string {
  return addCalendarDays(today, days);
}

export function formatRenewalDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(isoDate.slice(0, 10)));
}

export function formatRenewalHeading(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(utcDate(isoDate.slice(0, 10)));
}

function utcDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

export function inRenewalWindow(value: string | null | undefined, today: string, days = RENEWAL_WINDOW_DAYS): boolean {
  const date = dateOnly(value);
  if (!date) return false;
  return date >= today && date <= renewalHorizon(today, days);
}

/** A rent charge in one of these statuses keeps the history from being good. */
const BAD_RENT_STATUSES = ["failed", "late", "overdue", "past_due", "unpaid", "collections", "current"] as const;

/** These rent statuses are defined and neither a clean payment nor a problem. */
const NEUTRAL_RENT_STATUSES = ["pending", "upcoming", "refunded", "waived", "void"] as const;

export type RenewalHistoryCharge = {
  status?: string | null;
  type?: string | null;
  late_fees?: number | null;
  paid_date?: string | null;
  due_date?: string | null;
  attempt_count?: number | null;
  failure_reason?: string | null;
};

function rentStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function isRentCharge(charge: RenewalHistoryCharge): boolean {
  return chargeType(charge) === "rent";
}

/** Paid after the due date, with a late fee, a retry, or a recorded failure. */
export function isPaidLate(charge: RenewalHistoryCharge): boolean {
  if (Number(charge.late_fees ?? 0) > 0) return true;
  if (Number(charge.attempt_count ?? 0) > 1) return true;
  if (typeof charge.failure_reason === "string" && charge.failure_reason.trim() !== "") return true;
  const paid = dateOnly(charge.paid_date);
  const due = dateOnly(charge.due_date);
  return paid != null && due != null && paid > due;
}

/** Not rent and not a deposit. A failed or paid-late one of these is not a clean history. */
const ANCILLARY_CHARGE_TYPES = ["late_fee", "toll", "fee", "damage", "other"] as const;

function chargeType(charge: RenewalHistoryCharge): string {
  return typeof charge.type === "string" ? charge.type.trim().toLowerCase() : "rent";
}

function isDepositCharge(charge: RenewalHistoryCharge): boolean {
  return chargeType(charge) === "deposit";
}

/**
 * Good means at least one clean paid rent charge.
 * Deposits are ignored. pending, upcoming, refunded, waived, and void are allowed
 * and are not paid charges. current and the late or failed statuses are not good.
 * Any other rent status is unknown and is not good. A paid-late rent charge is not clean.
 * A failed or paid-late late fee, toll, fee, damage, or other charge is not clean.
 * Those types are not counted as Paid Charges.
 */
export function hasGoodPaymentHistory(charges: readonly RenewalHistoryCharge[]): boolean {
  let paid = 0;
  for (const charge of charges) {
    if (isDepositCharge(charge)) continue;
    const status = rentStatus(charge.status);
    if (!isRentCharge(charge)) {
      if (!(ANCILLARY_CHARGE_TYPES as readonly string[]).includes(chargeType(charge))) continue;
      if ((BAD_RENT_STATUSES as readonly string[]).includes(status)) return false;
      if (status === "paid" && isPaidLate(charge)) return false;
      continue;
    }
    if ((BAD_RENT_STATUSES as readonly string[]).includes(status)) return false;
    if ((NEUTRAL_RENT_STATUSES as readonly string[]).includes(status)) continue;
    if (status === "paid") {
      if (isPaidLate(charge)) return false;
      paid += 1;
      continue;
    }
    return false;
  }
  return paid > 0;
}

/** Paid rent charges, including ones that were paid late. Deposits are not counted. */
export function paidRentCharges(charges: readonly RenewalHistoryCharge[]): number {
  let paid = 0;
  for (const charge of charges) {
    if (!isRentCharge(charge)) continue;
    if (rentStatus(charge.status) === "paid") paid += 1;
  }
  return paid;
}

/** Whole Eastern calendar days from end date to today. Uses the same UTC date arithmetic as addCalendarDays. */
export function daysOverdue(endDate: string, today: string): number {
  const end = utcDate(dateOnly(endDate) ?? "");
  const now = utcDate(today);
  if (Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())) return 0;
  return Math.round((now.getTime() - end.getTime()) / 86400000);
}

export function overdueReturnLabel(days: number): string {
  return days === 1 ? "1 Day Overdue" : `${days} Days Overdue`;
}

export function lastPaymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "No Payment";
  return PAYMENT_STATUS_LABEL[status] ?? status;
}

export function renewalVehicleLabel(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  unit_number?: string | null;
  license_plate?: string | null;
} | null): string {
  if (!vehicle) return "Unknown Vehicle";
  const unit = vehicle.unit_number ? `#${vehicle.unit_number}` : "No Unit";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part != null && String(part) !== "").join(" ");
  const plate = vehicle.license_plate ? ` · ${vehicle.license_plate}` : "";
  return `${unit}${name ? ` · ${name}` : ""}${plate}`;
}

export type RenewalRental = {
  id: string;
  status: string | null;
  driver_id: string | null;
  application_id: string | null;
  vehicle_id: string | null;
  weekly_rate: number | null;
  end_date: string | null;
  next_payment_due: string | null;
};

export type RenewalApplication = {
  id: string;
  full_name: string | null;
};

export type RenewalVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  unit_number: string | null;
  license_plate: string | null;
};

export type RenewalPayment = {
  id: string;
  rental_id: string | null;
  status: string | null;
  created_at: string;
  type?: string | null;
  late_fees?: number | null;
  paid_date?: string | null;
  due_date?: string | null;
  attempt_count?: number | null;
  failure_reason?: string | null;
};

export type RenewalDueRow = {
  rentalId: string;
  driverName: string;
  driverSearch: { tab: "drivers"; id: string } | null;
  vehicleLabel: string;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  endDate: string | null;
  triggerDate: string;
  reasons: string[];
  lastPaymentStatus: string;
  paymentsSearch: { tab: "payments" };
  /** Null while the payment-history flag is off, or when the payment read was capped. */
  paidCharges: number | null;
  goodPaymentHistory: boolean | null;
};

export type OverdueReturnRow = {
  rentalId: string;
  driverName: string;
  driverSearch: { tab: "drivers"; id: string } | null;
  vehicleLabel: string;
  endDate: string;
  daysOverdue: number;
  label: string;
};

export type RenewalsDueInput = {
  today: string;
  rentals: RenewalRental[];
  applications: RenewalApplication[];
  vehicles: RenewalVehicle[];
  payments: RenewalPayment[];
  overdueRentals?: RenewalRental[];
  billingTruncated?: boolean;
  endTruncated?: boolean;
  overdueTruncated?: boolean;
  applicationsTruncated?: boolean;
  vehiclesTruncated?: boolean;
  paymentsTruncated?: boolean;
  /** The payment-history controls. Off unless the caller has already checked the flag. */
  historyEnabled?: boolean;
  windowDays?: 7 | 14;
  goodHistoryOnly?: boolean;
};

export type RenewalsDueBoard = {
  today: string;
  through: string;
  heading: string;
  rows: RenewalDueRow[];
  overdue: OverdueReturnRow[];
  billingTruncated: boolean;
  endTruncated: boolean;
  overdueTruncated: boolean;
  applicationsTruncated: boolean;
  vehiclesTruncated: boolean;
  paymentsTruncated: boolean;
  /** True when Good Payment History is on and the payment read was capped, so the due list is not filtered down to empty. */
  historyUnavailable: boolean;
  omitted: readonly string[];
};

function laterPayment(current: RenewalPayment, next: RenewalPayment): RenewalPayment {
  const currentTime = Date.parse(current.created_at);
  const nextTime = Date.parse(next.created_at);
  const currentRank = Number.isNaN(currentTime) ? Number.NEGATIVE_INFINITY : currentTime;
  const nextRank = Number.isNaN(nextTime) ? Number.NEGATIVE_INFINITY : nextTime;
  if (currentRank !== nextRank) return nextRank > currentRank ? next : current;
  return next.id > current.id ? next : current;
}

export function buildRenewalsDue(input: RenewalsDueInput): RenewalsDueBoard {
  const today = input.today;
  const historyEnabled = input.historyEnabled === true;
  // The 7/14 window and the Good Payment History filter change Renewal Due rows only.
  // Overdue Return stays active rentals whose end date is before today.
  const windowDays = historyEnabled && input.windowDays === 14 ? 14 : RENEWAL_WINDOW_DAYS;
  const historyUnavailable = historyEnabled && input.goodHistoryOnly === true && input.paymentsTruncated === true;
  const applications = new Map(input.applications.map((row) => [row.id, row]));
  const vehicles = new Map(input.vehicles.map((row) => [row.id, row]));
  const latestPayment = new Map<string, RenewalPayment>();
  const chargesByRental = new Map<string, RenewalPayment[]>();
  for (const payment of input.payments) {
    if (!payment.rental_id) continue;
    const current = latestPayment.get(payment.rental_id);
    latestPayment.set(payment.rental_id, current ? laterPayment(current, payment) : payment);
    const list = chargesByRental.get(payment.rental_id) ?? [];
    list.push(payment);
    chargesByRental.set(payment.rental_id, list);
  }

  const seen = new Set<string>();
  const rows: RenewalDueRow[] = [];
  for (const rental of input.rentals) {
    if (seen.has(rental.id)) continue;
    seen.add(rental.id);
    if (rental.status !== "active") continue;
    const nextPaymentDue = dateOnly(rental.next_payment_due);
    const endDate = dateOnly(rental.end_date);
    const nextInWindow = nextPaymentDue != null && inRenewalWindow(nextPaymentDue, today, windowDays);
    const endInWindow = endDate != null && inRenewalWindow(endDate, today, windowDays);
    if (!nextInWindow && !endInWindow) continue;

    const reasons: string[] = [];
    if (nextInWindow) reasons.push("Next Billing");
    if (endInWindow) reasons.push("End Date");
    const triggerDate = [nextInWindow ? nextPaymentDue : null, endInWindow ? endDate : null]
      .filter((date): date is string => date != null)
      .sort()[0];
    const application = rental.application_id ? applications.get(rental.application_id) : undefined;
    const name = application?.full_name?.trim() ?? "";
    const payment = latestPayment.get(rental.id);
    const charges = chargesByRental.get(rental.id) ?? [];
    const historyKnown = historyEnabled && input.paymentsTruncated !== true;
    const goodPaymentHistory = historyKnown ? hasGoodPaymentHistory(charges) : null;
    if (!historyUnavailable && historyEnabled && input.goodHistoryOnly === true && goodPaymentHistory !== true) continue;

    rows.push({
      rentalId: rental.id,
      driverName: rental.application_id ? name || "Unnamed Driver" : "No Driver",
      driverSearch: rental.application_id ? { tab: "drivers", id: rental.application_id } : null,
      vehicleLabel: renewalVehicleLabel(rental.vehicle_id ? vehicles.get(rental.vehicle_id) ?? null : null),
      weeklyRate: rental.weekly_rate,
      nextPaymentDue,
      endDate,
      triggerDate,
      reasons,
      lastPaymentStatus: lastPaymentStatusLabel(payment?.status),
      paymentsSearch: { tab: "payments" },
      paidCharges: historyKnown ? paidRentCharges(charges) : null,
      goodPaymentHistory,
    });
  }

  rows.sort((a, b) => a.triggerDate.localeCompare(b.triggerDate) || a.rentalId.localeCompare(b.rentalId));

  const overdueSeen = new Set<string>();
  const overdue: OverdueReturnRow[] = [];
  for (const rental of input.overdueRentals ?? []) {
    if (overdueSeen.has(rental.id)) continue;
    overdueSeen.add(rental.id);
    if (rental.status !== "active") continue;
    const endDate = dateOnly(rental.end_date);
    if (!endDate || endDate >= today) continue;
    const late = daysOverdue(endDate, today);
    if (late < 1) continue;
    const application = rental.application_id ? applications.get(rental.application_id) : undefined;
    const name = application?.full_name?.trim() ?? "";
    overdue.push({
      rentalId: rental.id,
      driverName: rental.application_id ? name || "Unnamed Driver" : "No Driver",
      driverSearch: rental.application_id ? { tab: "drivers", id: rental.application_id } : null,
      vehicleLabel: renewalVehicleLabel(rental.vehicle_id ? vehicles.get(rental.vehicle_id) ?? null : null),
      endDate,
      daysOverdue: late,
      label: overdueReturnLabel(late),
    });
  }
  overdue.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.rentalId.localeCompare(b.rentalId));

  return {
    today,
    through: renewalHorizon(today, windowDays),
    heading: formatRenewalHeading(today),
    rows,
    overdue,
    billingTruncated: input.billingTruncated === true,
    endTruncated: input.endTruncated === true,
    overdueTruncated: input.overdueTruncated === true,
    applicationsTruncated: input.applicationsTruncated === true,
    vehiclesTruncated: input.vehiclesTruncated === true,
    paymentsTruncated: input.paymentsTruncated === true,
    historyUnavailable,
    omitted: RENEWALS_DUE_OMITTED,
  };
}
