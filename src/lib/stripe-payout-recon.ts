import { invoiceIsLinked, type LocalLink } from "./stripe-unmatched";
import { addCalendarDays, etMidnightUnix, etYmd } from "./weekly-cash-flow";

/**
 * Read-only payout reconciliation for the last 60 Eastern Time days.
 * Gross, fees, refunds, and net come from each payout's balance transactions.
 * An app payment matches when its payment intent or its Stripe invoice id is on the charge.
 * Fleet Link is invoiceIsLinked. This module does not call Stripe or write.
 */

export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable";
export const STRIPE_CHECK_CAPPED = "Stripe check hit the page cap";
export const DIRECTORY_INCOMPLETE = "Driver records were incomplete";
export const PAYOUT_WINDOW_DAYS = 60;

const CHARGE_TYPES = new Set(["charge", "payment"]);
const REFUND_TYPES = new Set(["refund", "payment_refund", "payment_failure_refund", "refund_failure"]);
const FEE_TYPES = new Set(["stripe_fee", "stripe_fx_fee", "tax_fee", "application_fee", "application_fee_refund"]);
const PAID_STATUSES = new Set(["paid", "refunded"]);

export type PayoutWindow = { from: string; through: string; gte: number; lt: number };

export type ReconApplication = { id: string; name: string; deleted: boolean };
export type ReconPayment = {
  id: string;
  driverId: string | null;
  status: string;
  amount: unknown;
  netCollected: unknown;
  paidDate: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
};

export type ReconTxn = {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
};

export type ReconPayoutInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival: number;
  transactions: ReconTxn[];
};

export type MoneyRow = {
  id: string;
  applicationId: string | null;
  driverName: string | null;
  paymentIntentId: string | null;
  amountCents: number | null;
  status: string | null;
  fleetLink: "Linked" | "Not Linked";
};

export type PayoutReconPayout = {
  id: string;
  arrivalEt: string;
  status: string;
  amountCents: number | null;
  grossCents: number | null;
  feesCents: number | null;
  refundsCents: number | null;
  netCents: number | null;
  matched: MoneyRow[];
  unmatchedCharges: MoneyRow[];
};

export type PayoutInvoiceLink = {
  invoiceId: string;
  subscriptionId: string | null;
  customerId: string | null;
  paymentIntentIds: string[];
};

export type PayoutReconReport = {
  from: string | null;
  through: string | null;
  stripeCheck: "ready" | "unavailable" | "capped";
  directory: "ready" | "unavailable" | "skipped";
  payouts: PayoutReconPayout[];
  paidNotInPayout: MoneyRow[];
};

export function payoutReconWindow(now: Date): PayoutWindow | null {
  const through = etYmd(now);
  const from = through ? addCalendarDays(through, 1 - PAYOUT_WINDOW_DAYS) : null;
  const next = through ? addCalendarDays(through, 1) : null;
  const gte = from ? etMidnightUnix(from) : null;
  const lt = next ? etMidnightUnix(next) : null;
  if (!from || !through || gte === null || lt === null || lt <= gte) return null;
  return { from, through, gte, lt };
}

export function arrivalEt(unixSeconds: number): string {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) return "";
  return etYmd(new Date(unixSeconds * 1000)) ?? "";
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function unavailablePayoutRecon(window: PayoutWindow | null, stripeCheck: "unavailable" | "capped" = "unavailable"): PayoutReconReport {
  return {
    from: window?.from ?? null,
    through: window?.through ?? null,
    stripeCheck,
    directory: "skipped",
    payouts: [],
    paidNotInPayout: [],
  };
}

export function buildPayoutRecon(input: {
  window: PayoutWindow;
  payouts: ReconPayoutInput[];
  payments: ReconPayment[];
  applications: ReconApplication[];
  rentals?: readonly LocalLink[];
  applicationLinks?: readonly LocalLink[];
  invoiceLinks?: readonly PayoutInvoiceLink[];
}): PayoutReconReport {
  const apps = new Map(input.applications.filter((app) => app.id && !app.deleted).map((app) => [app.id, app]));
  const rentals = input.rentals ?? [];
  const applicationLinks = input.applicationLinks ?? [];
  const invoiceLinks = input.invoiceLinks ?? [];
  const byIntent = new Map<string, ReconPayment[]>();
  const byInvoice = new Map<string, ReconPayment[]>();
  for (const payment of input.payments) {
    const intent = payment.stripePaymentIntentId?.trim();
    if (intent) {
      const list = byIntent.get(intent) ?? [];
      list.push(payment);
      byIntent.set(intent, list);
    }
    const invoiceId = payment.stripeInvoiceId?.trim();
    if (invoiceId) {
      const list = byInvoice.get(invoiceId) ?? [];
      list.push(payment);
      byInvoice.set(invoiceId, list);
    }
  }
  const seen = new Set<string>();
  const payouts = input.payouts.map((payout) => {
    const money = summarize(payout);
    const matched: MoneyRow[] = [];
    const unmatchedCharges: MoneyRow[] = [];
    for (const txn of payout.transactions) {
      if (!CHARGE_TYPES.has(txn.type)) continue;
      const intent = txn.paymentIntentId;
      const invoiceId = txn.invoiceId?.trim() || null;
      const hits = uniquePayments([
        ...(intent ? byIntent.get(intent) ?? [] : []),
        ...(invoiceId ? byInvoice.get(invoiceId) ?? [] : []),
      ]);
      const link = fleetLinkLabel(txn, rentals, applicationLinks);
      if (hits.length) {
        for (const payment of hits) {
          const paymentIntent = payment.stripePaymentIntentId?.trim();
          if (paymentIntent) seen.add(paymentIntent);
          if (intent) seen.add(intent);
          matched.push({ ...paymentRow(payment, apps), fleetLink: link });
        }
      } else {
        unmatchedCharges.push({
          id: txn.chargeId ?? txn.id,
          applicationId: null,
          driverName: null,
          paymentIntentId: intent,
          amountCents: Number.isSafeInteger(txn.amount) ? txn.amount : null,
          status: null,
          fleetLink: link,
        });
      }
    }
    return {
      id: payout.id,
      arrivalEt: arrivalEt(payout.arrival),
      status: statusLabel(payout.status),
      amountCents: payout.currency === "usd" && Number.isSafeInteger(payout.amount) ? payout.amount : null,
      grossCents: money?.grossCents ?? null,
      feesCents: money?.feesCents ?? null,
      refundsCents: money?.refundsCents ?? null,
      netCents: money?.netCents ?? null,
      matched,
      unmatchedCharges,
    };
  });
  payouts.sort((a, b) => (a.arrivalEt < b.arrivalEt ? 1 : a.arrivalEt > b.arrivalEt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const paidNotInPayout = input.payments.flatMap((payment) => {
    const intent = payment.stripePaymentIntentId?.trim();
    const paid = paidYmd(payment.paidDate);
    if (!intent || !paid || paid < input.window.from || paid > input.window.through) return [];
    if (!PAID_STATUSES.has(payment.status.trim().toLowerCase())) return [];
    if (seen.has(intent)) return [];
    return [{ ...paymentRow(payment, apps), fleetLink: fleetLinkForPayment(payment, invoiceLinks, rentals, applicationLinks) }];
  });
  return {
    from: input.window.from,
    through: input.window.through,
    stripeCheck: "ready",
    directory: "ready",
    payouts,
    paidNotInPayout,
  };
}

export function payoutReconToCsv(report: PayoutReconReport): string {
  const lines: string[][] = [
    ["Stripe Payout Reconciliation"],
    ["Eastern Time"],
    ["From", report.from ?? ""],
    ["Through", report.through ?? ""],
    [],
    ["Payout", "Arrival", "Status", "Amount", "Gross", "Fees", "Refunds", "Net"],
    ...report.payouts.map((payout) => [
      payout.id,
      payout.arrivalEt,
      payout.status,
      formatCents(payout.amountCents),
      formatCents(payout.grossCents),
      formatCents(payout.feesCents),
      formatCents(payout.refundsCents),
      formatCents(payout.netCents),
    ]),
    [],
    ["Matched Payments"],
    ["Payout", "Payment", "Driver", "Payment Intent", "Amount", "Status", "Fleet Link"],
  ];
  for (const payout of report.payouts) {
    for (const row of payout.matched) lines.push([payout.id, row.id, row.driverName ?? "", row.paymentIntentId ?? "", formatCents(row.amountCents), row.status ?? "", row.fleetLink]);
  }
  lines.push([], ["Unmatched Charges"], ["Payout", "Charge", "Payment Intent", "Amount", "Fleet Link"]);
  for (const payout of report.payouts) {
    for (const row of payout.unmatchedCharges) lines.push([payout.id, row.id, row.paymentIntentId ?? "", formatCents(row.amountCents), row.fleetLink]);
  }
  lines.push([], ["Paid In Stripe Not In A Payout"], ["Payment", "Driver", "Payment Intent", "Amount", "Status", "Fleet Link"]);
  for (const row of report.paidNotInPayout) lines.push([row.id, row.driverName ?? "", row.paymentIntentId ?? "", formatCents(row.amountCents), row.status ?? "", row.fleetLink]);
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function summarize(payout: ReconPayoutInput): { grossCents: number; feesCents: number; refundsCents: number; netCents: number } | null {
  if (payout.currency !== "usd" || !Number.isSafeInteger(payout.amount)) return null;
  let grossCents = 0;
  let feesCents = 0;
  let refundsCents = 0;
  let netCents = 0;
  for (const txn of payout.transactions) {
    if (txn.type === "payout") continue;
    if (txn.currency !== "usd" || txn.amount - txn.fee !== txn.net) return null;
    if (!Number.isSafeInteger(txn.amount) || !Number.isSafeInteger(txn.fee) || !Number.isSafeInteger(txn.net)) return null;
    if (CHARGE_TYPES.has(txn.type)) grossCents += txn.amount;
    else if (REFUND_TYPES.has(txn.type)) refundsCents += txn.amount;
    const fee = feesCents + (FEE_TYPES.has(txn.type) ? txn.net : -txn.fee);
    const net = netCents + txn.net;
    if (!Number.isSafeInteger(fee) || !Number.isSafeInteger(net) || !Number.isSafeInteger(grossCents) || !Number.isSafeInteger(refundsCents)) return null;
    feesCents = fee;
    netCents = net;
  }
  return { grossCents, feesCents, refundsCents, netCents };
}

function uniquePayments(rows: ReconPayment[]): ReconPayment[] {
  const seen = new Set<string>();
  const unique: ReconPayment[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

function fleetLinkLabel(txn: ReconTxn, rentals: readonly LocalLink[], applications: readonly LocalLink[]): "Linked" | "Not Linked" {
  return linkLabel({ subscriptionId: txn.subscriptionId, customerId: txn.customerId }, rentals, applications);
}

function fleetLinkForPayment(
  payment: ReconPayment,
  links: readonly PayoutInvoiceLink[],
  rentals: readonly LocalLink[],
  applications: readonly LocalLink[],
): "Linked" | "Not Linked" {
  const invoiceId = payment.stripeInvoiceId?.trim() || "";
  const intent = payment.stripePaymentIntentId?.trim() || "";
  const byInvoice = invoiceId ? links.find((link) => link.invoiceId === invoiceId) : undefined;
  const byIntent = byInvoice || !intent ? undefined : links.find((link) => link.paymentIntentIds.includes(intent));
  const hit = byInvoice ?? byIntent;
  if (!hit) return "Not Linked";
  return linkLabel(hit, rentals, applications);
}

function linkLabel(
  link: { subscriptionId: string | null; customerId: string | null },
  rentals: readonly LocalLink[],
  applications: readonly LocalLink[],
): "Linked" | "Not Linked" {
  return invoiceIsLinked(
    { subscriptionId: link.subscriptionId, customerId: link.customerId },
    rentals,
    applications,
  ) ? "Linked" : "Not Linked";
}

function paymentRow(payment: ReconPayment, apps: Map<string, ReconApplication>): MoneyRow {
  const app = payment.driverId ? apps.get(payment.driverId) : undefined;
  const net = payment.netCollected == null || payment.netCollected === "" ? null : dollarsToCents(payment.netCollected);
  return {
    id: payment.id,
    applicationId: app?.id ?? null,
    driverName: app?.name ?? null,
    paymentIntentId: payment.stripePaymentIntentId,
    amountCents: net ?? dollarsToCents(payment.amount),
    status: statusLabel(payment.status),
    fleetLink: "Not Linked",
  };
}

function paidYmd(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (!match) return null;
  if (trimmed.length === 10) return match[1];
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? match[1] : etYmd(parsed);
}

export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function statusLabel(status: string): string {
  return status.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
