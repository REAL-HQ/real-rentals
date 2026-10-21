import { customerIdOf, stripeId, subscriptionIdOf, unmatchedWindow } from "./stripe-unmatched";
import { INVOICE_MAX_PAGES, INVOICE_PAGE, readDirectory } from "./stripe-unmatched.server";
import {
  CHARGE_TYPES,
  arrivalDay,
  paidNotInPayout,
  statusLabel,
  unmatchedCharges,
  type PaidGap,
  type PayoutCharge,
  type UnmatchedCharge,
} from "./stripe-payout-match";

export const PAYOUT_PAGE = 100;
export const PAYOUT_MAX_PAGES = 10;
export const TXN_PAGE = 100;
export const TXN_MAX_PAGES = 4;

export type PayoutRow = {
  id: string;
  arrival: string | null;
  status: string;
  amountCents: number | null;
};

export type PayoutMatchReport =
  | { status: "unavailable"; reason: string; payouts: []; unmatched: []; paidNotInPayout: []; truncated: false }
  | {
      status: "ready";
      payouts: PayoutRow[];
      unmatched: UnmatchedCharge[];
      paidNotInPayout: PaidGap[];
      truncated: boolean;
      truncatedBecause: "payouts" | "transactions" | "payments" | "invoices" | "directory" | null;
    };

type Raw = Record<string, unknown>;
type Page = { data: unknown[]; has_more: boolean };
type Db = { from: (table: string) => unknown };
type StripeLists = {
  payouts: { list: (query: Record<string, unknown>) => Promise<Page> };
  balanceTransactions: { list: (query: Record<string, unknown>) => Promise<Page> };
  invoices: { list: (query: Record<string, unknown>) => Promise<Page> };
};

export async function loadPayoutMatch(db: Db, stripe: StripeLists, now = new Date()): Promise<PayoutMatchReport> {
  const window = unmatchedWindow(now);
  if (!window) return unavailable("The Date Window Could Not Be Read");
  let stripeRead: StripeRead | null;
  try {
    stripeRead = await readStripe(stripe, window);
  } catch {
    return unavailable("Stripe Could Not Be Read");
  }
  if (!stripeRead) return unavailable("Stripe Could Not Be Read");

  const payments = await readDirectory(db, "payments", "id,stripe_payment_intent_id,status,paid_date,amount");
  if (!payments) return unavailable("The Payment Read Did Not Complete");
  const rentals = await readDirectory(db, "rentals", "id,stripe_subscription_id,stripe_customer_id");
  if (!rentals) return unavailable("The Rental Read Did Not Complete");
  const applications = await readDirectory(db, "applications", "id,stripe_customer_id");
  if (!applications) return unavailable("The Application Read Did Not Complete");

  const paymentIntentIds = new Set<string>();
  for (const row of payments.rows) {
    const intent = text(row.stripe_payment_intent_id);
    if (intent) paymentIntentIds.add(intent);
  }
  const limits = {
    directoryComplete: !rentals.truncated && !applications.truncated,
    invoicesComplete: stripeRead.invoicesComplete,
  };
  const rentalLinks = rentals.rows.map((row) => ({
    subscriptionId: row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id),
    customerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
  }));
  const applicationLinks = applications.rows.map((row) => ({
    customerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
  }));
  const unmatched = payments.truncated
    ? []
    : unmatchedCharges(stripeRead.charges, paymentIntentIds, rentalLinks, applicationLinks, limits);
  const seenIntents = new Set(stripeRead.charges.flatMap((charge) => (charge.paymentIntentId ? [charge.paymentIntentId] : [])));
  const gaps = payments.truncated || stripeRead.payoutsTruncated || stripeRead.transactionsTruncated
    ? []
    : paidNotInPayout({
        payments: payments.rows.map((row) => ({
          id: String(row.id),
          status: row.status == null ? "" : String(row.status),
          paidDate: row.paid_date == null ? null : String(row.paid_date),
          paymentIntentId: text(row.stripe_payment_intent_id),
          amount: row.amount,
        })),
        seenIntents,
        from: window.from,
        to: window.to,
      });
  const truncatedBecause = stripeRead.payoutsTruncated
    ? "payouts"
    : stripeRead.transactionsTruncated
      ? "transactions"
      : payments.truncated
        ? "payments"
        : !stripeRead.invoicesComplete
          ? "invoices"
          : !limits.directoryComplete
            ? "directory"
            : null;
  return {
    status: "ready",
    payouts: stripeRead.payouts,
    unmatched,
    paidNotInPayout: gaps,
    truncated: truncatedBecause != null,
    truncatedBecause,
  };
}

type StripeRead = {
  payouts: PayoutRow[];
  charges: PayoutCharge[];
  payoutsTruncated: boolean;
  transactionsTruncated: boolean;
  invoicesComplete: boolean;
};

async function readStripe(stripe: StripeLists, window: { gte: number; lt: number }): Promise<StripeRead | null> {
  const listed = await readList(
    (cursor) => stripe.payouts.list({
      arrival_date: { gte: window.gte, lt: window.lt },
      limit: PAYOUT_PAGE,
      ...(cursor ? { starting_after: cursor } : {}),
    }),
    PAYOUT_MAX_PAGES,
  );
  if (!listed) return null;
  const payouts: PayoutRow[] = [];
  const charges: PayoutCharge[] = [];
  let transactionsTruncated = false;
  for (const row of listed.rows) {
    const payout = mapPayout(row);
    if (payout === "skip") continue;
    if (payout === "bad") return null;
    const txns = await readList(
      (cursor) => stripe.balanceTransactions.list({
        payout: payout.id,
        limit: TXN_PAGE,
        expand: ["data.source"],
        ...(cursor ? { starting_after: cursor } : {}),
      }),
      TXN_MAX_PAGES,
    );
    if (!txns) return null;
    if (txns.truncated) {
      transactionsTruncated = true;
      continue;
    }
    payouts.push({ id: payout.id, arrival: payout.arrival, status: payout.status, amountCents: payout.amountCents });
    for (const txn of txns.rows) {
      const mapped = mapCharge(txn, payout.id);
      if (mapped === "skip" || mapped === "ignore") continue;
      if (mapped === "bad") return null;
      charges.push(mapped);
    }
  }
  const invoices = await readList(
    (cursor) => stripe.invoices.list({
      status: "paid",
      created: { gte: window.gte, lt: window.lt },
      limit: INVOICE_PAGE,
      expand: ["data.payments"],
      ...(cursor ? { starting_after: cursor } : {}),
    }),
    INVOICE_MAX_PAGES,
  );
  if (!invoices) return null;
  const index = indexInvoices(invoices.rows);
  for (const charge of charges) {
    const hit = charge.paymentIntentId ? index.byIntent.get(charge.paymentIntentId) : undefined;
    if (!hit) continue;
    charge.invoiceSeen = true;
    charge.subscriptionId = hit.subscriptionId;
    if (!charge.customerId) charge.customerId = hit.customerId;
  }
  return {
    payouts,
    charges,
    payoutsTruncated: listed.truncated,
    transactionsTruncated,
    invoicesComplete: !invoices.truncated && index.complete,
  };
}

function indexInvoices(rows: Raw[]): {
  byIntent: Map<string, { subscriptionId: string | null; customerId: string | null }>;
  complete: boolean;
} {
  const byIntent = new Map<string, { subscriptionId: string | null; customerId: string | null }>();
  let complete = true;
  for (const invoice of rows) {
    const subscriptionId = subscriptionIdOf(invoice as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } | null });
    const customerId = customerIdOf(invoice as { customer?: unknown });
    const payments = invoice.payments;
    const page = payments && typeof payments === "object" ? payments as { data?: unknown; has_more?: unknown } : null;
    if (!page || !Array.isArray(page.data) || page.has_more !== false) {
      complete = false;
      continue;
    }
    for (const item of page.data) {
      const payment = item && typeof item === "object" ? (item as { payment?: { payment_intent?: unknown } }).payment : null;
      const intent = stripeId(payment?.payment_intent);
      if (!intent) continue;
      byIntent.set(intent, { subscriptionId, customerId });
    }
  }
  return { byIntent, complete };
}

function mapPayout(row: Raw): { id: string; arrival: string | null; status: string; amountCents: number | null } | "skip" | "bad" {
  if (row.livemode === false) return "skip";
  const id = text(row.id);
  if (!id || !integer(row.amount) || !integer(row.arrival_date) || row.arrival_date <= 0) return "bad";
  if (!text(row.status) || !text(row.currency)) return "bad";
  const currency = String(row.currency).toLowerCase();
  return {
    id,
    arrival: arrivalDay(row.arrival_date),
    status: statusLabel(String(row.status)),
    amountCents: currency === "usd" ? row.amount : null,
  };
}

function mapCharge(row: Raw, payoutId: string): PayoutCharge | "skip" | "ignore" | "bad" {
  if (row.livemode === false) return "skip";
  const id = text(row.id);
  if (!id || !integer(row.amount) || !integer(row.fee) || !integer(row.net)) return "bad";
  const type = text(row.type);
  const currency = text(row.currency);
  if (!type || !currency) return "bad";
  if (!CHARGE_TYPES.has(type)) return "ignore";
  if (typeof row.source === "string") return "bad";
  const source = row.source && typeof row.source === "object" ? row.source as Raw : null;
  return {
    payoutId,
    chargeId: text(source?.id) ?? id,
    paymentIntentId: stripeId(source?.payment_intent),
    customerId: stripeId(source?.customer),
    subscriptionId: null,
    invoiceSeen: false,
    amountCents: currency.toLowerCase() === "usd" ? row.amount : null,
  };
}

async function readList(
  load: (cursor?: string) => Promise<Page>,
  maxPages: number,
): Promise<{ rows: Raw[]; truncated: boolean } | null> {
  const rows: Raw[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await load(cursor);
    if (!result || !Array.isArray(result.data) || typeof result.has_more !== "boolean") return null;
    for (const row of result.data) {
      if (!row || typeof row !== "object") return null;
      const record = row as Raw;
      const id = text(record.id);
      if (!id || rows.some((existing) => existing.id === id)) return null;
      rows.push(record);
    }
    if (!result.has_more) return { rows, truncated: false };
    const next = text((result.data.at(-1) as Raw | undefined)?.id);
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return { rows, truncated: true };
}

function unavailable(reason: string): PayoutMatchReport {
  return { status: "unavailable", reason, payouts: [], unmatched: [], paidNotInPayout: [], truncated: false };
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
