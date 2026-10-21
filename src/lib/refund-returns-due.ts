import { escapeCsvCell } from "./driver-statement";

/**
 * Closed rentals whose security deposit has not been returned.
 * Days are Eastern Time calendar days from the close date.
 * A blank amount stays unknown. A recorded zero stays zero.
 * Applied and forfeited dispositions are counted aside and are not listed as a return.
 * Stripe, when attached, is evidence only and does not change the amount due.
 */

export const REFUND_RETURNS_INCOMPLETE = "Deposit return records were incomplete";
export const REFUND_RETURNS_CAPPED =
  "Deposit return records passed the page cap. The list is withheld so a partial read cannot understate what is still due.";
export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable";

export const CLOSED_RENTAL_STATUSES = [
  "ended",
  "completed",
  "closed",
  "returned",
  "finished",
  "cancelled",
  "canceled",
] as const;

const CLOSED = new Set<string>(CLOSED_RENTAL_STATUSES);
const KEPT = new Set(["applied", "forfeited"]);
const REFUND_STATUS = new Set(["refunded", "partially_refunded"]);
const OPEN_STATUS = new Set(["", "none", "held", "pending_disposition"]);
const COLLECTED_STATUS = new Set(["paid", "refunded"]);
const EXCLUDED_PAYMENT = new Set(["void", "waived", "cancelled", "canceled"]);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOLLARS = /^\d+(\.\d{1,2})?$/;

const STATUS_LABEL: Record<string, string> = {
  ended: "Ended",
  completed: "Completed",
  closed: "Closed",
  returned: "Returned",
  finished: "Finished",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  applied: "Applied",
  forfeited: "Forfeited",
  refunded: "Refunded",
  partially_refunded: "Partly Refunded",
  held: "Held",
  pending_disposition: "Pending Disposition",
  none: "None",
};

export type ReturnRental = {
  id: string;
  applicationId: string | null;
  vehicleId: string | null;
  vehicleOnFile: boolean;
  status: string;
  endDate: string | null;
  depositHeld: boolean | null;
  depositHeldUnreadable: boolean;
  depositStatus: string;
  refundCents: number | null;
  refundUnreadable: boolean;
};

export type ReturnPayment = {
  id: string;
  rentalId: string | null;
  type: string;
  status: string;
  amountCents: number | null;
  netCollectedCents: number | null;
  refundedCents: number | null;
  unreadable: boolean;
  stripePaymentIntentId: string | null;
};

export type ReturnDeduction = {
  id: string;
  rentalId: string;
  amountCents: number | null;
  unreadable: boolean;
};

export type ReturnName = { id: string; name: string };
export type ReturnVehicle = { id: string; label: string };

export type ReturnStripeCheck = {
  paymentId: string;
  capturedCents: number;
  refundedCents: number;
};

export type RefundReturnRow = {
  rentalId: string;
  renter: string;
  vehicle: string;
  rentalLabel: string;
  rentalHref: string;
  closeDate: string | null;
  daysSinceClose: number | null;
  stillDueCents: number | null;
  depositStatus: string;
  notes: string[];
  paymentIds: string[];
  stripeRefundedCents: number | null;
};

export type RefundReturnsReport = {
  today: string;
  rows: RefundReturnRow[];
  stillDueCents: number | null;
  unknownCount: number;
  keptCount: number;
  keptUnreadable: boolean;
  stripeCheck: "ready" | "unavailable";
  note: string | null;
};

export function etToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function dollarsToCents(value: unknown): { cents: number | null; unreadable: boolean } {
  if (value == null || value === "") return { cents: null, unreadable: false };
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!DOLLARS.test(raw)) return { cents: null, unreadable: true };
  const [whole, frac = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? { cents, unreadable: false } : { cents: null, unreadable: true };
}

export function formatReturnCents(cents: number | null): string {
  if (cents == null) return "Not Recorded";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function returnMoneyText(cents: number | null, unknown: number): string {
  if (cents == null) return unknown > 0 ? `Not Recorded · ${unknown} Not Recorded` : "Not Recorded";
  if (unknown <= 0) return formatReturnCents(cents);
  return `${formatReturnCents(cents)} · ${unknown} Not Recorded`;
}

export function buildRefundReturns(input: {
  today: string;
  rentals: ReturnRental[];
  payments: ReturnPayment[];
  deductions: ReturnDeduction[];
  names: ReturnName[];
  vehicles: ReturnVehicle[];
}): RefundReturnsReport | null {
  const today = dateOnly(input.today);
  if (!today) return null;
  const names = new Map(input.names.map((name) => [name.id, name.name.trim() || "Renter"]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.label.trim() || "Vehicle"]));
  const paymentsByRental = new Map<string, ReturnPayment[]>();
  for (const payment of input.payments) {
    if (payment.type !== "deposit" || !payment.rentalId) continue;
    const list = paymentsByRental.get(payment.rentalId) ?? [];
    list.push(payment);
    paymentsByRental.set(payment.rentalId, list);
  }
  const deductionsByRental = new Map<string, ReturnDeduction[]>();
  for (const deduction of input.deductions) {
    const list = deductionsByRental.get(deduction.rentalId) ?? [];
    list.push(deduction);
    deductionsByRental.set(deduction.rentalId, list);
  }

  const rows: RefundReturnRow[] = [];
  let keptCount = 0;
  let keptUnreadable = false;
  for (const rental of input.rentals) {
    const outcome = classifyRental(
      rental,
      paymentsByRental.get(rental.id) ?? [],
      deductionsByRental.get(rental.id) ?? [],
      today,
    );
    if (outcome.kind === "omit") continue;
    if (outcome.kind === "kept") {
      keptCount += 1;
      if (outcome.unreadable) keptUnreadable = true;
      continue;
    }
    rows.push(toRow(rental, outcome, names, vehicles));
  }
  rows.sort((a, b) => {
    if (a.daysSinceClose == null && b.daysSinceClose == null) return a.rentalId.localeCompare(b.rentalId);
    if (a.daysSinceClose == null) return 1;
    if (b.daysSinceClose == null) return -1;
    return b.daysSinceClose - a.daysSinceClose || a.rentalId.localeCompare(b.rentalId);
  });

  let stillDue = 0;
  let unknownCount = 0;
  let sawKnown = false;
  for (const row of rows) {
    if (row.stillDueCents == null) {
      unknownCount += 1;
      continue;
    }
    stillDue += row.stillDueCents;
    sawKnown = true;
    if (!Number.isSafeInteger(stillDue)) return null;
  }
  const note = keptCount === 0
    ? null
    : keptUnreadable
      ? `${keptCount} closed rentals are marked Applied or Forfeited. An amount on one of them could not be read, so they are not listed as a return.`
      : `${keptCount} closed rentals are marked Applied or Forfeited and are not listed as a return.`;

  return {
    today,
    rows,
    stillDueCents: sawKnown ? stillDue : null,
    unknownCount,
    keptCount,
    keptUnreadable,
    stripeCheck: "ready",
    note,
  };
}

export function applyReturnStripe(
  report: RefundReturnsReport,
  payments: ReturnPayment[],
  checks: ReturnStripeCheck[],
): RefundReturnsReport {
  const byPayment = new Map(checks.map((check) => [check.paymentId, check]));
  const rows = report.rows.map((row) => {
    const notes = [...row.notes];
    let refunded = 0;
    let saw = false;
    for (const payment of payments) {
      if (!row.paymentIds.includes(payment.id) || !payment.stripePaymentIntentId) continue;
      const check = byPayment.get(payment.id);
      if (!check) {
        notes.push("Stripe returned no captured charge for this payment intent.");
        continue;
      }
      saw = true;
      refunded += check.refundedCents;
      const recorded = payment.refundedCents ?? 0;
      if (recorded !== check.refundedCents) {
        notes.push(`Stripe refunded ${formatReturnCents(check.refundedCents)} and the payment refund amount is ${formatReturnCents(recorded)}. This is evidence only.`);
      }
    }
    return { ...row, notes: [...new Set(notes)], stripeRefundedCents: saw ? refunded : row.stripeRefundedCents };
  });
  return { ...report, stripeCheck: "ready", rows };
}

export function markReturnStripeUnavailable(report: RefundReturnsReport): RefundReturnsReport {
  return { ...report, stripeCheck: "unavailable" };
}

export function refundReturnsToCsv(report: RefundReturnsReport): string {
  const lines: string[][] = [
    ["Refunds & Deposit Returns Due"],
    ["Eastern Time", report.today],
    ["Still Due", report.stillDueCents == null ? "" : (report.stillDueCents / 100).toFixed(2)],
    ["Not Recorded", String(report.unknownCount)],
  ];
  if (report.note) lines.push([report.note]);
  if (report.stripeCheck === "unavailable") lines.push([STRIPE_CHECK_UNAVAILABLE]);
  lines.push(
    [],
    ["Renter", "Vehicle", "Rental", "Closed", "Days Since Close", "Still Due", "Deposit Status", "Stripe Refunded", "Notes"],
    ...report.rows.map((row) => [
      row.renter,
      row.vehicle,
      row.rentalLabel,
      row.closeDate ?? "",
      row.daysSinceClose == null ? "" : String(row.daysSinceClose),
      row.stillDueCents == null ? "" : (row.stillDueCents / 100).toFixed(2),
      row.depositStatus,
      row.stripeRefundedCents == null ? "" : (row.stripeRefundedCents / 100).toFixed(2),
      row.notes.join("; "),
    ]),
  );
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

type DueOutcome = {
  kind: "due";
  stillDueCents: number | null;
  closeDate: string | null;
  daysSinceClose: number | null;
  notes: string[];
  paymentIds: string[];
};

function classifyRental(
  rental: ReturnRental,
  payments: ReturnPayment[],
  deductions: ReturnDeduction[],
  today: string,
): { kind: "omit" } | { kind: "kept"; unreadable: boolean } | DueOutcome {
  if (!CLOSED.has(rental.status.trim().toLowerCase())) return { kind: "omit" };
  const collected = sumCollected(payments);
  const deduction = sumDeductions(deductions);
  const status = rental.depositStatus.trim().toLowerCase();
  const signal = hasSignal(rental, payments, deductions, status);
  if (!signal) return { kind: "omit" };
  const unreadable = rental.depositHeldUnreadable || rental.refundUnreadable || collected.unreadable || deduction.unreadable;
  if (KEPT.has(status)) return { kind: "kept", unreadable };
  const closed = closeDays(rental.endDate, today);
  const notes = [...collected.evidence, ...closed.notes];
  if ((status === "refunded" || status === "partially_refunded") && rental.refundCents == null) {
    notes.push("Deposit status is refunded and the refund amount is blank.");
    return due(null, closed, notes, payments);
  }
  if (unreadable) {
    notes.push("An amount on this deposit could not be read.");
    return due(null, closed, notes, payments);
  }
  const bothRefunds = rental.refundCents != null && rental.refundCents > 0 && collected.refundedCents > 0;
  if (bothRefunds) {
    notes.push("The payment row and the rental both record a deposit refund. Collected is already net of the payment refund, so the rental refund amount is not subtracted again. This is evidence only.");
  }
  const refundCents = bothRefunds ? 0 : rental.refundCents ?? 0;
  const remaining = collected.cents - deduction.cents - refundCents;
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    notes.push("Deductions and recorded refunds are greater than the amount collected.");
    return due(null, closed, notes, payments);
  }
  if (rental.depositHeld === true && collected.cents === 0) {
    notes.push("Deposit Held is true and no paid deposit payment is on file.");
    return due(null, closed, notes, payments);
  }
  if (rental.depositHeld === false && collected.cents > 0) {
    notes.push("Deposit Held is false and a paid deposit payment is on file.");
    return due(null, closed, notes, payments);
  }
  if (rental.depositHeld == null && collected.cents > 0) {
    notes.push("Deposit Held is blank.");
    return due(null, closed, notes, payments);
  }
  if (remaining === 0) return { kind: "omit" };
  if (!OPEN_STATUS.has(status) && !REFUND_STATUS.has(status)) notes.push("Deposit status is not a known disposition.");
  if (status === "pending_disposition") notes.push("Deposit status is pending disposition.");
  return due(remaining, closed, notes, payments);
}

function due(
  stillDueCents: number | null,
  closed: { closeDate: string | null; daysSinceClose: number | null; notes: string[] },
  notes: string[],
  payments: ReturnPayment[],
): DueOutcome {
  return {
    kind: "due",
    stillDueCents,
    closeDate: closed.closeDate,
    daysSinceClose: closed.daysSinceClose,
    notes: [...new Set(notes)],
    paymentIds: payments.map((payment) => payment.id),
  };
}

function toRow(
  rental: ReturnRental,
  outcome: DueOutcome,
  names: Map<string, string>,
  vehicles: Map<string, string>,
): RefundReturnRow {
  const status = rental.status.trim().toLowerCase();
  return {
    rentalId: rental.id,
    renter: (rental.applicationId && names.get(rental.applicationId)) || "Renter",
    vehicle: vehicleText(rental, vehicles),
    rentalLabel: rentalLabel(status, outcome.closeDate),
    rentalHref: `/admin?tab=bookings&id=${encodeURIComponent(rental.id)}`,
    closeDate: outcome.closeDate,
    daysSinceClose: outcome.daysSinceClose,
    stillDueCents: outcome.stillDueCents,
    depositStatus: STATUS_LABEL[rental.depositStatus.trim().toLowerCase()] ?? rental.depositStatus,
    notes: outcome.notes,
    paymentIds: outcome.paymentIds,
    stripeRefundedCents: null,
  };
}

function vehicleText(rental: ReturnRental, vehicles: Map<string, string>): string {
  if (!rental.vehicleId) return "No Vehicle";
  if (!rental.vehicleOnFile) return "Unknown Vehicle";
  return vehicles.get(rental.vehicleId) || "Unknown Vehicle";
}

function rentalLabel(status: string, closeDate: string | null): string {
  const label = STATUS_LABEL[status] ?? status;
  return closeDate ? `${label} · ${closeDate}` : label;
}

function hasSignal(rental: ReturnRental, payments: ReturnPayment[], deductions: ReturnDeduction[], status: string): boolean {
  return (
    rental.depositHeld === true ||
    rental.depositHeldUnreadable ||
    (status !== "" && status !== "none") ||
    payments.length > 0 ||
    deductions.length > 0 ||
    rental.refundCents != null ||
    rental.refundUnreadable
  );
}

function sumCollected(payments: ReturnPayment[]): { cents: number; refundedCents: number; unreadable: boolean; evidence: string[] } {
  let cents = 0;
  let refundedCents = 0;
  for (const payment of payments) {
    if (payment.unreadable) return { cents: 0, refundedCents: 0, unreadable: true, evidence: [] };
    if (EXCLUDED_PAYMENT.has(payment.status)) continue;
    if (!COLLECTED_STATUS.has(payment.status)) continue;
    const back = payment.refundedCents ?? 0;
    const gross = payment.netCollectedCents ?? (payment.amountCents == null ? null : payment.amountCents - back);
    if (gross == null || gross < 0 || !Number.isSafeInteger(cents + gross) || !Number.isSafeInteger(refundedCents + back)) {
      return { cents: 0, refundedCents: 0, unreadable: true, evidence: [] };
    }
    cents += gross;
    refundedCents += back;
  }
  return { cents, refundedCents, unreadable: false, evidence: [] };
}

function sumDeductions(deductions: ReturnDeduction[]): { cents: number; unreadable: boolean } {
  let cents = 0;
  for (const deduction of deductions) {
    if (deduction.unreadable || deduction.amountCents == null || !Number.isSafeInteger(cents + deduction.amountCents)) {
      return { cents: 0, unreadable: true };
    }
    cents += deduction.amountCents;
  }
  return { cents, unreadable: false };
}

function closeDays(endDate: string | null, today: string): { closeDate: string | null; daysSinceClose: number | null; notes: string[] } {
  if (endDate == null || endDate.trim() === "") {
    return { closeDate: null, daysSinceClose: null, notes: ["The close date is not recorded."] };
  }
  const closeDate = endDate.includes("T") ? etDay(endDate) : dateOnly(endDate);
  if (!closeDate) return { closeDate: null, daysSinceClose: null, notes: ["The close date could not be read."] };
  if (closeDate > today) return { closeDate, daysSinceClose: null, notes: ["The close date is after today."] };
  return { closeDate, daysSinceClose: daysBetween(closeDate, today), notes: [] };
}

function etDay(iso: string): string | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return etToday(instant);
}

function daysBetween(earlier: string, later: string): number | null {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  const days = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  return Number.isSafeInteger(days) && days >= 0 ? days : null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
