// Read-only rules for the Active Rentals board. No database access.
//
// Money, incidents, and driver issues are manager data. A failed read stays
// null so the board never prints a zero in place of a query that did not load.

import { isIssueClosed } from "@/lib/driver-issues";

/** Same window the vehicle profile already uses for plate, registration, and insurance. */
export const DOCUMENT_EXPIRING_DAYS = 45;

const CLOSED_INCIDENTS = new Set(["closed", "written_off"]);

export function isOpenIncidentStatus(status: string | null | undefined): boolean {
  return !CLOSED_INCIDENTS.has(String(status ?? "").trim().toLowerCase());
}

/** YYYY-MM-DD in America/New_York. */
export function etDateISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dateOnly(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, month, day] = match[1].split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return match[1];
}

/** Calendar days from `from` to `to`. Null when either date is missing. */
export function calendarDaysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = dateOnly(from);
  const b = dateOnly(to);
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Oct 21, 2026 ET. Date-only values stay on that calendar day. */
export function formatBoardDate(value: string | null | undefined): string {
  const day = dateOnly(value);
  if (!day) return "";
  const [year, month, date] = day.split("-").map(Number);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date, 16)));
  return `${formatted} ET`;
}

export function weeksIn(startDate: string | null | undefined, today: string): number | null {
  const days = calendarDaysBetween(startDate, today);
  if (days == null) return null;
  if (days < 0) return 0;
  return Math.floor(days / 7);
}

/** Days past next_payment_due. Null when the due date is missing. Zero when it is today or later. */
export function overdueDays(nextPaymentDue: string | null | undefined, today: string): number | null {
  const days = calendarDaysBetween(nextPaymentDue, today);
  if (days == null) return null;
  return Math.max(0, days);
}

export function documentsExpiring(dates: Array<string | null | undefined>, today: string): boolean {
  return dates.some((value) => {
    const days = calendarDaysBetween(today, value);
    return days != null && days <= DOCUMENT_EXPIRING_DAYS;
  });
}

export type ReadResult<T> = { ok: true; rows: T[] } | { ok: false };

export type ActiveRentalSource = {
  id: string;
  driverId: string;
  driverName: string;
  applicationId: string | null;
  vehicleId: string;
  vehicleLabel: string;
  startDate: string;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
};

export type PaymentFact = {
  rentalId: string | null;
  status: string | null;
  paidDate: string | null;
  dueDate: string | null;
  createdAt: string;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
};

export type IssueFact = {
  rentalId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  status: string | null;
};

export type IncidentFact = {
  id: string;
  rentalId: string | null;
  vehicleId: string | null;
  status: string | null;
};

export type ActiveRentalRow = {
  id: string;
  driverId: string;
  driverName: string;
  applicationId: string | null;
  vehicleId: string;
  vehicleLabel: string;
  startDate: string;
  weeksIn: number | null;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  overdueDays: number | null;
  /** Null when the payments read failed or no payment row exists. */
  lastPaymentStatus: string | null;
  /** Null when the payments read failed or there is no payment to attribute. */
  lastPaymentViaStripe: boolean | null;
  paymentsLoaded: boolean;
  /** Null when the issues read failed. */
  openIssues: number | null;
  /** Null when the incidents read failed. */
  openIncidents: number | null;
  /** Null when the document dates could not be read. */
  documentsExpiring: boolean | null;
};

function paymentRank(payment: PaymentFact): string {
  return payment.createdAt || payment.paidDate || payment.dueDate || "";
}

function latestPayment(rentalId: string, payments: PaymentFact[]): PaymentFact | null {
  const mine = payments.filter((p) => p.rentalId === rentalId);
  if (!mine.length) return null;
  return mine.reduce((best, row) => (paymentRank(row) > paymentRank(best) ? row : best));
}

function countsForRental(
  rental: ActiveRentalSource,
  issues: IssueFact[],
  incidents: IncidentFact[],
): { openIssues: number; openIncidents: number } {
  const openIssues = issues.filter((issue) => {
    if (isIssueClosed(issue.status)) return false;
    if (issue.rentalId && issue.rentalId === rental.id) return true;
    if (issue.rentalId) return false;
    return issue.driverId === rental.driverId || issue.vehicleId === rental.vehicleId;
  }).length;
  const seen = new Set<string>();
  let openIncidents = 0;
  for (const incident of incidents) {
    if (!isOpenIncidentStatus(incident.status)) continue;
    const onThisRental = incident.rentalId === rental.id;
    const onThisVehicle = !incident.rentalId && incident.vehicleId === rental.vehicleId;
    if (!onThisRental && !onThisVehicle) continue;
    if (seen.has(incident.id)) continue;
    seen.add(incident.id);
    openIncidents += 1;
  }
  return { openIssues, openIncidents };
}

export function buildActiveRentalRows(args: {
  today: string;
  rentals: ActiveRentalSource[];
  payments: ReadResult<PaymentFact>;
  issues: ReadResult<IssueFact>;
  incidents: ReadResult<IncidentFact>;
  documentDates: ReadResult<{ rentalId: string; dates: Array<string | null | undefined> }>;
}): ActiveRentalRow[] {
  const documentByRental = new Map<string, Array<string | null | undefined>>();
  if (args.documentDates.ok) {
    for (const row of args.documentDates.rows) documentByRental.set(row.rentalId, row.dates);
  }
  return sortActiveRentals(
    args.rentals.map((rental) => {
      const payment = args.payments.ok ? latestPayment(rental.id, args.payments.rows) : null;
      const issueCount = args.issues.ok ? countsForRental(rental, args.issues.rows, []).openIssues : null;
      const incidentCount = args.incidents.ok ? countsForRental(rental, [], args.incidents.rows).openIncidents : null;
      return {
        id: rental.id,
        driverId: rental.driverId,
        driverName: rental.driverName,
        applicationId: rental.applicationId,
        vehicleId: rental.vehicleId,
        vehicleLabel: rental.vehicleLabel,
        startDate: rental.startDate,
        weeksIn: weeksIn(rental.startDate, args.today),
        weeklyRate: rental.weeklyRate,
        nextPaymentDue: dateOnly(rental.nextPaymentDue),
        overdueDays: overdueDays(rental.nextPaymentDue, args.today),
        lastPaymentStatus: !args.payments.ok ? null : payment?.status?.trim() || null,
        lastPaymentViaStripe: !args.payments.ok || !payment
          ? null
          : Boolean(payment.stripeInvoiceId || payment.stripePaymentIntentId),
        paymentsLoaded: args.payments.ok,
        openIssues: issueCount,
        openIncidents: incidentCount,
        documentsExpiring: args.documentDates.ok
          ? documentsExpiring(documentByRental.get(rental.id) ?? [], args.today)
          : null,
      };
    }),
  );
}

/** Overdue first, then open driver issues, then everyone else. */
export function sortActiveRentals<T extends { overdueDays: number | null; openIssues: number | null; startDate: string }>(rows: T[]): T[] {
  const band = (row: T) => {
    if ((row.overdueDays ?? 0) > 0) return 0;
    if ((row.openIssues ?? 0) > 0) return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const group = band(a) - band(b);
    if (group !== 0) return group;
    if (band(a) === 0 && (b.overdueDays ?? 0) !== (a.overdueDays ?? 0)) return (b.overdueDays ?? 0) - (a.overdueDays ?? 0);
    if (band(a) === 1 && (b.openIssues ?? 0) !== (a.openIssues ?? 0)) return (b.openIssues ?? 0) - (a.openIssues ?? 0);
    const aStart = dateOnly(a.startDate) ?? "";
    const bStart = dateOnly(b.startDate) ?? "";
    if (aStart === bStart) return 0;
    return aStart < bStart ? -1 : 1;
  });
}

export function paymentStatusLabel(status: string | null, loaded: boolean): string {
  if (!loaded) return "Unavailable";
  const raw = String(status ?? "").trim();
  if (!raw) return "None";
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function weeksInLabel(weeks: number | null): string {
  if (weeks == null) return "";
  return weeks === 1 ? "1 Week" : `${weeks} Weeks`;
}

export function overdueLabel(days: number | null): string {
  if (days == null) return "No Due Date";
  if (days <= 0) return "Current";
  return days === 1 ? "1 Day" : `${days} Days`;
}

export function formatWeeklyRate(amount: number | null): string {
  if (amount == null || Number.isNaN(Number(amount))) return "Not Set";
  return Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
