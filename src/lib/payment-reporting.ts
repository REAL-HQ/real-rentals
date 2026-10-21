/**
 * Payments source filters, dedupe, and summary math.
 *
 * Dollars, not cents, except where a Stripe total is converted at the
 * boundary. A metric is null when the columns or the Stripe report cannot
 * support it. Null is Unavailable. It is never rendered as zero.
 *
 * Dedupe rule: a recorded payment and a verified Stripe charge are the same
 * transaction when they share one authoritative id. Amounts are never compared.
 *   1. payments.stripe_payment_intent_id and the charge's PaymentIntent id
 *   2. payments.stripe_invoice_id and the charge's invoice id
 *   3. either of those stored ids and the Stripe charge id
 *   4. a payment_refunds row whose payment_ids contain the payment and whose
 *      stripe_charge_id or stripe_payment_intent_id matches the charge
 *   5. the charge metadata paymentIds list, which is the only id a multi-row
 *      collection writes (the webhook stores stripe_payment_intent_id only
 *      when the charge covers one row)
 *   6. a pi_, ch_, cs_, or in_ token in payments.notes equal to the charge,
 *      its PaymentIntent, its invoice, or its checkout session id
 *   7. a blank-method row whose rental_id equals charge metadata rentalId and
 *      whose paid date is the charge's Eastern capture day, and only when
 *      that charge did not name a paymentIds list
 * The verified Stripe gross, refunds, fees, and net are kept. The recorded
 * row is omitted from the combined total. A collected row with no method and
 * no such link, and a manual card with no Stripe id, are not added. The
 * total stays Partial and those rows are listed. Recorded rows are not merged
 * with each other, and Stripe charges are not merged with each other.
 *
 * payments has no stripe_charge_id column. Charge identity reaches a payment
 * through payment_refunds, charge metadata, notes, or when one of the two
 * stored ids is the charge id itself.
 *
 * Refundable deposits are not revenue. A recorded payment whose type is
 * deposit, and a Stripe charge identified as a deposit, are left out of
 * gross, refunds, and net. Held deposits stay in Deposits held. A Stripe
 * charge is a deposit when its metadata reason is deposit, or when every
 * paymentIds entry is present and every one of those rows is a deposit. A
 * missing id is not guessed. A charge that mixes a deposit with rent is
 * not split and stays in revenue.
 */

import { rangeMessage, reportingDay } from "@/lib/eastern-day";
export { readEveryPage } from "@/lib/paged-read";

export const SOURCE_FILTERS = ["all", "stripe", "venmo", "cash_app", "zelle", "wire", "cash", "other"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];
export type PaymentSource = Exclude<SourceFilter, "all">;

export const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: "All",
  stripe: "Stripe",
  venmo: "Venmo",
  cash_app: "Cash App",
  zelle: "Zelle",
  wire: "Wire",
  cash: "Cash",
  other: "Other",
};

/**
 * Methods that exist on payments.payment_method and have no filter of their
 * own. A named method wins over a Stripe id. The id is still used for dedupe.
 */
export const SOURCE_MAPPING_GAPS = [
  "Bank Transfer, ACH, Check, Money Order, and PayPal have no filter of their own. They appear under Other. A Bank Transfer row that also has an invoice id stays under Other, and All still matches that invoice against Stripe.",
  "Cash App Pay maps to Cash App.",
  "Apple Pay maps to Stripe when the row has a payment intent, invoice, or subscription id. Without one it is Card (manual).",
  "Card, credit card, and debit map to Stripe only when a Stripe id is present. The same words with no Stripe id are Card (manual), listed under Other, and left out of the combined total.",
  "Card (in person) is always Card (manual), including when a Stripe id is also present. That id still dedupes the row on All.",
  "A blank method with no Stripe payment intent, invoice, or subscription id is Other, not Cash. If it also has no charge metadata, refund link, or note id, it is listed and left out of the combined total.",
  "payments has no stripe_charge_id. A charge id matches through payment_refunds.stripe_charge_id, charge metadata paymentIds, a token in notes, or when stripe_payment_intent_id or stripe_invoice_id equals that charge id.",
] as const;

export const DEDUPE_RULE =
  "A recorded payment and a verified Stripe charge count once when they share a PaymentIntent id, an invoice id, a charge id, a metadata paymentIds entry, or a Stripe id written in the payment note. A blank-method row can also match its rental and Eastern paid date when the charge names that rental and does not name payment ids. Amounts are never compared. The Stripe amounts are kept and the recorded row is left out of the combined total. A row with no authoritative link is listed and not added.";

const MANUAL: Record<string, PaymentSource> = {
  venmo: "venmo",
  cash_app: "cash_app",
  cashapp: "cash_app",
  cash_app_pay: "cash_app",
  zelle: "zelle",
  wire: "wire",
  wire_transfer: "wire",
  domestic_wire: "wire",
  cash: "cash",
  paypal: "other",
  bank_transfer: "other",
  banktransfer: "other",
  ach: "other",
  check: "other",
  cheque: "other",
  money_order: "other",
  moneyorder: "other",
};

/** In-person and unlabeled card words. These never classify as Stripe by name alone. */
const MANUAL_CARD_METHODS = new Set(["card_in_person", "card_manual", "in_person"]);

const STRIPE_METHODS = new Set([
  "stripe",
  "card",
  "credit_card",
  "debit",
  "debit_card",
  "credit",
  "visa",
  "mastercard",
  "amex",
  "american_express",
  "apple_pay",
]);

export const OUTSTANDING_STATUSES = [
  "pending",
  "current",
  "late",
  "overdue",
  "past_due",
  "failed",
  "unpaid",
  "collections",
] as const;

const COLLECTED = new Set(["paid", "refunded"]);
const DEPOSIT_CLOSED = new Set(["refunded", "partially_refunded", "applied", "forfeited"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePaymentMethod(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function hasStripeId(row: {
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_subscription_id?: string | null;
}): boolean {
  return [row.stripe_payment_intent_id, row.stripe_invoice_id, row.stripe_subscription_id].some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}

/**
 * A card taken outside Stripe. Card (in person) stays here even with a Stripe
 * id. Card, debit, and Apple Pay land here only when no Stripe id is stored.
 */
export function isManualCard(row: {
  payment_method?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_subscription_id?: string | null;
}): boolean {
  const method = normalizePaymentMethod(row.payment_method);
  if (MANUAL_CARD_METHODS.has(method)) return true;
  if (method === "apple_pay" || (STRIPE_METHODS.has(method) && method !== "stripe")) return !hasStripeId(row);
  return false;
}

export function classifyPaymentSource(row: {
  payment_method?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_subscription_id?: string | null;
}): PaymentSource {
  const method = normalizePaymentMethod(row.payment_method);
  if (MANUAL_CARD_METHODS.has(method)) return "other";
  const named = MANUAL[method];
  if (named) return named;
  if (method === "apple_pay" || (STRIPE_METHODS.has(method) && method !== "stripe")) {
    return hasStripeId(row) ? "stripe" : "other";
  }
  if (hasStripeId(row) || method === "stripe") return "stripe";
  return "other";
}

export type ChargeRef = {
  id: string;
  paymentIntentId?: string | null;
  invoiceId?: string | null;
  /** Payment row ids from charge metadata. Empty means the charge did not name them. */
  paymentIds?: readonly string[] | null;
  rentalId?: string | null;
  sessionId?: string | null;
  /** Unix seconds of capture, used for the rental-and-Eastern-day link and deposit exclusion. */
  created?: number | null;
  /** Short metadata reason token. "deposit" marks a refundable deposit charge. */
  reason?: string | null;
  /** Cents, on a verified Stripe charge. */
  amount?: number | null;
  paid?: boolean | null;
  captured?: boolean | null;
  status?: string | null;
  currency?: string | null;
  /** Cents. Null when the balance transaction did not supply a fee. */
  fee?: number | null;
};

export type StripeRefundRef = {
  id?: string;
  chargeId: string;
  created: number;
  currency: string;
  amount: number;
  status: string | null;
  fee: number | null;
};
export type PaymentRef = {
  id: string;
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  rental_id?: string | null;
  paid_date?: string | null;
  payment_method?: string | null;
  notes?: string | null;
};

const STRIPE_TOKEN = /\b(?:pi|ch|cs|in)_[A-Za-z0-9]+\b/g;

/** paymentIds, rentalId, and a short reason token as the collection webhook writes them. Non-uuids are dropped. */
export function chargeLinksFromMetadata(metadata: { paymentIds?: string | null; rentalId?: string | null; sessionId?: string | null; checkout_session_id?: string | null; reason?: string | null } | null | undefined): {
  paymentIds: string[];
  rentalId: string | null;
  sessionId: string | null;
  reason: string | null;
} {
  const paymentIds = String(metadata?.paymentIds ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => UUID.test(part));
  const rental = metadata?.rentalId?.trim() ?? "";
  const session = metadata?.sessionId?.trim() || metadata?.checkout_session_id?.trim() || "";
  const reason = normalizePaymentMethod(metadata?.reason);
  return {
    paymentIds,
    rentalId: UUID.test(rental) ? rental : null,
    sessionId: /^cs_[A-Za-z0-9]+$/.test(session) ? session : null,
    reason: /^[a-z0-9_]{1,40}$/.test(reason) ? reason : null,
  };
}
export type RefundLink = {
  stripe_charge_id?: string | null;
  stripe_payment_intent_id?: string | null;
  payment_ids?: readonly string[] | null;
};

const idOf = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

function stripeTokens(notes: string | null | undefined): string[] {
  return notes?.match(STRIPE_TOKEN) ?? [];
}

function sameId(left: string | null, right: string | null | undefined): boolean {
  const other = idOf(right);
  return !!left && !!other && left === other;
}

export function paymentMatchesCharge(payment: PaymentRef, charge: ChargeRef, links: readonly RefundLink[]): boolean {
  const intent = idOf(charge.paymentIntentId);
  const invoice = idOf(charge.invoiceId);
  const chargeId = idOf(charge.id);
  const session = idOf(charge.sessionId);
  const paymentIntent = idOf(payment.stripe_payment_intent_id);
  const paymentInvoice = idOf(payment.stripe_invoice_id);
  if (paymentIntent && intent && paymentIntent === intent) return true;
  if (paymentInvoice && invoice && paymentInvoice === invoice) return true;
  if (chargeId && (paymentIntent === chargeId || paymentInvoice === chargeId)) return true;
  for (const link of links) {
    if (!(link.payment_ids ?? []).includes(payment.id)) continue;
    if (chargeId && idOf(link.stripe_charge_id) === chargeId) return true;
    if (intent && idOf(link.stripe_payment_intent_id) === intent) return true;
  }
  const named = (charge.paymentIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (named.includes(payment.id)) return true;
  const tokens = stripeTokens(payment.notes);
  if (tokens.some((token) => token === chargeId || token === intent || token === invoice || token === session)) return true;
  // Rental + Eastern paid day is only a link when the charge did not name its
  // rows. A named list is the whole set; a same-day cash payment stays separate.
  // A named method is never pulled in by the rental day. Amounts are not read.
  if (named.length === 0 && !normalizePaymentMethod(payment.payment_method)) {
    const rental = idOf(charge.rentalId);
    const paid = reportingDay(payment.paid_date);
    const captured = typeof charge.created === "number" && Number.isFinite(charge.created)
      ? reportingDay(new Date(charge.created * 1000).toISOString())
      : null;
    if (rental && payment.rental_id === rental && paid && captured && paid === captured) {
      const pointsElsewhere = (paymentIntent && !sameId(paymentIntent, intent) && paymentIntent !== chargeId)
        || (paymentInvoice && !sameId(paymentInvoice, invoice) && paymentInvoice !== chargeId);
      if (!pointsElsewhere) return true;
    }
  }
  return false;
}

/** Recorded payment ids that repeat a verified Stripe charge. */
export function duplicatePaymentIds(
  payments: readonly PaymentRef[],
  charges: readonly ChargeRef[],
  links: readonly RefundLink[],
): string[] {
  return payments.filter((payment) => charges.some((charge) => paymentMatchesCharge(payment, charge, links))).map((payment) => payment.id);
}

export type ReportingPayment = {
  id: string;
  amount: number | null;
  balance_due: number | null;
  refunded_amount: number | null;
  status: string | null;
  type: string | null;
  paid_date: string | null;
  refunded_at: string | null;
  payment_method: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  stripe_subscription_id: string | null;
  rental_id?: string | null;
  notes?: string | null;
};

export type StripeTotals = {
  currency: string;
  gross: number;
  refunds: number;
  fees: number | null;
  net: number | null;
};

export type StripeSlice = {
  status: "hidden" | "loading" | "error" | "ready";
  collectionsComplete: boolean;
  totals: StripeTotals[] | null;
  charges: ChargeRef[];
  /**
   * Refund rows from the same verified report as `charges`. Undefined means
   * they were not loaded. An empty array means the report had none.
   */
  refunds?: readonly StripeRefundRef[] | null;
};

export type DepositRentalFact = {
  id: string;
  deposit_amount: number | null;
  deposit_held: boolean | null;
  deposit_status: string | null;
};

export type DepositPaymentFact = {
  id: string;
  rental_id: string | null;
  type: string | null;
  status: string | null;
  net_collected: number | null;
};

export type DayWindow = { from: string; to: string };

export type Metric = { amount: number | null; reason: string | null };

export type PaymentSummary = {
  grossCollected: Metric;
  netCollected: Metric;
  outstanding: Metric;
  refunds: Metric;
  depositsHeld: Metric;
  fees: Metric;
  coverage: "Partial" | "Unavailable";
  coverageReason: string;
  duplicateIds: string[];
  /** Collected rows left out of a combined total because no authoritative link exists. */
  unmatched: UnmatchedRow[];
};

export type UnmatchedRow = {
  id: string;
  amount: number | null;
  paid_date: string | null;
  payment_method: string | null;
  reason: string;
};

const known = (amount: number, reason: string | null = null): Metric => ({ amount, reason });
const unavailable = (reason: string): Metric => ({ amount: null, reason });

function dollars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) return null;
  const rounded = cents / 100;
  // Math.round can preserve a negative zero, and currency format then prints -$0.00.
  return rounded === 0 ? 0 : rounded;
}

function fromCents(cents: number): number | null {
  if (!Number.isSafeInteger(cents)) return null;
  return cents / 100;
}

function add(left: number, right: number): number | null {
  return dollars(left + right);
}

function dayOf(value: string | null | undefined): string | null {
  return reportingDay(value);
}

function validRange(range: DayWindow | null): boolean {
  if (!range) return true;
  return rangeMessage(range) === null;
}

function inRange(day: string | null, range: DayWindow | null): boolean {
  if (!range) return true;
  if (!day) return false;
  return day >= range.from && day <= range.to;
}

export function revenuePaymentsSearch(range: DayWindow): { tab: "payments"; from: string; to: string } {
  return { tab: "payments", from: range.from, to: range.to };
}

/** A refundable deposit. The renter's money, not revenue. */
export function isDepositPayment(row: { type?: string | null }): boolean {
  return (row.type ?? "").trim().toLowerCase() === "deposit";
}

/** The revenue definition shared by the Overview tile and the 84-day trend. */
export function isRevenuePayment(row: { type?: string | null }): boolean {
  return !isDepositPayment(row);
}

/**
 * A Stripe charge that is a deposit. Reason wins. Otherwise every named
 * payment id must be loaded and every one of those rows must be a deposit.
 * A missing id, or a mix of deposit and rent, is not a deposit charge.
 */
export function isDepositCharge(
  charge: { reason?: string | null; paymentIds?: readonly string[] | null },
  payments: readonly { id: string; type?: string | null }[],
): boolean {
  if ((charge.reason ?? "").trim().toLowerCase() === "deposit") return true;
  const ids = (charge.paymentIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return false;
  const byId = new Map(payments.map((payment) => [payment.id, payment]));
  if (ids.some((id) => !byId.has(id))) return false;
  return ids.every((id) => isDepositPayment(byId.get(id)!));
}

/** Paid date when it exists, otherwise the due date. A row with neither is outside every range. */
export function rowInReportRange(
  row: { paid_date?: string | null; due_date?: string | null },
  range: DayWindow | null,
): boolean {
  if (!range || rangeMessage(range)) return false;
  const day = reportingDay(row.paid_date) ?? reportingDay(row.due_date);
  if (!day) return false;
  return day >= range.from && day <= range.to;
}

type OutstandingRow = { status?: string | null; balance_due?: number | null; amount?: number | null };

/**
 * Owed on the source filter only. The date range does not apply: an overdue
 * balance due before the window stays here. A missing or negative balance
 * withholds the total, matching the Outstanding Balances card.
 */
function outstandingMetric(rows: readonly OutstandingRow[]): Metric {
  let total = 0;
  for (const row of rows) {
    if (!OUTSTANDING_STATUSES.includes(row.status as (typeof OUTSTANDING_STATUSES)[number])) continue;
    const balance = row.balance_due === null ? dollars(row.amount) : dollars(row.balance_due);
    if (balance === null || balance < 0) return unavailable("A balance is missing, so outstanding balances are not shown.");
    const next = add(total, balance);
    if (next === null) return unavailable("Outstanding balances could not be added.");
    total = next;
  }
  return known(total);
}

export function recordedOutstandingTotal(rows: readonly OutstandingRow[]): number | null {
  return outstandingMetric(rows).amount;
}

export type PaymentView = {
  range: DayWindow | null;
  status: string;
  sort: "due_asc" | "due_desc" | "amount_desc";
  overdueStatuses?: readonly string[];
};

type ViewRow = OutstandingRow & { paid_date?: string | null; due_date?: string | null };

/** Rows the payments table shows for this source, range, status, and sort. */
export function visiblePayments<T extends ViewRow>(sourced: readonly T[], view: PaymentView): T[] {
  const overdue = new Set(view.overdueStatuses ?? []);
  const inRange = sourced.filter((row) => rowInReportRange(row, view.range));
  const filtered = view.status === "all"
    ? inRange
    : view.status === "overdue"
      ? inRange.filter((row) => overdue.has(String(row.status ?? "")))
      : inRange.filter((row) => row.status === view.status);
  return filtered.slice().sort((a, b) => {
    if (view.sort === "amount_desc") return Number(b.amount) - Number(a.amount);
    const ad = a.due_date || "9999";
    const bd = b.due_date || "9999";
    return view.sort === "due_asc" ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });
}

/** CSV rows are the table rows. This does not apply the range a second time. */
export function paymentCsvRecords<T extends ViewRow>(sourced: readonly T[], view: PaymentView): T[] {
  return visiblePayments(sourced, view);
}

export const PAYMENT_CSV_COLUMNS = ["Driver", "Vehicle", "Type", "Amount", "Due", "Status", "Method", "Late Fees", "Balance"] as const;

function csvField(value: string): string {
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !numeric && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Header plus one row per visible payment. Amounts are the strings the table shows. */
export function paymentsCsv(rows: readonly (readonly string[])[]): string {
  return [PAYMENT_CSV_COLUMNS, ...rows].map((line) => line.map((cell) => csvField(String(cell ?? ""))).join(",")).join("\n");
}

export function paymentsExportFilename(source: string, range: DayWindow): string {
  return `payments-${source}-${range.from}-${range.to}.csv`;
}

const DEPOSIT_NOTE = "Refundable deposits are not revenue. They stay in Deposits held.";

type StripeMoney = {
  gross: number;
  refunds: number;
  fees: number | null;
  net: number | null;
  reason: string | null;
  depositsExcluded?: boolean;
};

function stripeMoney(stripe: StripeSlice): StripeMoney | { reason: string } {
  if (stripe.status === "loading") return { reason: "Verified Stripe collections are still loading." };
  if (stripe.status === "hidden") return { reason: "Verified Stripe collections are Manager only, so a combined total is not shown." };
  if (stripe.status === "error") return { reason: "Verified Stripe collections could not be loaded." };
  if (!stripe.collectionsComplete || !stripe.totals) {
    return { reason: "Stripe could not verify every collection in this range, so no combined total is shown." };
  }
  if (stripe.totals.some((row) => row.currency.toLowerCase() !== "usd" || !Number.isSafeInteger(row.gross) || !Number.isSafeInteger(row.refunds))) {
    return { reason: "A non-USD Stripe total cannot be added to dollar payments." };
  }
  const gross = fromCents(stripe.totals.reduce((sum, row) => sum + row.gross, 0));
  const refunds = fromCents(stripe.totals.reduce((sum, row) => sum + row.refunds, 0));
  if (gross === null || refunds === null) return { reason: "The Stripe total is too large to add." };
  const feesKnown = stripe.totals.every((row) => row.fees !== null && Number.isSafeInteger(row.fees));
  const fees = feesKnown ? fromCents(stripe.totals.reduce((sum, row) => sum + (row.fees ?? 0), 0)) : null;
  const net = fees === null ? null : dollars(gross - refunds - fees);
  return { gross, refunds, fees, net, reason: null };
}

function chargeDay(created: number | null | undefined): string | null {
  if (typeof created !== "number" || !Number.isFinite(created)) return null;
  return reportingDay(new Date(created * 1000).toISOString());
}

/**
 * Stripe totals already include every succeeded charge in the report window.
 * Remove deposit charges whose Eastern capture day is inside `range`, and
 * remove succeeded refunds of deposit charges whose Eastern refund day is
 * inside `range` (the charge itself may be older). Out-of-window charges
 * stay, because they are not in this window's gross.
 */
function adjustStripeForDeposits(
  money: StripeMoney,
  stripe: StripeSlice,
  payments: readonly ReportingPayment[],
  range: DayWindow | null,
): StripeMoney | { reason: string } {
  const depositCharges = [...new Map(
    stripe.charges.filter((charge) => isDepositCharge(charge, payments)).map((charge) => [charge.id, charge]),
  ).values()];
  if (depositCharges.length === 0) return money;
  if (stripe.refunds == null) {
    return { reason: "Stripe deposit refunds were not loaded, so revenue is not shown." };
  }

  const inside = (created: number | null | undefined): boolean | null => {
    const day = chargeDay(created);
    if (!day) return null;
    return inRange(day, range);
  };

  const grossCharges: ChargeRef[] = [];
  let feesUnknown = false;
  for (const charge of depositCharges) {
    const placed = inside(charge.created);
    if (placed === null) return { reason: "A Stripe deposit charge has no capture date, so revenue is not shown." };
    if (!placed) continue;
    const amount = charge.amount;
    const currency = charge.currency;
    const status = charge.status;
    const paid = charge.paid;
    const captured = charge.captured;
    const shapeKnown = typeof amount === "number"
      && typeof currency === "string"
      && typeof status === "string"
      && typeof paid === "boolean"
      && typeof captured === "boolean";
    if (!shapeKnown) return { reason: "A Stripe deposit charge in this range could not be measured, so revenue is not shown." };
    const counted = paid
      && captured
      && status === "succeeded"
      && currency.toLowerCase() === "usd"
      && Number.isSafeInteger(amount)
      && amount > 0;
    if (!counted) continue;
    if (!Number.isSafeInteger(charge.fee)) feesUnknown = true;
    grossCharges.push(charge);
  }

  const depositIds = new Set(depositCharges.map((charge) => charge.id));
  const seenRefunds = new Set<string>();
  let refundCents = 0;
  let refundFeeCents = 0;
  for (const refund of stripe.refunds) {
    if (!depositIds.has(refund.chargeId)) continue;
    const key = refund.id ?? `${refund.chargeId}:${refund.created}:${refund.amount}`;
    if (seenRefunds.has(key)) continue;
    seenRefunds.add(key);
    const placed = inside(refund.created);
    if (placed === null) return { reason: "A Stripe deposit refund has no date, so revenue is not shown." };
    if (!placed || refund.status !== "succeeded") continue;
    if (refund.currency.toLowerCase() !== "usd" || !Number.isSafeInteger(refund.amount) || refund.amount < 0) {
      return { reason: "A Stripe deposit refund could not be read, so revenue is not shown." };
    }
    refundCents += refund.amount;
    if (!Number.isSafeInteger(refund.fee)) feesUnknown = true;
    else refundFeeCents += refund.fee ?? 0;
  }

  if (grossCharges.length === 0 && refundCents === 0) return money;

  let grossCents = 0;
  let feeCents = 0;
  for (const charge of grossCharges) {
    grossCents += charge.amount ?? 0;
    if (Number.isSafeInteger(charge.fee)) feeCents += charge.fee ?? 0;
  }
  const gross = fromCents(Math.round(money.gross * 100) - grossCents);
  const refunds = fromCents(Math.round(money.refunds * 100) - refundCents);
  if (gross === null || refunds === null || gross < 0 || refunds < 0) {
    return { reason: "Stripe deposit charges could not be removed from the collected total." };
  }
  const fees = money.fees === null || feesUnknown
    ? null
    : fromCents(Math.round(money.fees * 100) - feeCents - refundFeeCents);
  const net = fees === null ? null : dollars(gross - refunds - fees);
  return { gross, refunds, fees, net, reason: null, depositsExcluded: true };
}

function depositHeld(rental: DepositRentalFact): boolean {
  const status = rental.deposit_status?.trim().toLowerCase() ?? "";
  if (DEPOSIT_CLOSED.has(status)) return false;
  return rental.deposit_held === true || status === "held" || status === "pending_disposition";
}

function depositsHeld(source: SourceFilter, deposits: { rentals: DepositRentalFact[]; payments: DepositPaymentFact[] } | null): Metric {
  if (source !== "all") {
    return unavailable("Held deposits are recorded on the rental, not by payment method, so this filter cannot total them.");
  }
  if (!deposits) return unavailable("Rental deposit status could not be loaded, so deposits held are not shown.");
  const rentalIds = new Set(deposits.rentals.map((rental) => rental.id));
  let total = 0;
  for (const rental of deposits.rentals) {
    if (!depositHeld(rental)) continue;
    const paid = deposits.payments.filter(
      (payment) => payment.rental_id === rental.id && payment.type === "deposit" && payment.status === "paid",
    );
    if (paid.length) {
      for (const payment of paid) {
        const net = dollars(payment.net_collected);
        if (net === null || net < 0) return unavailable("A held deposit payment has no collected amount.");
        const next = add(total, net);
        if (next === null) return unavailable("Deposits held could not be added.");
        total = next;
      }
    } else {
      const amount = dollars(rental.deposit_amount);
      if (amount === null || amount < 0) return unavailable("A held deposit has no amount, so the total is not shown.");
      const next = add(total, amount);
      if (next === null) return unavailable("Deposits held could not be added.");
      total = next;
    }
  }
  for (const payment of deposits.payments) {
    if (payment.type !== "deposit" || payment.status !== "paid") continue;
    if (payment.rental_id && rentalIds.has(payment.rental_id)) continue;
    const net = dollars(payment.net_collected);
    if (net === null || net < 0) return unavailable("A deposit payment has no collected amount.");
    const next = add(total, net);
    if (next === null) return unavailable("Deposits held could not be added.");
    total = next;
  }
  return known(total, "Current held deposits. Applied, forfeited, and refunded deposits are not included. Not limited to the date range.");
}

function outstandingOf(rows: ReportingPayment[], source: SourceFilter): Metric {
  const metric = outstandingMetric(rows);
  if (metric.amount === null) return metric;
  const note = source === "stripe"
    ? "Recorded balances on Stripe-linked payments. Upcoming Stripe invoices are in Stripe Collections, not in this figure. Not limited to the date range."
    : "Current recorded balances. Not limited to the date range.";
  return known(metric.amount, note);
}

/**
 * Combined summary for one source filter and one inclusive paid-date range.
 * `range` null means every recorded date. Stripe is still only whatever
 * report the caller loaded for its own window.
 */
function withheldReason(payment: ReportingPayment): string | null {
  if (hasStripeId(payment)) return null;
  if (isManualCard(payment)) return "Card (manual) has no Stripe id, so it is not added on top of verified Stripe collections.";
  if (!normalizePaymentMethod(payment.payment_method)) return "No payment method and no authoritative Stripe link, so this row is not added.";
  return null;
}

export function summarizePayments(input: {
  payments: readonly ReportingPayment[];
  /** Null means the refund-link read failed. Charge-id dedupe is then impossible. */
  refundLinks: readonly RefundLink[] | null;
  stripe: StripeSlice;
  deposits: { rentals: DepositRentalFact[]; payments: DepositPaymentFact[] } | null;
  source: SourceFilter;
  range: DayWindow | null;
  /** A payments, refund-link, or rental read that stopped before the last row. */
  truncated?: boolean;
}): PaymentSummary {
  if (input.truncated) {
    const reason = "The payment read stopped before the last row, so no total is shown.";
    const metric = unavailable(reason);
    return {
      grossCollected: metric,
      netCollected: metric,
      outstanding: metric,
      refunds: metric,
      depositsHeld: metric,
      fees: metric,
      coverage: "Unavailable",
      coverageReason: reason,
      duplicateIds: [],
      unmatched: [],
    };
  }
  const rows = input.payments.filter((payment) => input.source === "all" || classifyPaymentSource(payment) === input.source);
  const stripeIncluded = input.source === "all" || input.source === "stripe";
  let stripe = stripeIncluded ? stripeMoney(input.stripe) : null;
  if (stripe && "gross" in stripe) stripe = adjustStripeForDeposits(stripe, input.stripe, input.payments, input.range);
  const charges = stripe && "gross" in stripe ? input.stripe.charges : [];
  const linksUnknown = stripeIncluded && charges.length > 0 && input.refundLinks === null;
  const duplicateIds = linksUnknown ? [] : duplicatePaymentIds(rows, charges, input.refundLinks ?? []);
  const duplicated = new Set(duplicateIds);
  const unmatched: UnmatchedRow[] = [];
  const recordedDepositInRange = rows.some((payment) => {
    if (!isDepositPayment(payment) || !COLLECTED.has(payment.status ?? "")) return false;
    return inRange(dayOf(payment.paid_date), input.range);
  });
  const collected = rows.filter((payment) => {
    if (isDepositPayment(payment)) return false;
    if (!COLLECTED.has(payment.status ?? "") || duplicated.has(payment.id)) return false;
    if (!stripeIncluded) return true;
    const reason = withheldReason(payment);
    if (!reason) return true;
    const day = dayOf(payment.paid_date);
    if (input.range && day && !inRange(day, input.range)) return false;
    unmatched.push({
      id: payment.id,
      amount: dollars(payment.amount),
      paid_date: payment.paid_date,
      payment_method: payment.payment_method,
      reason,
    });
    return false;
  });

  const failPeriod = (reason: string): { gross: Metric; refunds: Metric; net: Metric; fees: Metric } => ({
    gross: unavailable(reason),
    refunds: unavailable(reason),
    net: unavailable(reason),
    fees: unavailable(reason),
  });

  let period: { gross: Metric; refunds: Metric; net: Metric; fees: Metric };
  if (!validRange(input.range)) {
    period = failPeriod(input.range ? rangeMessage(input.range) ?? "The date range is not valid." : "The date range is not valid.");
  } else if (stripe && !("gross" in stripe)) {
    period = failPeriod(stripe.reason);
  } else if (linksUnknown) {
    period = failPeriod("Payment refund links could not be loaded, so Stripe charges and recorded payments cannot be deduplicated.");
  } else {
    const stripeGross = stripe && "gross" in stripe ? stripe.gross : 0;
    const stripeRefunds = stripe && "gross" in stripe ? stripe.refunds : 0;
    const stripeFees = stripe && "gross" in stripe ? stripe.fees : null;
    let grossAmount = stripeGross;
    let refundAmount = 0;
    let grossMetric: Metric = known(0);
    let refundMetric: Metric = known(0);
    if (input.range && collected.some((payment) => !dayOf(payment.paid_date))) {
      grossMetric = unavailable("A collected payment has no paid date, so the period total is not shown.");
    } else {
      for (const payment of collected) {
        if (!inRange(dayOf(payment.paid_date), input.range)) continue;
        const amount = dollars(payment.amount);
        if (amount === null || amount < 0) {
          grossMetric = unavailable("A collected amount is missing or invalid.");
          break;
        }
        const next = add(grossAmount, amount);
        if (next === null) {
          grossMetric = unavailable("Gross collected could not be added.");
          break;
        }
        grossAmount = next;
      }
      if (grossMetric.amount !== null) {
        const excluded = recordedDepositInRange || (stripe && "gross" in stripe && stripe.depositsExcluded === true);
        grossMetric = known(grossAmount, excluded ? DEPOSIT_NOTE : null);
      }
    }
    const refundRows = collected.filter((payment) => {
      const refunded = dollars(payment.refunded_amount);
      return refunded !== null && refunded > 0;
    });
    if (collected.some((payment) => payment.refunded_amount !== null && payment.refunded_amount !== 0 && dollars(payment.refunded_amount) === null)) {
      refundMetric = unavailable("A refund amount is invalid.");
    } else if (input.range && refundRows.some((payment) => !dayOf(payment.refunded_at))) {
      refundMetric = unavailable("A refund has no refunded date, so it cannot be placed in this range.");
    } else {
      for (const payment of refundRows) {
        if (input.range && !inRange(dayOf(payment.refunded_at), input.range)) continue;
        const refunded = dollars(payment.refunded_amount);
        if (refunded === null || refunded < 0 || (dollars(payment.amount) !== null && refunded > (dollars(payment.amount) as number))) {
          refundMetric = unavailable("A refund is larger than the payment or is invalid.");
          break;
        }
        const next = add(refundAmount, refunded);
        if (next === null) {
          refundMetric = unavailable("Refunds could not be added.");
          break;
        }
        refundAmount = next;
      }
      if (refundMetric.amount !== null) {
        const stripePart = stripe && "gross" in stripe ? stripeRefunds : 0;
        const signed = dollars(-(refundAmount + stripePart));
        refundMetric = signed === null ? unavailable("Refunds could not be signed.") : known(signed);
      }
    }
    let netMetric: Metric;
    if (grossMetric.amount === null || refundMetric.amount === null) {
      netMetric = unavailable(grossMetric.reason ?? refundMetric.reason ?? "Net collected cannot be computed until gross and refunds are known.");
    } else if (stripe && stripeFees === null) {
      netMetric = unavailable("Some Stripe fees are unavailable, so net collected is not shown.");
    } else {
      // Gross includes Stripe. Refunds are already negative and include Stripe.
      // Split them back apart so Stripe's fee can be applied only to Stripe.
      const internalGross = stripe ? dollars(grossMetric.amount - stripeGross) : grossMetric.amount;
      const internalRefunds = stripe ? dollars(refundMetric.amount + stripeRefunds) : refundMetric.amount;
      const stripeNet = stripe ? dollars(stripeGross - stripeRefunds - (stripeFees ?? 0)) : 0;
      const internalNet = internalGross === null || internalRefunds === null ? null : dollars(internalGross + internalRefunds);
      const net = stripeNet === null || internalNet === null ? null : add(stripeNet, internalNet);
      const excluded = recordedDepositInRange || (stripe && "gross" in stripe && stripe.depositsExcluded === true);
      const netNote = stripe && collected.length > 0
        ? "Stripe net is after processor fees. Recorded payments have no fee column, so their net is the amount minus refunds only."
        : stripe
          ? "Verified Stripe net after refunds and fees."
          : "Recorded amount minus refunds. Processing fees are not stored for this method.";
      netMetric = net === null
        ? unavailable("Net collected could not be added.")
        : known(net, excluded ? `${DEPOSIT_NOTE} ${netNote}` : netNote);
    }
    let feesMetric: Metric;
    if (!stripeIncluded) {
      feesMetric = unavailable("Processing fees are not stored on payments. They are known only from verified Stripe balance transactions.");
    } else if (stripeFees === null) {
      feesMetric = unavailable("Some Stripe fees are unavailable, so the fee total is not shown.");
    } else if (collected.length > 0) {
      feesMetric = unavailable("Recorded payments have no processing-fee column, so a combined fee total is not shown. Stripe fees are on the Stripe filter.");
    } else {
      const signed = dollars(-stripeFees);
      feesMetric = signed === null
        ? unavailable("Stripe fees could not be signed.")
        : known(signed, "Stripe's fee sign, as cash: a charge is negative and a fee returned with a refund is positive.");
    }
    period = { gross: grossMetric, refunds: refundMetric, net: netMetric, fees: feesMetric };
  }
  if (linksUnknown || (stripe && !("gross" in stripe))) unmatched.length = 0;

  const outstanding = outstandingOf(rows, input.source);
  const deposits = depositsHeld(input.source, input.deposits);
  const required = [period.gross, period.net, outstanding, period.refunds];
  const coverage = required.some((metric) => metric.amount === null) ? "Unavailable" : "Partial";
  let coverageReason = coverage === "Unavailable"
    ? required.filter((metric) => metric.amount === null).map((metric) => metric.reason).filter(Boolean).join(" ")
    : input.source === "all"
      ? "Verified Stripe collections plus recorded payments that are not the same Stripe charge. Manual methods are not processor-verified."
      : input.source === "stripe"
        ? "Verified Stripe collections for this range. Recorded rows that match a charge are not added again."
        : "Recorded payments for this method. Not an external processor verification.";
  if (coverage === "Partial" && unmatched.length > 0) {
    coverageReason += ` ${unmatched.length} recorded ${unmatched.length === 1 ? "payment has" : "payments have"} no authoritative Stripe link and ${unmatched.length === 1 ? "is" : "are"} not added.`;
  }
  return {
    grossCollected: period.gross,
    netCollected: period.net,
    outstanding,
    refunds: period.refunds,
    depositsHeld: deposits,
    fees: period.fees,
    coverage,
    coverageReason,
    duplicateIds,
    unmatched,
  };
}
