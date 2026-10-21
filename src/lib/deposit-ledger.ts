/**
 * Read-only security-deposit classification. Money is copied into the result.
 * Nothing here writes a rental, a payment, or a refund.
 */

export const DEPOSIT_PAGE_CAP =
  "Deposit records passed the page cap. Totals are withheld so a partial read cannot understate deposits held or refunds due.";

export const DEPOSIT_OMITTED = [
  "Stripe is not compared. This branch has no read-only Stripe reader, so no Stripe list is called and a database row is not matched to a Stripe charge.",
  "Collected uses payments.net_collected for a paid or refunded deposit. That column is already the amount after the payment refund, so the payment refund is not subtracted again. A blank net collected uses the payment amount minus the payment refund.",
  "The rental deposit refund amount is subtracted from what remains. When the payment and the rental both record a refund, the row says so. Neither record is changed.",
  "A blank rental deposit refund amount counts as no refund recorded, unless the deposit status is refunded or partly refunded. Then the row is Unknown.",
  "Applications deposit amount and deposit status are not used.",
  "The vehicle listed deposit is not the renter's expected deposit. Expected comes from the rental.",
  "Only a payment whose type is deposit counts as collected.",
] as const;

export type DepositState =
  | "held"
  | "due_back"
  | "unknown"
  | "refunded"
  | "partly_refunded"
  | "applied"
  | "forfeited";

export const DEPOSIT_STATE_LABEL: Record<DepositState, string> = {
  held: "Held",
  due_back: "Due Back",
  unknown: "Unknown",
  refunded: "Refunded",
  partly_refunded: "Partly Refunded",
  applied: "Applied",
  forfeited: "Forfeited",
};

export type LedgerRental = {
  id: string;
  applicationId: string | null;
  vehicleId: string;
  status: string;
  endDate: string | null;
  expectedCents: number | null;
  expectedUnreadable: boolean;
  depositHeld: boolean | null;
  depositHeldUnreadable: boolean;
  depositStatus: string;
  refundCents: number | null;
  refundUnreadable: boolean;
  settledAt: string | null;
};

export type LedgerPayment = {
  id: string;
  rentalId: string | null;
  applicationId: string | null;
  type: string;
  status: string;
  amountCents: number | null;
  netCollectedCents: number | null;
  refundedCents: number | null;
  unreadable: boolean;
};

export type LedgerDeduction = {
  id: string;
  rentalId: string;
  amountCents: number | null;
  unreadable: boolean;
};

export type LedgerPerson = { id: string; name: string };
export type LedgerVehicle = { id: string; label: string };

export type DepositRow = {
  rentalId: string | null;
  applicationId: string | null;
  vehicleId: string | null;
  renter: string;
  vehicle: string;
  rentalStatus: string;
  expectedCents: number | null;
  collectedCents: number | null;
  deductionCents: number | null;
  refundCents: number | null;
  remainingCents: number | null;
  state: DepositState;
  evidence: string[];
};

export type DepositLedgerReport = {
  today: string;
  dueThrough: string;
  rows: DepositRow[];
  heldCents: number | null;
  dueBackCents: number | null;
  warnings: string[];
  omitted: string[];
};

const EXCLUDED = new Set(["void", "waived", "cancelled", "canceled"]);
const ENDED = new Set(["completed", "ended", "closed", "returned", "cancelled", "canceled"]);
const ACTIVE = new Set(["active", "pending", "reserved"]);
const OPEN_STATUS = new Set(["", "none", "held", "pending_disposition"]);
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  reserved: "Reserved",
  completed: "Completed",
  ended: "Ended",
  closed: "Closed",
  returned: "Returned",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

export function rentalStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function etToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(iso: string, days: number): string | null {
  const date = dateOnly(iso);
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function dollarsToCents(value: unknown): { cents: number | null; unreadable: boolean } {
  if (value == null || value === "") return { cents: null, unreadable: false };
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return { cents: null, unreadable: true };
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? { cents, unreadable: false } : { cents: null, unreadable: true };
}

export function buildDepositLedger(input: {
  today: string;
  rentals: LedgerRental[];
  payments: LedgerPayment[];
  deductions: LedgerDeduction[];
  people: LedgerPerson[];
  vehicles: LedgerVehicle[];
}): DepositLedgerReport | null {
  const today = dateOnly(input.today);
  const dueThrough = today ? addCalendarDays(today, 7) : null;
  if (!today || !dueThrough) return null;

  const people = new Map(input.people.map((person) => [person.id, person.name.trim() || "Renter"]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.label.trim() || "Vehicle"]));
  const paymentsByRental = new Map<string, LedgerPayment[]>();
  const orphanPayments: LedgerPayment[] = [];
  const rentalIds = new Set(input.rentals.map((rental) => rental.id));
  for (const payment of input.payments) {
    if (payment.type !== "deposit") continue;
    if (payment.rentalId && rentalIds.has(payment.rentalId)) {
      const list = paymentsByRental.get(payment.rentalId) ?? [];
      list.push(payment);
      paymentsByRental.set(payment.rentalId, list);
    } else {
      orphanPayments.push(payment);
    }
  }
  const deductionsByRental = new Map<string, LedgerDeduction[]>();
  const orphanDeductions: LedgerDeduction[] = [];
  for (const deduction of input.deductions) {
    if (rentalIds.has(deduction.rentalId)) {
      const list = deductionsByRental.get(deduction.rentalId) ?? [];
      list.push(deduction);
      deductionsByRental.set(deduction.rentalId, list);
    } else {
      orphanDeductions.push(deduction);
    }
  }

  const rows: DepositRow[] = [];
  for (const rental of input.rentals) {
    const payments = paymentsByRental.get(rental.id) ?? [];
    const deductions = deductionsByRental.get(rental.id) ?? [];
    if (!hasDepositFact(rental) && payments.length === 0 && deductions.length === 0) continue;
    rows.push(rowForRental(rental, payments, deductions, people, vehicles, today, dueThrough));
  }
  rows.push(...orphanPaymentRows(orphanPayments, people));
  rows.push(...orphanDeductionRows(orphanDeductions));
  rows.sort((a, b) => a.renter.localeCompare(b.renter) || String(a.rentalId).localeCompare(String(b.rentalId)));

  let heldCents = 0;
  let dueBackCents = 0;
  for (const row of rows) {
    if (row.remainingCents == null || row.remainingCents <= 0) continue;
    if (row.state === "held") heldCents += row.remainingCents;
    if (row.state === "due_back") dueBackCents += row.remainingCents;
  }
  return { today, dueThrough, rows, heldCents, dueBackCents, warnings: [], omitted: [...DEPOSIT_OMITTED] };
}

export function cappedDepositLedger(today: string): DepositLedgerReport | null {
  const day = dateOnly(today);
  const dueThrough = day ? addCalendarDays(day, 7) : null;
  if (!day || !dueThrough) return null;
  return {
    today: day,
    dueThrough,
    rows: [],
    heldCents: null,
    dueBackCents: null,
    warnings: [DEPOSIT_PAGE_CAP],
    omitted: [...DEPOSIT_OMITTED],
  };
}

export function depositLedgerToCsv(report: DepositLedgerReport): string {
  const lines: string[][] = [
    ["Deposit Ledger"],
    ["Eastern Time", report.today],
    ["Refunds Due Through", report.dueThrough],
    ["Deposits Held", moneyCell(report.heldCents)],
    ["Refunds Due In The Next 7 Days", moneyCell(report.dueBackCents)],
  ];
  for (const warning of report.warnings) lines.push([warning]);
  lines.push(
    [],
    ["Renter", "Vehicle", "Rental Status", "Expected", "Collected", "Deductions", "Refund Recorded", "Remaining", "State", "Evidence"],
    ...report.rows.map((row) => [
      row.renter,
      row.vehicle,
      row.rentalStatus,
      moneyCell(row.expectedCents),
      moneyCell(row.collectedCents),
      moneyCell(row.deductionCents),
      moneyCell(row.refundCents),
      moneyCell(row.remainingCents),
      DEPOSIT_STATE_LABEL[row.state],
      row.evidence.join("; "),
    ]),
    [],
    ["Not Included"],
    ...report.omitted.map((line) => [line]),
  );
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function hasDepositFact(rental: LedgerRental): boolean {
  const status = rental.depositStatus !== "" && rental.depositStatus !== "none";
  return (
    status ||
    rental.expectedCents != null ||
    rental.expectedUnreadable ||
    rental.depositHeld != null ||
    rental.depositHeldUnreadable ||
    rental.refundCents != null ||
    rental.refundUnreadable ||
    rental.settledAt != null
  );
}

function rowForRental(
  rental: LedgerRental,
  payments: LedgerPayment[],
  deductions: LedgerDeduction[],
  people: Map<string, string>,
  vehicles: Map<string, string>,
  today: string,
  dueThrough: string,
): DepositRow {
  const applicationIds = new Set(payments.map((payment) => payment.applicationId).filter((id): id is string => !!id));
  const applicationId = rental.applicationId ?? (applicationIds.size === 1 ? [...applicationIds][0] : null);
  const collected = sumCollected(payments);
  const deduction = sumDeductions(deductions);
  const evidence = [...collected.evidence];
  if (applicationIds.size > 1) evidence.push("Deposit payments name more than one renter.");
  if (rental.settledAt && OPEN_STATUS.has(rental.depositStatus)) {
    evidence.push("A settled time is recorded and the deposit status is still open.");
  }
  const classified = classify({
    rental,
    collectedCents: collected.cents,
    paymentRefundCents: collected.refundedCents,
    deductionCents: deduction.cents,
    unreadable: rental.expectedUnreadable || rental.depositHeldUnreadable || rental.refundUnreadable || collected.unreadable || deduction.unreadable,
    evidence,
    today,
    dueThrough,
  });
  return {
    rentalId: rental.id,
    applicationId,
    vehicleId: rental.vehicleId,
    renter: (applicationId && people.get(applicationId)) || "Renter",
    vehicle: vehicles.get(rental.vehicleId) || "Vehicle",
    rentalStatus: rentalStatusLabel(rental.status),
    expectedCents: rental.expectedUnreadable ? null : rental.expectedCents,
    collectedCents: collected.unreadable ? null : collected.cents,
    deductionCents: deduction.unreadable ? null : deduction.cents,
    refundCents: rental.refundUnreadable ? null : rental.refundCents,
    remainingCents: classified.remainingCents,
    state: classified.state,
    evidence: classified.evidence,
  };
}

function classify(input: {
  rental: LedgerRental;
  collectedCents: number;
  paymentRefundCents: number;
  deductionCents: number;
  unreadable: boolean;
  evidence: string[];
  today: string;
  dueThrough: string;
}): { state: DepositState; remainingCents: number | null; evidence: string[] } {
  const evidence = [...input.evidence];
  if (input.unreadable) {
    evidence.push("An amount on this deposit could not be read.");
    return { state: "unknown", remainingCents: null, evidence };
  }
  const rental = input.rental;
  if (rental.refundCents != null && rental.refundCents > 0 && input.paymentRefundCents > 0) {
    evidence.push("The payment row and the rental both record a deposit refund. Collected is already net of the payment refund, and the rental refund amount is also subtracted. This is evidence only.");
  }
  if ((rental.depositStatus === "refunded" || rental.depositStatus === "partially_refunded") && rental.refundCents == null) {
    evidence.push("Deposit status is refunded and the refund amount is blank.");
    return { state: "unknown", remainingCents: null, evidence };
  }
  const refundCents = rental.refundCents ?? 0;
  const remaining = input.collectedCents - input.deductionCents - refundCents;
  if (rental.depositStatus === "refunded" || rental.depositStatus === "partially_refunded") {
    return settled(rental.depositStatus === "refunded" ? "refunded" : "partly_refunded", remaining, evidence);
  }
  if (rental.depositStatus === "applied" || rental.depositStatus === "forfeited") {
    return settled(rental.depositStatus, remaining, evidence);
  }
  if (remaining < 0) {
    evidence.push("Deductions and recorded refunds are greater than the amount collected.");
    return { state: "unknown", remainingCents: null, evidence };
  }
  if (rental.depositHeld === true && input.collectedCents === 0) {
    evidence.push("Deposit Held is true and no paid deposit payment is on file.");
    return { state: "unknown", remainingCents: remaining, evidence };
  }
  if (rental.depositHeld === false && input.collectedCents > 0) {
    evidence.push("Deposit Held is false and a paid deposit payment is on file.");
    return { state: "unknown", remainingCents: remaining, evidence };
  }
  if (rental.depositHeld == null) {
    evidence.push("Deposit Held is blank.");
    return { state: "unknown", remainingCents: remaining, evidence };
  }
  if (input.collectedCents === 0) {
    evidence.push(rental.expectedCents != null && rental.expectedCents > 0
      ? "Expected deposit is set and nothing is collected."
      : "Nothing is collected.");
    return { state: "unknown", remainingCents: remaining, evidence };
  }
  if (remaining === 0) {
    evidence.push("Nothing remains after deductions and recorded refunds.");
    return { state: "unknown", remainingCents: 0, evidence };
  }
  if (rental.expectedCents != null && rental.expectedCents !== input.collectedCents) {
    evidence.push("Expected deposit and collected deposit differ.");
  }
  if (rental.depositStatus === "pending_disposition") evidence.push("Deposit status is pending disposition.");
  if (!OPEN_STATUS.has(rental.depositStatus)) evidence.push("Deposit status is not a known disposition.");

  const end = dateOnly(rental.endDate);
  if (rental.endDate && !end) evidence.push("End date could not be read.");
  if (ENDED.has(rental.status)) {
    evidence.push("The rental is already ended, so the remaining deposit counts as due back.");
    return { state: "due_back", remainingCents: remaining, evidence };
  }
  if (end && end <= input.dueThrough) {
    if (end < input.today) evidence.push("End date is already past.");
    return { state: "due_back", remainingCents: remaining, evidence };
  }
  if (ACTIVE.has(rental.status)) return { state: "held", remainingCents: remaining, evidence };
  evidence.push("Rental status is not active and the end date is outside the next 7 days.");
  return { state: "unknown", remainingCents: remaining, evidence };
}

function settled(state: DepositState, remaining: number, evidence: string[]): { state: DepositState; remainingCents: number | null; evidence: string[] } {
  if (remaining < 0) {
    evidence.push("Deductions and recorded refunds are greater than the amount collected.");
    return { state, remainingCents: null, evidence };
  }
  if (remaining > 0) evidence.push("Money remains after the recorded disposition. It is not included in deposits held or refunds due.");
  return { state, remainingCents: remaining, evidence };
}

function sumCollected(payments: LedgerPayment[]): { cents: number; refundedCents: number; unreadable: boolean; evidence: string[] } {
  let cents = 0;
  let refundedCents = 0;
  let unpaid = false;
  let markedRefunded = false;
  for (const payment of payments) {
    if (payment.unreadable) return { cents: 0, refundedCents: 0, unreadable: true, evidence: ["An amount on this deposit could not be read."] };
    if (EXCLUDED.has(payment.status)) continue;
    const back = payment.refundedCents ?? 0;
    if (payment.status === "refunded" || payment.status === "paid") {
      if (payment.status === "refunded") markedRefunded = true;
      const gross = payment.netCollectedCents ?? (payment.amountCents == null ? null : payment.amountCents - back);
      if (gross == null || gross < 0) return { cents: 0, refundedCents: 0, unreadable: true, evidence: ["An amount on this deposit could not be read."] };
      cents += gross;
      refundedCents += back;
      continue;
    }
    unpaid = true;
  }
  const evidence: string[] = [];
  if (unpaid) evidence.push("An unpaid deposit charge is on file and is not counted as collected.");
  if (markedRefunded) evidence.push("A deposit payment is marked refunded. Its net collected amount is what counts.");
  return { cents, refundedCents, unreadable: false, evidence };
}

function sumDeductions(deductions: LedgerDeduction[]): { cents: number; unreadable: boolean } {
  let cents = 0;
  for (const deduction of deductions) {
    if (deduction.unreadable || deduction.amountCents == null) return { cents: 0, unreadable: true };
    cents += deduction.amountCents;
  }
  return { cents, unreadable: false };
}

function orphanPaymentRows(payments: LedgerPayment[], people: Map<string, string>): DepositRow[] {
  const groups = new Map<string, LedgerPayment[]>();
  for (const payment of payments) {
    const key = payment.applicationId ? `driver:${payment.applicationId}` : `payment:${payment.id}`;
    const list = groups.get(key) ?? [];
    list.push(payment);
    groups.set(key, list);
  }
  return [...groups.values()].map((group) => {
    const collected = sumCollected(group);
    const applicationId = group[0]?.applicationId ?? null;
    const namedRental = group.some((payment) => payment.rentalId);
    return {
      rentalId: null,
      applicationId,
      vehicleId: null,
      renter: (applicationId && people.get(applicationId)) || "No Renter",
      vehicle: "—",
      rentalStatus: "No Rental",
      expectedCents: null,
      collectedCents: collected.unreadable ? null : collected.cents,
      deductionCents: 0,
      refundCents: null,
      remainingCents: null,
      state: "unknown",
      evidence: [
        namedRental ? "This deposit payment names a rental that is not on file." : "This deposit payment has no rental.",
        ...collected.evidence,
      ],
    };
  });
}

function orphanDeductionRows(deductions: LedgerDeduction[]): DepositRow[] {
  return deductions.map((deduction) => ({
    rentalId: deduction.rentalId,
    applicationId: null,
    vehicleId: null,
    renter: "No Renter",
    vehicle: "—",
    rentalStatus: "No Rental",
    expectedCents: null,
    collectedCents: null,
    deductionCents: deduction.unreadable ? null : deduction.amountCents,
    refundCents: null,
    remainingCents: null,
    state: "unknown" as const,
    evidence: ["A deposit deduction has no rental."],
  }));
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const iso = match[1];
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return iso;
}

function moneyCell(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
