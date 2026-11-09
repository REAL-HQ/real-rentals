/**
 * Read-only closeout math for one rental.
 *
 * Inspection, vehicle condition, outstanding charges, billing, and deposit
 * follow the Closeout Readiness reader (PR #63). RecordedRentalCloseout is
 * the versioned write screen and is not called from here. A missing or
 * unreadable source is Unknown. It is never reported as zero.
 *
 * The booking drawer imports `showsCloseoutPreview` from the flag module.
 * This file imports the payments reader, so a client must not value-import it.
 */
import { OUTSTANDING_STATUSES, owedOn } from "@/lib/payment-collection.server";
import { isEndedRentalStatus, showsCloseoutPreview } from "@/lib/closeout-preview-flag";

export { showsCloseoutPreview };

export const CLOSEOUT_PREVIEW_NOTE =
  "Staff must settle manually. This preview does not end the rental, change the deposit, or call billing.";

/** Shown when a closed incident's driver amount is held because nothing links it to a payment. */
export const CLOSED_INCIDENT_HOLD = "closed incident, no linked payment, confirm before refund";

/** Shown when a closed incident and a damage payment on the same rental could be the same money. */
export const POSSIBLE_DOUBLE_COUNT = "possible double count";

const TERMINAL_PAYMENTS = ["paid", "refunded", "void", "waived"] as const;
const SETTLED_TOLLS = ["rebilled", "paid", "written_off"] as const;
const TICKET_TYPES = new Set(["ticket", "tickets", "citation", "citations", "red_light", "speeding", "parking", "impound"]);

export type CloseoutState = "Ready" | "Needs Attention" | "Unknown";

export type CloseoutFigure = {
  key: string;
  title: string;
  state: CloseoutState;
  value: string;
  source: string;
  explanation: string;
  completedAt?: string | null;
  criticalFailures?: string[];
};

export type CloseoutPreview =
  | { shown: false }
  | { shown: true; note: string; figures: CloseoutFigure[] };

export type RowLoad<T> = { ok: true; rows: T[]; truncated: boolean } | { ok: false };

export type CloseoutPreviewInput = {
  status: string | null;
  today: string;
  endDate: string | null;
  inspection: RowLoad<{
    id: string;
    status: string | null;
    completed_at: string | null;
    vehicle_id: string | null;
    exterior_notes: string | null;
    interior_notes: string | null;
  }>;
  rentalVehicleId: string | null;
  items: RowLoad<{ label: string | null; result: string | null; is_critical: boolean | null }>;
  vehicle: { ok: true; status: string | null; rentalReadyMissing: string[] } | { ok: false };
  vehicleIncidents: RowLoad<{ id: string; status: string | null; rental_id: string | null }>;
  rentalIncidents: RowLoad<{
    id: string;
    status: string | null;
    actual_cost: unknown;
    estimated_cost: unknown;
    driver_responsible_amount: unknown;
    drivable: boolean | null;
  }>;
  payments: RowLoad<{
    status: string | null;
    amount: unknown;
    balance_due: unknown;
    type: string | null;
    due_date: string | null;
  }>;
  tolls: RowLoad<{
    status: string | null;
    amount: unknown;
    admin_fee: unknown;
    charge_type: string | null;
    payment_id?: string | null;
  }>;
  deductions: RowLoad<{ amount: unknown; incident_id?: string | null }>;
  billing: { autopay: boolean | null; subscriptionLinked: boolean };
  deposit: {
    amount: unknown;
    held: boolean | null;
    status: string | null;
    settledAt: string | null;
    refundAmount: unknown;
  };
};

const unknown = (key: string, title: string, source: string): CloseoutFigure => ({
  key,
  title,
  state: "Unknown",
  value: "Unknown",
  source,
  explanation: "Evidence could not be loaded. No clearance is implied.",
});

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function easternCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function usable<T>(load: RowLoad<T>): T[] | null {
  if (!load.ok || load.truncated) return null;
  return load.rows;
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

function sumCents(values: number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    total += cents(value);
  }
  return total;
}

function isOpenIncident(status: string | null): boolean {
  return status !== "closed";
}

function isSettledToll(status: string | null): boolean {
  return (SETTLED_TOLLS as readonly string[]).includes(String(status ?? ""));
}

function isTerminalPayment(status: string | null): boolean {
  return (TERMINAL_PAYMENTS as readonly string[]).includes(String(status ?? ""));
}

function isOutstanding(status: string | null): boolean {
  return (OUTSTANDING_STATUSES as readonly string[]).includes(String(status ?? ""));
}

function incidentCost(row: { actual_cost: unknown; estimated_cost: unknown }): number | null {
  const actual = finite(row.actual_cost);
  const estimated = finite(row.estimated_cost);
  if (actual != null && actual > 0) return actual;
  if (estimated != null && estimated > 0) return estimated;
  if (actual != null && actual >= 0) return actual;
  if (estimated != null && estimated >= 0) return estimated;
  return null;
}

function classifyCharge(type: string | null): "toll" | "ticket" | "other" {
  const s = String(type ?? "").trim().toLowerCase();
  if (s === "toll") return "toll";
  if (TICKET_TYPES.has(s)) return "ticket";
  return "other";
}

function chargeAmount(row: { amount: unknown; admin_fee: unknown }): number | null {
  const amount = finite(row.amount);
  const fee = finite(row.admin_fee);
  if (amount == null || fee == null || amount < 0 || fee < 0) return null;
  return fromCents(cents(amount) + cents(fee));
}

function calendarDay(value: string | null): string | null {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function inspectionFigure(input: CloseoutPreviewInput): CloseoutFigure {
  const source = "inspections where inspection_type is return, latest row";
  const rows = usable(input.inspection);
  if (!rows) return unknown("inspection", "Return Inspection", source);
  const inspection = rows[0];
  if (!inspection) {
    return {
      key: "inspection",
      title: "Return Inspection",
      state: "Needs Attention",
      value: "Pending",
      source,
      explanation: "Missing — no return inspection recorded for this rental.",
    };
  }
  if (!input.rentalVehicleId || inspection.vehicle_id !== input.rentalVehicleId) {
    return unknown("inspection", "Return Inspection", source);
  }
  const items = usable(input.items);
  if (!items || !items.length) return unknown("inspection", "Return Inspection", source);
  const status = inspection.status ?? "";
  if (!["passed", "failed", "in_progress"].includes(status)) {
    return unknown("inspection", "Return Inspection", source);
  }
  const failures = items
    .filter((item) => item.is_critical === true && item.result === "fail")
    .map((item) => item.label)
    .filter((label): label is string => !!label);
  const scored = items.every((item) => item.result === "pass" || item.result === "fail" || item.result === "na");
  const complete =
    status === "passed" &&
    !!inspection.completed_at &&
    Number.isFinite(Date.parse(inspection.completed_at)) &&
    scored;
  const failed = status === "failed" || failures.length > 0;
  return {
    key: "inspection",
    title: "Return Inspection",
    state: failed || !complete ? "Needs Attention" : "Ready",
    value: failed ? "Failed" : complete ? "Done" : "Pending",
    source,
    completedAt: inspection.completed_at,
    criticalFailures: failures,
    explanation: failed
      ? "Failed — review the return inspection before releasing the vehicle."
      : complete
        ? "Completed — latest return checklist passed."
        : "Incomplete — return checklist has not passed.",
  };
}

function damageFigure(input: CloseoutPreviewInput, inspection: CloseoutFigure): CloseoutFigure {
  const source = "inspection_items on the latest return inspection";
  if (inspection.value === "Pending" && inspection.explanation.startsWith("Missing")) {
    return {
      key: "damage",
      title: "Damage Found",
      state: "Unknown",
      value: "Unknown",
      source,
      explanation: "No return inspection is recorded, so damage is not known.",
    };
  }
  if (inspection.state === "Unknown") return unknown("damage", "Damage Found", source);
  const items = usable(input.items);
  const rows = usable(input.inspection);
  if (!items || !rows?.[0]) return unknown("damage", "Damage Found", source);
  if (items.some((item) => item.result !== "pass" && item.result !== "fail" && item.result !== "na")) {
    return unknown("damage", "Damage Found", source);
  }
  const found = items.filter((item) => item.result === "fail").map((item) => item.label).filter((label): label is string => !!label);
  const notes = [rows[0].exterior_notes, rows[0].interior_notes].some((note) => !!String(note ?? "").trim());
  if (found.length) {
    return {
      key: "damage",
      title: "Damage Found",
      state: "Needs Attention",
      value: found.join(", "),
      source,
      explanation: notes
        ? "Failed checklist items are listed. Exterior or interior notes are also recorded on the inspection."
        : "Failed checklist items are listed. Incident costs are not added to this line.",
    };
  }
  if (notes || rows[0].status === "failed") {
    return {
      key: "damage",
      title: "Damage Found",
      state: "Needs Attention",
      value: "Notes Recorded",
      source,
      explanation: "No failed checklist item is recorded. The inspection still has notes or a failed status. Read it before treating the vehicle as clear.",
    };
  }
  return {
    key: "damage",
    title: "Damage Found",
    state: "Ready",
    value: "None Recorded",
    source,
    explanation: "The latest return checklist has no failed item and no exterior or interior notes.",
  };
}

function vehicleFigure(input: CloseoutPreviewInput): CloseoutFigure {
  const source = "vehicles row and incidents for this vehicle";
  if (!input.vehicle.ok) return unknown("vehicle", "Vehicle Condition", source);
  const incidents = usable(input.vehicleIncidents);
  if (!incidents) return unknown("vehicle", "Vehicle Condition", source);
  const open = incidents.filter((row) => isOpenIncident(row.status));
  const missing = input.vehicle.rentalReadyMissing;
  const status = input.vehicle.status ?? "unknown";
  const attention = open.length > 0 || missing.length > 0 || !["available", "rented"].includes(status);
  return {
    key: "vehicle",
    title: "Vehicle Condition",
    state: attention ? "Needs Attention" : "Unknown",
    value: status,
    source,
    explanation: `${open.length} unresolved incident(s) on this vehicle. ${missing.length ? `Rental Ready missing: ${missing.join(", ")}.` : "Rental Ready profile checks pass."} Vehicle status: ${status}. These records do not certify that all damage or safety issues are cleared.`,
  };
}

function incidentFigures(input: CloseoutPreviewInput): CloseoutFigure[] {
  const source = "incidents where rental_id is this rental";
  const rows = usable(input.rentalIncidents);
  if (!rows) {
    return [
      unknown("incidents", "Open Incidents", source),
      unknown("incident-costs", "Incident Costs", source),
    ];
  }
  const open = rows.filter((row) => isOpenIncident(row.status));
  const notDrivable = open.filter((row) => row.drivable === false).length;
  const costs = open.map((row) => incidentCost(row));
  const costCents = costs.every((cost) => cost != null) ? sumCents(costs as number[]) : null;
  const responsible = open.map((row) => {
    const amount = finite(row.driver_responsible_amount);
    return amount != null && amount >= 0 ? amount : null;
  });
  const responsibleCents = responsible.every((cost) => cost != null) ? sumCents(responsible as number[]) : null;
  const deductions = usable(input.deductions);
  const payments = usable(input.payments);
  const closedRows = rows.filter((row) => !isOpenIncident(row.status));
  const closedUnreadable = closedRows.some((row) => {
    const amount = finite(row.driver_responsible_amount);
    return amount == null || amount < 0;
  });
  const closedHeld = closedRows.some((row) => {
    const amount = finite(row.driver_responsible_amount);
    return amount != null && amount > 0;
  });
  const driver = !closedUnreadable && deductions ? uncoveredDriverCents(rows, deductions) : null;
  const closedCents = closedUnreadable ? null : closedHeld ? (driver ? driver.closedUncovered : null) : 0;
  const totalCents = costCents == null || closedCents == null ? null : costCents + closedCents;
  const double = closedCents != null && closedCents > 0 && !!payments?.some(countsAsDamagePayment);
  const openCost =
    responsibleCents == null
      ? "Recorded cost on open incidents. Driver responsibility could not be totaled. These open costs are not added to deposit deductions."
      : `Recorded cost on open incidents. Driver responsibility recorded: ${money(fromCents(responsibleCents))}. These open costs are not added to deposit deductions.`;
  const closedNote =
    closedCents != null && closedCents > 0 ? `${money(fromCents(closedCents))} ${CLOSED_INCIDENT_HOLD}.` : "";
  const doubleNote = double
    ? `${POSSIBLE_DOUBLE_COUNT}. A damage payment is left out of the refund only when its amount matches one closed incident already held.`
    : "";
  const explanation =
    costCents == null
      ? "An open incident is missing both an actual cost and an estimated cost."
      : closedCents == null
        ? "A closed incident is missing a driver-responsible amount, or the deductions list could not be read."
        : [open.length || closedCents === 0 ? openCost : "", closedNote, doubleNote].filter(Boolean).join(" ");
  return [
    {
      key: "incidents",
      title: "Open Incidents",
      state: open.length ? "Needs Attention" : "Ready",
      value: String(open.length),
      source,
      explanation: `${open.length} incident(s) on this rental are not closed.${notDrivable ? ` ${notDrivable} marked not drivable.` : ""} Closed incidents are not counted.`,
    },
    {
      key: "incident-costs",
      title: "Incident Costs",
      state: totalCents == null ? "Unknown" : totalCents > 0 ? "Needs Attention" : "Ready",
      value: totalCents == null ? "Unknown" : money(fromCents(totalCents)),
      source: `${source}; open incidents use a positive actual_cost, otherwise a positive estimated_cost; a closed incident adds driver_responsible_amount because no payment link column exists`,
      explanation,
    },
  ];
}

type TollRow = {
  status: string | null;
  amount: unknown;
  admin_fee: unknown;
  charge_type: string | null;
  payment_id?: string | null;
};

type IncidentRow = {
  id: string;
  status: string | null;
  driver_responsible_amount: unknown;
};

type DeductionRow = { amount: unknown; incident_id?: string | null };

type PaymentRow = {
  status: string | null;
  amount: unknown;
  balance_due: unknown;
  type: string | null;
  due_date: string | null;
};

function chargePosted(row: { status: string | null; payment_id?: string | null }): boolean {
  return isSettledToll(row.status) || (row.payment_id != null && String(row.payment_id).length > 0);
}

function isDisputedCharge(status: string | null): boolean {
  return String(status ?? "").trim().toLowerCase() === "disputed";
}

function isDepositPayment(row: { type: string | null }): boolean {
  return String(row.type ?? "").trim().toLowerCase() === "deposit";
}

function countsAsDamagePayment(row: { status: string | null; type: string | null }): boolean {
  if (String(row.type ?? "").trim().toLowerCase() !== "damage") return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  return status !== "void" && status !== "waived";
}

/** A payment whose balance cannot be read. Matches Closeout Readiness: both fields null is Unknown, even though owedOn would return 0. */
function paymentUnreadable(row: { status: string | null; amount: unknown; balance_due: unknown }): boolean {
  return !isOutstanding(row.status) || (row.balance_due == null && row.amount == null) || !Number.isFinite(owedOn(row));
}

function tollFigure(
  rows: TollRow[] | null,
  kind: "toll" | "ticket" | "other",
  key: string,
  title: string,
): CloseoutFigure | null {
  const source = "toll_charges for this rental; open means status is not rebilled, paid, written_off, or disputed, and no payment row is posted";
  if (!rows) return unknown(key, title, source);
  const disputed = rows.filter((row) => isDisputedCharge(row.status) && classifyCharge(row.charge_type) === kind);
  const open = rows.filter((row) => !chargePosted(row) && !isDisputedCharge(row.status));
  const mine = open.filter((row) => classifyCharge(row.charge_type) === kind);
  if (kind === "other" && mine.length === 0 && disputed.length === 0) return null;
  const amounts = mine.map(chargeAmount);
  if (amounts.some((amount) => amount == null)) return unknown(key, title, source);
  const total = sumCents(amounts as number[]);
  if (total == null) return unknown(key, title, source);
  const noun = kind === "toll" ? "toll" : kind === "ticket" ? "ticket" : "charge";
  const disputedNote = disputed.length
    ? ` ${disputed.length} disputed ${noun}${disputed.length === 1 ? "" : "s"} ${disputed.length === 1 ? "is" : "are"} informational and ${disputed.length === 1 ? "is" : "are"} not subtracted.`
    : "";
  const onlyDisputed = mine.length === 0 && disputed.length > 0;
  return {
    key,
    title,
    state: mine.length || total > 0 ? "Needs Attention" : "Ready",
    value: onlyDisputed ? `${disputed.length} disputed` : `${mine.length} · ${money(fromCents(total))}`,
    source,
    explanation:
      (kind === "other"
        ? "Open toll_charges rows whose type is neither toll nor ticket. Their amounts are not added to Open Tolls or Open Tickets."
        : `Open ${noun} rows. Amount is the charge plus its admin fee. A rebilled row is left to the payments balance so it is not counted twice.`) +
      disputedNote,
  };
}

function chargesFigure(input: CloseoutPreviewInput): CloseoutFigure {
  const source = "payments for this rental, plus a count of unposted toll_charges";
  const payments = usable(input.payments);
  const tolls = usable(input.tolls);
  if (!payments || !tolls) return unknown("charges", "Outstanding Charges", source);
  const unpaid = payments.filter((row) => !isTerminalPayment(row.status));
  if (unpaid.some((row) => paymentUnreadable(row))) {
    return unknown("charges", "Outstanding Charges", source);
  }
  const balance = sumCents(unpaid.map((row) => owedOn(row)));
  if (balance == null) return unknown("charges", "Outstanding Charges", source);
  const pending = unpaid.filter((row) => row.status === "pending").length;
  const unposted = tolls.filter((row) => !chargePosted(row) && !isDisputedCharge(row.status)).length;
  return {
    key: "charges",
    title: "Outstanding Charges",
    state: balance > 0 || pending > 0 || unposted > 0 ? "Needs Attention" : "Ready",
    value: money(fromCents(balance)),
    source,
    explanation: `${money(fromCents(balance))} unpaid recorded balance; ${pending} pending payment charge(s); ${unposted} unposted toll or other charge(s). Recorded charges only; future charges are not predicted. Rebilled tolls stay on the payment balance and are not added again.`,
  };
}

function returnDay(input: CloseoutPreviewInput): string | null {
  if (String(input.status ?? "").toLowerCase() === "active") return calendarDay(input.today);
  if (isEndedRentalStatus(input.status)) return calendarDay(input.endDate);
  return null;
}

function unpaidRentFigure(input: CloseoutPreviewInput): CloseoutFigure {
  const day = returnDay(input);
  const source = day
    ? `payments where type is rent and due_date is on or before ${day}`
    : "payments where type is rent";
  if (!day) {
    return {
      key: "unpaid-rent",
      title: "Unpaid Rent",
      state: "Unknown",
      value: "Unknown",
      source,
      explanation: "The return day is not recorded, so unpaid rent through the return cannot be limited to a date.",
    };
  }
  const payments = usable(input.payments);
  if (!payments) return unknown("unpaid-rent", "Unpaid Rent", source);
  const rent = payments.filter((row) => String(row.type ?? "").toLowerCase() === "rent");
  const unpaid = rent.filter((row) => !isTerminalPayment(row.status));
  for (const row of unpaid) {
    if (paymentUnreadable(row) || !calendarDay(row.due_date)) return unknown("unpaid-rent", "Unpaid Rent", source);
  }
  const due = unpaid.filter((row) => (row.due_date as string) <= day);
  const total = sumCents(due.map((row) => owedOn(row)));
  if (total == null) return unknown("unpaid-rent", "Unpaid Rent", source);
  return {
    key: "unpaid-rent",
    title: "Unpaid Rent",
    state: total > 0 ? "Needs Attention" : "Ready",
    value: money(fromCents(total)),
    source,
    explanation: `${money(fromCents(total))} of recorded rent charges are unpaid and due on or before ${day}. ${String(input.status ?? "").toLowerCase() === "active" ? "The rental is still active, so that day is today in Eastern Time." : "The day is the recorded end date."} Future rent is not predicted.`,
  };
}

function billingFigure(input: CloseoutPreviewInput): CloseoutFigure {
  const autopay = input.billing.autopay;
  const linked = input.billing.subscriptionLinked;
  return {
    key: "billing",
    title: "Billing",
    state: autopay === true || linked ? "Needs Attention" : "Unknown",
    value: `Autopay ${autopay == null ? "Unknown" : autopay ? "On" : "Off"} · Subscription ${linked ? "Linked" : "Not Linked"}`,
    source: "rentals autopay flag and whether a subscription link is present",
    explanation: `Local autopay: ${autopay == null ? "unknown" : autopay ? "on" : "off"}; subscription link: ${linked ? "present" : "absent"}. Provider cancellation is unverified. No provider request was made.`,
  };
}

/** Outstanding payments due on or before the return day. Rent due later is excluded here and is not subtracted again. A deposit row is the deposit itself and is not subtracted from the refund. A damage payment is left out only after its due date and balance are readable, and only when its original amount matches one unused closed-incident hold. */
function paymentBalanceThroughReturnDay(payments: PaymentRow[], day: string, closedHolds: number[] = []): number | null {
  const holds = [...closedHolds];
  let total = 0;
  for (const row of payments) {
    if (isTerminalPayment(row.status) || isDepositPayment(row)) continue;
    const due = calendarDay(row.due_date);
    if (!due) return null;
    if (due > day) continue;
    if (paymentUnreadable(row)) return null;
    if (countsAsDamagePayment(row)) {
      const original = finite(row.amount);
      if (original != null) {
        const index = holds.indexOf(cents(original));
        if (index !== -1) {
          holds.splice(index, 1);
          continue;
        }
      }
    }
    total += cents(owedOn(row));
  }
  return total;
}

function openChargeCents(rows: TollRow[], kind: "toll" | "ticket"): number | null {
  let total = 0;
  for (const row of rows) {
    if (chargePosted(row) || isDisputedCharge(row.status) || classifyCharge(row.charge_type) !== kind) continue;
    const amount = chargeAmount(row);
    if (amount == null) return null;
    total += cents(amount);
  }
  return total;
}

/**
 * Driver responsibility left after deductions that name the incident.
 * Open incidents count. Closed incidents count too.
 *
 * incidents has no payment_id, and payments has no incident_id, so a live row
 * never links a closed incident to a payment. Do not skip a closed incident
 * because of a payment id. That skip applies only once a real link column
 * exists; until then the driver-responsible amount stays in the deposit hold.
 * The deduction itself is still subtracted in full.
 */
function uncoveredDriverCents(
  incidents: IncidentRow[],
  deductions: DeductionRow[],
): { total: number; closedUncovered: number; closedHolds: number[] } | null {
  const covered = new Map<string, number>();
  for (const row of deductions) {
    if (!row.incident_id) continue;
    const amount = finite(row.amount);
    if (amount == null || amount < 0) return null;
    covered.set(row.incident_id, (covered.get(row.incident_id) ?? 0) + cents(amount));
  }
  let total = 0;
  let closedUncovered = 0;
  const closedHolds: number[] = [];
  for (const row of incidents) {
    const amount = finite(row.driver_responsible_amount);
    if (amount == null || amount < 0) return null;
    const uncovered = Math.max(0, cents(amount) - (covered.get(row.id) ?? 0));
    total += uncovered;
    if (!isOpenIncident(row.status)) {
      closedUncovered += uncovered;
      if (uncovered > 0) closedHolds.push(uncovered);
    }
  }
  return { total, closedUncovered, closedHolds };
}

function settlementFigures(input: CloseoutPreviewInput): CloseoutFigure[] {
  const depositSource = "rentals.deposit_amount, deposit_held, deposit_status, deposit_settled_at, deposit_refund_amount";
  const deductionSource = "deposit_deductions for this rental";
  const amount = finite(input.deposit.amount);
  const held = input.deposit.held;
  const settled = !!input.deposit.settledAt && Number.isFinite(Date.parse(input.deposit.settledAt));
  const disposition = input.deposit.status ?? "unknown";
  const refundRecorded = finite(input.deposit.refundAmount);
  const deposit: CloseoutFigure = {
    key: "deposit",
    title: "Deposit",
    state: held === true && !settled ? "Needs Attention" : "Unknown",
    value: amount == null ? "Unknown" : money(amount),
    source: depositSource,
    explanation: `Recorded deposit: ${amount == null ? "unknown" : money(amount)}; held: ${held == null ? "unknown" : held ? "yes" : "no"}. Disposition: ${disposition}. ${settled ? "A settlement is recorded." : "No settlement is recorded."} ${refundRecorded == null ? "No refund amount is recorded." : `Recorded refund amount: ${money(refundRecorded)}.`} Actual refund confirmation is unavailable; a disposition is not proof of money returned.`,
  };
  const rows = usable(input.deductions);
  let deductionCents: number | null = null;
  let deductions: CloseoutFigure;
  if (!rows) deductions = unknown("deductions", "Deductions", deductionSource);
  else {
    const amounts = rows.map((row) => finite(row.amount));
    if (amounts.some((value) => value == null || (value as number) < 0)) {
      deductions = unknown("deductions", "Deductions", deductionSource);
    } else {
      deductionCents = sumCents(amounts as number[]);
      deductions =
        deductionCents == null
          ? unknown("deductions", "Deductions", deductionSource)
          : {
              key: "deductions",
              title: "Deductions",
              state: deductionCents > 0 ? "Needs Attention" : "Ready",
              value: money(fromCents(deductionCents)),
              source: deductionSource,
              explanation:
                deductionCents === 0
                  ? "No deposit deductions are recorded. Incident costs and open tolls are not copied in as deductions."
                  : "Sum of recorded deposit deductions. Incident costs are not added again.",
            };
    }
  }
  const proposalSource = `${depositSource}; ${deductionSource}; payments due on or before the return day, excluding deposit rows; open tolls and tickets that are not already a payment and are not disputed; incidents.driver_responsible_amount for open incidents and for closed incidents, after a linked deduction. A damage payment is left out only when its original amount matches one closed incident hold`;
  const canPropose = held === true && !settled && amount != null && deductionCents != null;
  const noProposal = (why: string): [CloseoutFigure, CloseoutFigure] => [
    {
      key: "proposed-refund",
      title: "Proposed Refund",
      state: "Unknown",
      value: "No Proposal",
      source: proposalSource,
      explanation: `${why} Staff must settle manually.`,
    },
    {
      key: "balance-due",
      title: "Balance Due",
      state: "Unknown",
      value: "No Proposal",
      source: proposalSource,
      explanation: `${why} Staff must settle manually.`,
    },
  ];
  let proposedRefund: CloseoutFigure;
  let balanceDue: CloseoutFigure;
  if (!canPropose) {
    const why =
      held === false
        ? "No proposal. The deposit is not recorded as held."
        : settled
          ? "No proposal. A settlement is already recorded. That record is not proof of money returned."
          : amount == null || deductionCents == null
            ? "No proposal. A recorded deposit amount and a readable deductions list are both required."
            : "No proposal. Deposit held is unknown.";
    [proposedRefund, balanceDue] = noProposal(why);
  } else {
    const day = returnDay(input);
    const payments = usable(input.payments);
    const tolls = usable(input.tolls);
    const incidents = usable(input.rentalIncidents);
    const driver = incidents && rows ? uncoveredDriverCents(incidents, rows) : null;
    const driverCents = driver ? driver.total : null;
    const double = !!(driver && driver.closedUncovered > 0 && payments?.some(countsAsDamagePayment));
    const paymentCents = day && payments ? paymentBalanceThroughReturnDay(payments, day, double && driver ? driver.closedHolds : []) : null;
    const tollCents = tolls ? openChargeCents(tolls, "toll") : null;
    const ticketCents = tolls ? openChargeCents(tolls, "ticket") : null;
    const why = !day
      ? "No proposal. The return day is not recorded, so the payment balance through the return cannot be limited to a date."
      : !payments
        ? "No proposal. Outstanding payments could not be read."
        : !tolls
          ? "No proposal. Tolls and tickets could not be read."
          : !incidents
            ? "No proposal. Incidents could not be read."
            : paymentCents == null
              ? "No proposal. A payment that may be owed by the return day has no readable balance or due date."
              : tollCents == null || ticketCents == null
                ? "No proposal. An open toll or ticket has no readable amount."
                : driverCents == null
                  ? "No proposal. An incident is missing a driver-responsible amount."
                  : null;
    if (why || paymentCents == null || tollCents == null || ticketCents == null || driverCents == null) {
      [proposedRefund, balanceDue] = noProposal(why ?? "No proposal. A recorded amount required for settlement could not be read.");
    } else {
      const net = cents(amount as number) - (deductionCents as number) - paymentCents - tollCents - ticketCents - driverCents;
      const refund = Math.max(0, net);
      const due = Math.max(0, -net);
      const closedHold =
        driver && driver.closedUncovered > 0
          ? ` ${money(fromCents(driver.closedUncovered))} ${CLOSED_INCIDENT_HOLD}.`
          : "";
      const doubleNote = double
        ? ` ${POSSIBLE_DOUBLE_COUNT}. A damage payment is left out of the refund only when its amount matches one closed incident already held.`
        : "";
      const settledAgainst =
        "Recorded deposit minus recorded deductions, the outstanding payment balance due on or before the return day (deposit rows excluded), open tolls and tickets that are not already a payment and are not disputed, and driver responsibility on open incidents and on closed incidents." +
        closedHold +
        doubleNote +
        " Unpaid rent is included only inside that payment balance. Staff must settle manually.";
      proposedRefund = {
        key: "proposed-refund",
        title: "Proposed Refund",
        state: double || refund > 0 ? "Needs Attention" : "Ready",
        value: money(fromCents(refund)),
        source: proposalSource,
        explanation: `${settledAgainst} This is not a refund.`,
      };
      balanceDue = {
        key: "balance-due",
        title: "Balance Due",
        state: double || due > 0 ? "Needs Attention" : "Ready",
        value: money(fromCents(due)),
        source: proposalSource,
        explanation: `${settledAgainst} This is not a charge.`,
      };
    }
  }
  return [deposit, deductions, proposedRefund, balanceDue];
}

export function buildCloseoutPreview(input: CloseoutPreviewInput): CloseoutPreview {
  if (!showsCloseoutPreview(input.status)) return { shown: false };
  const inspection = inspectionFigure(input);
  const tolls = usable(input.tolls);
  const other = tolls ? tollFigure(tolls, "other", "other-charges", "Other Open Charges") : null;
  const figures = [
    inspection,
    damageFigure(input, inspection),
    vehicleFigure(input),
    ...incidentFigures(input),
    tollFigure(tolls, "toll", "tolls", "Open Tolls") as CloseoutFigure,
    tollFigure(tolls, "ticket", "tickets", "Open Tickets") as CloseoutFigure,
    ...(other ? [other] : []),
    chargesFigure(input),
    unpaidRentFigure(input),
    billingFigure(input),
    ...settlementFigures(input),
  ];
  return { shown: true, note: CLOSEOUT_PREVIEW_NOTE, figures };
}
