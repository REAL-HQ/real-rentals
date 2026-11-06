import { escapeCsvCell } from "./driver-statement";

/**
 * Read-only list of the gaps that leave finance totals Partial or Unavailable.
 * Amounts stay null when blank. Nothing here writes or calls Stripe.
 *
 * A payment method is mapped when it matches the methods Unified Finance
 * already accepts (cash, Zelle, Venmo, Cash App, check, card, and the other
 * names in that list). Card, credit, and debit are the Stripe-looking methods.
 */

export const FINANCE_RECORDS_INCOMPLETE = "Finance records were incomplete";

export const QUALITY_CATEGORIES = [
  { id: "method", label: "Payment Method" },
  { id: "paid_date", label: "Paid Date" },
  { id: "refund_fields", label: "Refund Fields" },
  { id: "stripe_intent", label: "Stripe Payment Id" },
  { id: "duplicate_intent", label: "Duplicate Stripe Payment" },
  { id: "active_rental", label: "Active Rental" },
  { id: "held_deposit", label: "Held Deposit" },
  { id: "orphan_refund", label: "Refund Without Payment" },
] as const;

export type QualityCategoryId = (typeof QUALITY_CATEGORIES)[number]["id"];

export type QualityPayment = {
  id: string;
  status: string;
  method: string | null;
  paidDate: string | null;
  refundedAmount: number | null;
  refundedAt: string | null;
  stripePaymentIntentId: string | null;
  driverId: string | null;
  rentalId: string | null;
};

export type QualityRental = {
  id: string;
  status: string;
  weeklyRate: number | null;
  vehicleId: string | null;
  vehicleFound: boolean;
  driverFound: boolean;
  depositHeld: boolean;
  depositAmount: number | null;
  label: string;
};

export type QualityRefund = {
  id: string;
  paymentIds: string[];
};

export type QualityIssue = {
  id: string;
  category: QualityCategoryId;
  problem: string;
  recordLabel: string;
  recordHref: string;
  suggestedFix: string;
};

export type QualityReport = {
  issues: QualityIssue[];
  counts: Array<{ id: QualityCategoryId; label: string; count: number }>;
};

const MAPPED_METHODS = new Set([
  "stripe", "card", "ach",
  "cash", "cash_app", "cashapp", "venmo", "zelle",
  "bank_transfer", "bank", "check", "money_order", "other",
]);

const STRIPE_LOOKING = new Set(["card", "credit", "debit"]);

const METHOD_FIX = "Choose a known method such as cash, Zelle, Venmo, Cash App, check, or card.";

export function normalizePaymentMethod(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function buildFinanceDataQuality(input: {
  payments: QualityPayment[];
  rentals: QualityRental[];
  refunds: QualityRefund[];
}): QualityReport {
  const issues: QualityIssue[] = [];
  const paymentIds = new Set(input.payments.map((payment) => payment.id));
  const intentCounts = new Map<string, number>();
  for (const payment of input.payments) {
    const intent = text(payment.stripePaymentIntentId);
    if (!intent) continue;
    intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
  }

  for (const payment of input.payments) {
    const link = paymentLink(payment);
    const method = normalizePaymentMethod(payment.method);
    const status = payment.status.trim().toLowerCase();
    if (!method) {
      issues.push(issue("method", payment.id, "blank", "This payment has no method.", link, METHOD_FIX));
    } else if (!MAPPED_METHODS.has(method)) {
      issues.push(issue("method", payment.id, "unmapped", `This payment method "${payment.method?.trim()}" is not a known method.`, link, METHOD_FIX));
    }
    if (status === "paid" && !text(payment.paidDate)) {
      issues.push(issue("paid_date", payment.id, "missing", "This paid payment has no paid date.", link, "Enter the date this payment was collected."));
    }
    if (status === "refunded") {
      const missingDate = !text(payment.refundedAt);
      const missingAmount = payment.refundedAmount === null;
      if (missingDate || missingAmount) {
        const problem = missingDate && missingAmount
          ? "This refunded payment has no refund date and no refund amount."
          : missingDate
            ? "This refunded payment has no refund date."
            : "This refunded payment has no refund amount.";
        const fix = missingDate && missingAmount
          ? "Enter the date the refund was sent and the amount that was refunded."
          : missingDate
            ? "Enter the date the refund was sent."
            : "Enter the amount that was refunded.";
        issues.push(issue("refund_fields", payment.id, "missing", problem, link, fix));
      }
    }
    if (method && STRIPE_LOOKING.has(method) && !text(payment.stripePaymentIntentId)) {
      issues.push(issue(
        "stripe_intent",
        payment.id,
        "missing",
        "This card, credit, or debit payment has no Stripe payment id.",
        link,
        "Add the Stripe payment id, or change the method if this was not collected by card.",
      ));
    }
    const intent = text(payment.stripePaymentIntentId);
    if (intent && (intentCounts.get(intent) ?? 0) > 1) {
      issues.push(issue(
        "duplicate_intent",
        payment.id,
        intent,
        `Stripe payment ${intent} is on more than one payment.`,
        link,
        "Keep this Stripe payment id on the payment that matches the charge, and clear it on the copy.",
      ));
    }
  }

  for (const rental of input.rentals) {
    if (rental.status.trim().toLowerCase() !== "active") continue;
    const link = { label: rental.label || `Rental ${rental.id}`, href: `/admin?tab=bookings&id=${encodeURIComponent(rental.id)}` };
    if (rental.weeklyRate === null || rental.weeklyRate <= 0) {
      issues.push(issue("active_rental", rental.id, "rate", "This active rental has no weekly rate.", link, "Enter a weekly rate greater than zero."));
    }
    if (!text(rental.vehicleId) || !rental.vehicleFound) {
      issues.push(issue("active_rental", rental.id, "vehicle", "This active rental has no vehicle.", link, "Choose the vehicle on this rental."));
    }
    if (!rental.driverFound) {
      issues.push(issue("active_rental", rental.id, "driver", "This active rental has no driver.", link, "Choose the driver on this rental."));
    }
  }

  for (const rental of input.rentals) {
    if (!rental.depositHeld || rental.depositAmount !== null) continue;
    const link = { label: rental.label || `Rental ${rental.id}`, href: `/admin?tab=bookings&id=${encodeURIComponent(rental.id)}` };
    issues.push(issue(
      "held_deposit",
      rental.id,
      "amount",
      "This deposit is marked held and the amount is blank.",
      link,
      "Enter the amount held, or clear Held if no deposit was collected.",
    ));
  }

  for (const refund of input.refunds) {
    const missing = refund.paymentIds.filter((id) => !paymentIds.has(id));
    if (refund.paymentIds.length > 0 && missing.length === 0) continue;
    const known = refund.paymentIds.find((id) => paymentIds.has(id));
    const payment = known ? input.payments.find((row) => row.id === known) : undefined;
    const link = payment ? paymentLink(payment) : { label: `Refund ${refund.id}`, href: "/admin?tab=payments" };
    const record = { label: `Refund ${refund.id}`, href: link.href };
    const problem = refund.paymentIds.length === 0
      ? "This refund does not point at a payment."
      : `This refund points at ${missing.join(", ")}, which is not in Payments.`;
    issues.push(issue("orphan_refund", refund.id, "missing", problem, record, "Point this refund at the payment it returned."));
  }

  const order = new Map(QUALITY_CATEGORIES.map((category, index) => [category.id, index]));
  issues.sort((a, b) => (order.get(a.category)! - order.get(b.category)!) || a.id.localeCompare(b.id));
  const counts = QUALITY_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    count: issues.filter((row) => row.category === category.id).length,
  }));
  return { issues, counts };
}

export function financeDataQualityToCsv(report: QualityReport): string {
  const summary = [["Category", "Count"], ...report.counts.map((row) => [row.label, String(row.count)])];
  const detail = [["Category", "Problem", "Record", "Link", "Suggested Fix"]];
  for (const row of report.issues) {
    const category = QUALITY_CATEGORIES.find((item) => item.id === row.category)?.label ?? row.category;
    detail.push([category, row.problem, row.recordLabel, row.recordHref, row.suggestedFix]);
  }
  const lines = [...summary, [], ...detail].map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function issue(
  category: QualityCategoryId,
  recordId: string,
  kind: string,
  problem: string,
  link: { label: string; href: string },
  suggestedFix: string,
): QualityIssue {
  return { id: `${category}:${recordId}:${kind}`, category, problem, recordLabel: link.label, recordHref: link.href, suggestedFix };
}

function paymentLink(payment: QualityPayment): { label: string; href: string } {
  const label = `Payment ${payment.id}`;
  const driverId = text(payment.driverId);
  if (driverId) return { label, href: `/admin?tab=drivers&id=${encodeURIComponent(driverId)}` };
  const rentalId = text(payment.rentalId);
  if (rentalId) return { label, href: `/admin?tab=bookings&id=${encodeURIComponent(rentalId)}` };
  return { label, href: "/admin?tab=payments" };
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
