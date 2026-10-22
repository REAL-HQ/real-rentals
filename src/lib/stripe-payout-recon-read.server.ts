import { STRIPE_READER_MAX_PAGES, STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import { customerIdOf, stripeId, subscriptionIdOf } from "./stripe-unmatched";
import type { PayoutWindow, ReconPayoutInput, ReconTxn } from "./stripe-payout-recon";

/**
 * Payouts and their balance transactions only.
 * createReadOnlyStripe("live", { cache: true }) with list.
 * The balance transaction list is filtered by payout and expands the charge so its payment_intent can be matched.
 * Paid invoices in the same window map that payment intent to stripe_invoice_id.
 * A page cap or any Stripe error, including the invoice list, returns no partial payouts.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type Raw = Record<string, unknown>;

export type PayoutReconGateway = {
  payouts: {
    list: (
      params: { arrival_date: { gte: number; lt: number }; limit: number; starting_after?: string },
      options?: CallOptions,
    ) => Promise<Page<Raw>>;
  };
  balanceTransactions: {
    list: (
      params: { payout: string; limit: number; expand: ["data.source"]; starting_after?: string },
      options?: CallOptions,
    ) => Promise<Page<Raw>>;
  };
  invoices: {
    list: (
      params: { status: "paid"; created: { gte: number; lt: number }; limit: number; expand: ["data.payments"]; starting_after?: string },
      options?: CallOptions,
    ) => Promise<Page<Raw>>;
  };
};

export type PayoutReconStripeRead = { ok: true; payouts: ReconPayoutInput[] } | { ok: false; capped: boolean };

export async function readPayoutRecon(
  gateway: PayoutReconGateway,
  window: PayoutWindow,
  options: { timeoutMs?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<PayoutReconStripeRead> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.payouts.list(
        { arrival_date: { gte: window.gte, lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) },
        { timeout: remaining(deadline, now) },
      ),
      { label: "payouts", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, strict: true },
    );
    if (!listed.ok) return { ok: false, capped: listed.reason === "capped" };
    const payouts: ReconPayoutInput[] = [];
    for (const row of listed.rows) {
      const payout = mapPayout(row);
      if (payout === "skip") continue;
      if (payout === "bad") return { ok: false, capped: false };
      const balances = await paginateStripeList(
        (cursor) => gateway.balanceTransactions.list(
          { payout: payout.id, limit: STRIPE_READER_PAGE_SIZE, expand: ["data.source"], ...(cursor ? { starting_after: cursor } : {}) },
          { timeout: remaining(deadline, now) },
        ),
        { label: `payout ${payout.id} balance transactions`, maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, strict: true },
      );
      if (!balances.ok) return { ok: false, capped: balances.reason === "capped" };
      const transactions: ReconTxn[] = [];
      for (const txn of balances.rows) {
        const mapped = mapTxn(txn);
        if (mapped === "skip") continue;
        if (mapped === "bad") return { ok: false, capped: false };
        transactions.push(mapped);
      }
      payouts.push({ ...payout, transactions });
    }
    const indexed = await indexPaidInvoices(gateway, window, { timeoutMs: options.timeoutMs, now, signal: options.signal, deadline });
    if (!indexed.ok) return { ok: false, capped: indexed.capped };
    for (const payout of payouts) {
      for (const txn of payout.transactions) {
        const hit = txn.paymentIntentId ? indexed.byIntent.get(txn.paymentIntentId) : undefined;
        if (!hit) continue;
        txn.invoiceId = hit.invoiceId;
        txn.subscriptionId = hit.subscriptionId;
        txn.customerId = hit.customerId;
      }
    }
    return { ok: true, payouts };
  } catch {
    return { ok: false, capped: false };
  }
}

async function indexPaidInvoices(
  gateway: PayoutReconGateway,
  window: PayoutWindow,
  options: { timeoutMs?: number; now: () => number; signal?: AbortSignal; deadline: number },
): Promise<{ ok: true; byIntent: Map<string, { invoiceId: string; subscriptionId: string | null; customerId: string | null }> } | { ok: false; capped: boolean }> {
  const listed = await paginateStripeList(
    (cursor) => gateway.invoices.list(
      {
        status: "paid",
        created: { gte: window.gte, lt: window.lt },
        limit: STRIPE_READER_PAGE_SIZE,
        expand: ["data.payments"],
        ...(cursor ? { starting_after: cursor } : {}),
      },
      { timeout: remaining(options.deadline, options.now) },
    ),
    { label: "payout reconciliation invoices", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline: options.deadline, now: options.now, strict: true },
  );
  if (!listed.ok) return { ok: false, capped: listed.reason === "capped" };
  const byIntent = new Map<string, { invoiceId: string; subscriptionId: string | null; customerId: string | null }>();
  for (const row of listed.rows) {
    if (row.livemode === false) continue;
    const indexed = indexInvoice(row);
    if (indexed === "bad") return { ok: false, capped: false };
    for (const intent of indexed.intents) byIntent.set(intent, indexed);
  }
  return { ok: true, byIntent };
}

function indexInvoice(row: Raw): { invoiceId: string; subscriptionId: string | null; customerId: string | null; intents: string[] } | "bad" {
  const invoiceId = text(row.id);
  if (!invoiceId) return "bad";
  const page = record(row.payments);
  if (!page || !Array.isArray(page.data) || page.has_more !== false) return "bad";
  const intents: string[] = [];
  for (const item of page.data) {
    const payment = record(record(item)?.payment);
    const intent = stripeId(payment?.payment_intent);
    if (intent) intents.push(intent);
  }
  return {
    invoiceId,
    subscriptionId: subscriptionIdOf(row as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } | null }),
    customerId: customerIdOf(row as { customer?: unknown }),
    intents,
  };
}

export function readLivePayoutRecon(window: PayoutWindow): Promise<PayoutReconStripeRead> {
  return readPayoutRecon(createReadOnlyStripe("live", { cache: true }) as unknown as PayoutReconGateway, window);
}

function mapPayout(row: Raw): Omit<ReconPayoutInput, "transactions"> | "skip" | "bad" {
  if (row.livemode === false) return "skip";
  if (typeof row.id !== "string" || !row.id || !integer(row.amount) || !integer(row.arrival_date)) return "bad";
  if (typeof row.status !== "string" || !row.status || typeof row.currency !== "string" || !row.currency) return "bad";
  return { id: row.id, amount: row.amount, currency: row.currency.toLowerCase(), status: row.status, arrival: row.arrival_date };
}

function mapTxn(row: Raw): ReconTxn | "skip" | "bad" {
  if (row.livemode === false) return "skip";
  if (typeof row.id !== "string" || !row.id || !integer(row.amount) || !integer(row.fee) || !integer(row.net)) return "bad";
  if (typeof row.type !== "string" || !row.type || typeof row.currency !== "string" || !row.currency) return "bad";
  const source = row.source;
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    fee: row.fee,
    net: row.net,
    currency: row.currency.toLowerCase(),
    chargeId: chargeId(source),
    paymentIntentId: paymentIntentId(source),
    invoiceId: null,
    subscriptionId: null,
    customerId: null,
  };
}

function chargeId(source: unknown): string | null {
  if (typeof source === "string" && source.trim()) return source.trim();
  return text(record(source)?.id);
}

function paymentIntentId(source: unknown): string | null {
  const row = record(source);
  if (!row) return null;
  const intent = row.payment_intent;
  if (typeof intent === "string" && intent.trim()) return intent.trim();
  return text(record(intent)?.id);
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function record(value: unknown): Raw | null {
  return value && typeof value === "object" ? value as Raw : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
