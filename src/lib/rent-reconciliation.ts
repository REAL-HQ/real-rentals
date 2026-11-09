/**
 * Read-only rent reconciliation for one Monday–Sunday week, Eastern Time.
 * Money is copied into the result. Nothing here writes a payment or a refund.
 */
import { addCalendarDays, etMidnightUnix, etYmd, mondayOf } from "./weekly-cash-flow";

export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable";

export const RENT_PAGE_CAP =
  "Rent payment records passed the page cap. Totals are withheld so a partial read cannot understate a category.";

export const RENT_OMITTED = [
  "Only a payment whose type is rent is compared. Deposits and other charge types are left out.",
  "A rent payment is in the week when its paid date or its due date falls on that Monday through Sunday, Eastern Time. A row with neither date is left out.",
  "Stripe is compared through list and retrieve of charges, refunds, payment intents, and invoices. A subscription id is not used to call Stripe.",
  "In Stripe Only is a succeeded charge whose customer is on an application or a rental, and no payment row has its payment intent or invoice id. A charge with no known customer is left out.",
  "Category totals use the payment amount. In Stripe Only uses the amount Stripe captured. A difference is evidence only.",
] as const;

export const RENT_CATEGORIES = ["matched", "missing_or_failed", "stripe_only", "amount_mismatch", "refund_not_in_net"] as const;
export type RentCategory = (typeof RENT_CATEGORIES)[number];

export const RENT_CATEGORY_LABEL: Record<RentCategory, string> = {
  matched: "Matched",
  missing_or_failed: "Missing Or Failed In Stripe",
  stripe_only: "In Stripe Only",
  amount_mismatch: "Amount Mismatch",
  refund_not_in_net: "Refund Not In Net Collected",
};

export type RentWeek = { from: string; through: string; gte: number; lt: number };

export type RentPayment = {
  id: string;
  rentalId: string | null;
  applicationId: string | null;
  vehicleId: string | null;
  type: string;
  status: string;
  amountCents: number | null;
  netCollectedCents: number | null;
  unreadable: boolean;
  paidDate: string | null;
  dueDate: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
};

export type RentApplication = { id: string; name: string; stripeCustomerId: string | null };
export type RentRental = { id: string; applicationId: string | null; vehicleId: string | null; stripeCustomerId: string | null };
export type RentVehicle = { id: string; label: string };

export type ListedCharge = {
  id: string;
  paymentIntentId: string | null;
  invoiceId: string | null;
  customerId: string | null;
  capturedCents: number | null;
  refundedCents: number | null;
  currency: string | null;
  succeeded: boolean;
  failed: boolean;
  status: string;
};

export type StripeRentFact = {
  forId: string;
  paymentIntentId: string | null;
  invoiceId: string | null;
  chargeId: string | null;
  customerId: string | null;
  capturedCents: number | null;
  refundedCents: number | null;
  currency: string | null;
  outcome: "succeeded" | "failed" | "missing";
  status: string | null;
};

export type RentStripeRead = { ok: true; charges: ListedCharge[]; facts: StripeRentFact[] } | { ok: false };

export type RentRow = {
  id: string;
  paymentId: string | null;
  applicationId: string | null;
  vehicleId: string | null;
  renter: string;
  vehicle: string;
  statusLabel: string;
  category: RentCategory | null;
  amountCents: number | null;
  netCollectedCents: number | null;
  stripeCapturedCents: number | null;
  stripeRefundedCents: number | null;
  evidence: string[];
};

export type RentCategoryTotal = { count: number; cents: number | null };
export type RentTotals = Record<RentCategory, RentCategoryTotal>;

export type RentReconciliationReport = {
  from: string;
  through: string;
  rows: RentRow[];
  totals: RentTotals | null;
  stripeCheck: "ready" | "unavailable";
  warnings: string[];
  omitted: string[];
};

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  unpaid: "Unpaid",
  pending: "Pending",
  overdue: "Overdue",
  past_due: "Past Due",
  late: "Late",
  void: "Void",
  waived: "Waived",
  succeeded: "Succeeded",
};

export function statusLabel(status: string): string {
  const key = status.trim().toLowerCase();
  return STATUS_LABEL[key] ?? key.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function weekBounds(ymd: string): RentWeek | null {
  const from = mondayOf(ymd.trim());
  const through = from ? addCalendarDays(from, 6) : null;
  const next = from ? addCalendarDays(from, 7) : null;
  const gte = from ? etMidnightUnix(from) : null;
  const lt = next ? etMidnightUnix(next) : null;
  if (!from || !through || gte === null || lt === null || lt <= gte) return null;
  return { from, through, gte, lt };
}

/** The Monday–Sunday week that ended before the week containing today. */
export function lastFullWeek(now = new Date()): RentWeek | null {
  const today = etYmd(now);
  const monday = today ? mondayOf(today) : null;
  const from = monday ? addCalendarDays(monday, -7) : null;
  return from ? weekBounds(from) : null;
}

export function dollarsToCents(value: unknown): { cents: number | null; unreadable: boolean } {
  if (value == null || value === "") return { cents: null, unreadable: false };
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return { cents: null, unreadable: true };
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? { cents, unreadable: false } : { cents: null, unreadable: true };
}

export function buildRentReconciliation(input: {
  week: RentWeek;
  payments: RentPayment[];
  applications: RentApplication[];
  rentals: RentRental[];
  vehicles: RentVehicle[];
  stripe: RentStripeRead;
}): RentReconciliationReport {
  const applications = new Map(input.applications.map((app) => [app.id, app.name.trim() || "Renter"]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.label.trim() || "Vehicle"]));
  const rentals = new Map(input.rentals.map((rental) => [rental.id, rental]));
  const rentRows = rentPaymentsInWeek(input.payments, input.week);
  const baseRows = rentRows.map((payment) => dbRow(payment, applications, vehicles, rentals));
  if (!input.stripe.ok) {
    return {
      from: input.week.from,
      through: input.week.through,
      rows: baseRows,
      totals: null,
      stripeCheck: "unavailable",
      warnings: [],
      omitted: [...RENT_OMITTED],
    };
  }
  const facts = new Map(input.stripe.facts.map((fact) => [fact.forId, fact]));
  const rows = baseRows.map((row) => {
    const payment = rentRows.find((item) => item.id === row.paymentId);
    if (!payment) return row;
    const fact = payment.stripePaymentIntentId
      ? facts.get(payment.stripePaymentIntentId) ?? null
      : payment.stripeInvoiceId
        ? facts.get(payment.stripeInvoiceId) ?? null
        : null;
    const classified = classifyPayment(payment, fact);
    return { ...row, ...classified };
  });
  rows.push(...stripeOnlyRows(input.payments, input.applications, input.rentals, input.stripe.charges, applications, vehicles, rentals));
  rows.sort((a, b) => a.renter.localeCompare(b.renter) || a.id.localeCompare(b.id));
  return {
    from: input.week.from,
    through: input.week.through,
    rows,
    totals: totalsFor(rows),
    stripeCheck: "ready",
    warnings: [],
    omitted: [...RENT_OMITTED],
  };
}

export function cappedRentReconciliation(week: RentWeek): RentReconciliationReport {
  return {
    from: week.from,
    through: week.through,
    rows: [],
    totals: null,
    stripeCheck: "unavailable",
    warnings: [RENT_PAGE_CAP],
    omitted: [...RENT_OMITTED],
  };
}

export function rentPaymentsInWeek(payments: RentPayment[], week: { from: string; through: string }): RentPayment[] {
  return payments.filter((payment) => payment.type.trim().toLowerCase() === "rent" && inWeek(payment, week.from, week.through));
}

export function rentReconciliationToCsv(report: RentReconciliationReport): string {
  const lines: string[][] = [
    ["Rent Payment Reconciliation"],
    ["Week Starting", report.from],
    ["Week Ending", report.through],
    ["Eastern Time"],
  ];
  if (report.stripeCheck === "unavailable") lines.push([STRIPE_CHECK_UNAVAILABLE]);
  for (const warning of report.warnings) lines.push([warning]);
  if (report.totals) {
    lines.push(["Category", "Count", "Amount"]);
    for (const category of RENT_CATEGORIES) {
      const total = report.totals[category];
      lines.push([RENT_CATEGORY_LABEL[category], String(total.count), moneyCell(total.cents)]);
    }
  }
  lines.push(
    [],
    ["Renter", "Vehicle", "Payment Status", "Category", "Amount", "Net Collected", "Stripe Captured", "Stripe Refunded", "Evidence"],
    ...report.rows.map((row) => [
      row.renter,
      row.vehicle,
      row.statusLabel,
      row.category ? RENT_CATEGORY_LABEL[row.category] : "",
      moneyCell(row.amountCents),
      moneyCell(row.netCollectedCents),
      moneyCell(row.stripeCapturedCents),
      moneyCell(row.stripeRefundedCents),
      row.evidence.join("; "),
    ]),
    [],
    ["Not Included"],
    ...report.omitted.map((line) => [line]),
  );
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function dbRow(
  payment: RentPayment,
  applications: Map<string, string>,
  vehicles: Map<string, string>,
  rentals: Map<string, RentRental>,
): RentRow {
  const rental = payment.rentalId ? rentals.get(payment.rentalId) : undefined;
  const applicationId = payment.applicationId ?? rental?.applicationId ?? null;
  const vehicleId = payment.vehicleId ?? rental?.vehicleId ?? null;
  return {
    id: payment.id,
    paymentId: payment.id,
    applicationId,
    vehicleId,
    renter: (applicationId && applications.get(applicationId)) || "Renter",
    vehicle: (vehicleId && vehicles.get(vehicleId)) || "Vehicle",
    statusLabel: statusLabel(payment.status),
    category: null,
    amountCents: payment.unreadable ? null : payment.amountCents,
    netCollectedCents: payment.unreadable ? null : payment.netCollectedCents,
    stripeCapturedCents: null,
    stripeRefundedCents: null,
    evidence: payment.unreadable ? ["An amount on this rent payment could not be read. This is evidence only."] : [],
  };
}

function classifyPayment(payment: RentPayment, fact: StripeRentFact | null): Pick<RentRow, "category" | "evidence" | "stripeCapturedCents" | "stripeRefundedCents"> {
  if (payment.unreadable) {
    return {
      category: "missing_or_failed",
      evidence: ["An amount on this rent payment could not be read. This is evidence only."],
      stripeCapturedCents: null,
      stripeRefundedCents: null,
    };
  }
  if (!payment.stripePaymentIntentId && !payment.stripeInvoiceId) {
    const sentence = payment.stripeSubscriptionId
      ? "This rent payment has a Stripe subscription id and no payment intent or invoice id, so it was not matched. This is evidence only."
      : "This rent payment has no Stripe payment intent or invoice id. This is evidence only.";
    return { category: "missing_or_failed", evidence: [sentence], stripeCapturedCents: null, stripeRefundedCents: null };
  }
  if (!fact || fact.outcome === "missing") {
    return {
      category: "missing_or_failed",
      evidence: ["Stripe has no captured charge for this payment. This is evidence only."],
      stripeCapturedCents: null,
      stripeRefundedCents: null,
    };
  }
  if (fact.outcome === "failed") {
    const sentence = fact.status === "failed"
      ? "Stripe shows this payment as failed. This is evidence only."
      : "Stripe has not captured this payment. This is evidence only.";
    return {
      category: "missing_or_failed",
      evidence: [sentence],
      stripeCapturedCents: fact.capturedCents,
      stripeRefundedCents: fact.refundedCents,
    };
  }
  const evidence: string[] = [];
  if (fact.currency && fact.currency.toLowerCase() !== "usd") {
    evidence.push("Stripe currency is not USD, so the amount was not compared. This is evidence only.");
    return { category: "amount_mismatch", evidence, stripeCapturedCents: null, stripeRefundedCents: fact.refundedCents };
  }
  if (payment.amountCents == null || fact.capturedCents == null) {
    evidence.push("The payment amount could not be compared with Stripe. This is evidence only.");
    return { category: "missing_or_failed", evidence, stripeCapturedCents: fact.capturedCents, stripeRefundedCents: fact.refundedCents };
  }
  const refunded = fact.refundedCents ?? 0;
  if (payment.amountCents !== fact.capturedCents) {
    evidence.push(`Stripe captured ${dollars(fact.capturedCents)} and the payment amount is ${dollars(payment.amountCents)}. This is evidence only.`);
  }
  if (refunded > 0) {
    const expected = fact.capturedCents - refunded;
    if (payment.netCollectedCents == null) evidence.push(`Stripe refunded ${dollars(refunded)} and net collected is blank. This is evidence only.`);
    else if (payment.netCollectedCents !== expected) evidence.push(`Stripe refunded ${dollars(refunded)} and net collected is ${dollars(payment.netCollectedCents)}. This is evidence only.`);
  }
  const category: RentCategory = evidence.some((line) => line.startsWith("Stripe captured"))
    ? "amount_mismatch"
    : evidence.length > 0
      ? "refund_not_in_net"
      : "matched";
  return { category, evidence, stripeCapturedCents: fact.capturedCents, stripeRefundedCents: refunded };
}

function stripeOnlyRows(
  payments: RentPayment[],
  applicationRows: RentApplication[],
  rentalRows: RentRental[],
  charges: ListedCharge[],
  applications: Map<string, string>,
  vehicles: Map<string, string>,
  rentals: Map<string, RentRental>,
): RentRow[] {
  const paymentIntents = new Set(payments.map((payment) => payment.stripePaymentIntentId).filter((id): id is string => !!id));
  const invoices = new Set(payments.map((payment) => payment.stripeInvoiceId).filter((id): id is string => !!id));
  const customers = knownCustomers(applicationRows, rentalRows);
  const rows: RentRow[] = [];
  for (const charge of charges) {
    if (!charge.succeeded || !charge.customerId) continue;
    const person = customers.get(charge.customerId);
    if (!person) continue;
    if (!charge.paymentIntentId && !charge.invoiceId) continue;
    if ((charge.paymentIntentId && paymentIntents.has(charge.paymentIntentId)) || (charge.invoiceId && invoices.has(charge.invoiceId))) continue;
    const rental = [...rentals.values()].find((item) => item.stripeCustomerId === charge.customerId);
    const applicationId = person.applicationId;
    const vehicleId = rental?.vehicleId ?? null;
    const foreign = charge.currency != null && charge.currency.toLowerCase() !== "usd";
    rows.push({
      id: `stripe:${charge.id}`,
      paymentId: null,
      applicationId,
      vehicleId,
      renter: (applicationId && applications.get(applicationId)) || person.name,
      vehicle: (vehicleId && vehicles.get(vehicleId)) || "Vehicle",
      statusLabel: "Succeeded",
      category: "stripe_only",
      amountCents: foreign ? null : charge.capturedCents,
      netCollectedCents: null,
      stripeCapturedCents: foreign ? null : charge.capturedCents,
      stripeRefundedCents: charge.refundedCents,
      evidence: ["This succeeded Stripe charge is on a known customer and has no payment row. This is evidence only."],
    });
  }
  return rows;
}

function knownCustomers(applications: RentApplication[], rentals: RentRental[]): Map<string, { applicationId: string | null; name: string }> {
  const byApp = new Map(applications.map((app) => [app.id, app]));
  const customers = new Map<string, { applicationId: string | null; name: string }>();
  for (const app of applications) {
    if (!app.stripeCustomerId || customers.has(app.stripeCustomerId)) continue;
    customers.set(app.stripeCustomerId, { applicationId: app.id, name: app.name.trim() || "Renter" });
  }
  for (const rental of rentals) {
    if (!rental.stripeCustomerId || customers.has(rental.stripeCustomerId)) continue;
    const app = rental.applicationId ? byApp.get(rental.applicationId) : undefined;
    customers.set(rental.stripeCustomerId, { applicationId: app?.id ?? rental.applicationId, name: app?.name.trim() || "Renter" });
  }
  return customers;
}

function totalsFor(rows: RentRow[]): RentTotals {
  const totals = Object.fromEntries(RENT_CATEGORIES.map((category) => [category, { count: 0, cents: 0 }])) as RentTotals;
  for (const row of rows) {
    if (!row.category) continue;
    const total = totals[row.category];
    total.count += 1;
    if (total.cents == null) continue;
    if (row.amountCents == null) total.cents = null;
    else total.cents += row.amountCents;
  }
  return totals;
}

function inWeek(payment: RentPayment, from: string, through: string): boolean {
  const paid = dateOnly(payment.paidDate);
  const due = dateOnly(payment.dueDate);
  if (paid && paid >= from && paid <= through) return true;
  if (due && due >= from && due <= through) return true;
  return false;
}

function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
