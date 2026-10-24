import { STRIPE_READER_MAX_PAGES, STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import { customerIdOf, stripeId, subscriptionIdOf } from "./stripe-unmatched";
import type { PayoutInvoiceLink, PayoutWindow, ReconPayoutInput, ReconTxn } from "./stripe-payout-recon";

/**
 * Payouts, their balance transactions, and the invoices those charges reference.
 * createReadOnlyStripe("live", { cache: true }) with list, plus invoices.retrieve
 * for an invoice id on a charge in this window when the created-window list did not include it.
 * The balance transaction list is filtered by payout and expands the charge so its payment_intent
 * or its invoice id can be matched. A page cap or any Stripe error returns no partial payouts.
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
    retrieve?: (
      id: string,
      params: { expand: ["payments"] },
      options?: CallOptions,
    ) => Promise<Raw>;
  };
};

export type PayoutReconStripeRead =
  | { ok: true; payouts: ReconPayoutInput[]; invoiceLinks?: PayoutInvoiceLink[] }
  | { ok: false; capped: boolean };

type IndexedInvoice = {
  invoiceId: string;
  subscriptionId: string | null;
  customerId: string | null;
  intents: string[];
};

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
    const indexed = await indexPaidInvoices(gateway, window, payouts, { now, signal: options.signal, deadline });
    if (!indexed.ok) return { ok: false, capped: indexed.capped };
    for (const payout of payouts) {
      for (const txn of payout.transactions) {
        const direct = txn.invoiceId ? indexed.byInvoice.get(txn.invoiceId) : undefined;
        const hit = direct ?? (txn.paymentIntentId ? indexed.byIntent.get(txn.paymentIntentId) : undefined);
        if (!hit) continue;
        txn.invoiceId = hit.invoiceId;
        txn.subscriptionId = hit.subscriptionId;
        txn.customerId = hit.customerId;
      }
    }
    return {
      ok: true,
      payouts,
      invoiceLinks: [...indexed.byInvoice.values()].map((row) => ({
        invoiceId: row.invoiceId,
        subscriptionId: row.subscriptionId,
        customerId: row.customerId,
        paymentIntentIds: row.intents,
      })),
    };
  } catch {
    return { ok: false, capped: false };
  }
}

async function indexPaidInvoices(
  gateway: PayoutReconGateway,
  window: PayoutWindow,
  payouts: ReconPayoutInput[],
  options: { now: () => number; signal?: AbortSignal; deadline: number },
): Promise<{ ok: true; byInvoice: Map<string, IndexedInvoice>; byIntent: Map<string, IndexedInvoice> } | { ok: false; capped: boolean }> {
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
  const byInvoice = new Map<string, IndexedInvoice>();
  const remembered = rememberInvoices(byInvoice, listed.rows);
  if (!remembered.ok) return remembered;
  const referenced = chargeInvoiceIds(payouts).filter((id) => !byInvoice.has(id));
  if (referenced.length > STRIPE_READER_MAX_PAGES) return { ok: false, capped: true };
  const retrieved = await retrieveReferencedInvoices(gateway, referenced, options);
  if (!retrieved.ok) return retrieved;
  if (retrieved.rows.length !== referenced.length) return { ok: false, capped: false };
  const added = rememberInvoices(byInvoice, retrieved.rows);
  if (!added.ok) return added;
  if (byInvoice.size < remembered.count + referenced.length) return { ok: false, capped: false };
  const byIntent = new Map<string, IndexedInvoice>();
  for (const row of byInvoice.values()) {
    for (const intent of row.intents) byIntent.set(intent, row);
  }
  return { ok: true, byInvoice, byIntent };
}

function chargeInvoiceIds(payouts: ReconPayoutInput[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const payout of payouts) {
    for (const txn of payout.transactions) {
      const id = txn.invoiceId?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function retrieveReferencedInvoices(
  gateway: PayoutReconGateway,
  ids: string[],
  options: { now: () => number; signal?: AbortSignal; deadline: number },
): Promise<{ ok: true; rows: Raw[] } | { ok: false; capped: boolean }> {
  if (!ids.length) return { ok: true, rows: [] };
  if (!gateway.invoices.retrieve) return { ok: false, capped: false };
  const rows: Raw[] = [];
  for (const id of ids) {
    if (options.now() >= options.deadline) return { ok: false, capped: false };
    options.signal?.throwIfAborted();
    const row = await gateway.invoices.retrieve(id, { expand: ["payments"] }, { timeout: remaining(options.deadline, options.now) });
    if (text(row?.id) !== id) return { ok: false, capped: false };
    rows.push(row);
  }
  return rows.length === ids.length ? { ok: true, rows } : { ok: false, capped: false };
}

function rememberInvoices(byInvoice: Map<string, IndexedInvoice>, rows: Raw[]): { ok: true; count: number } | { ok: false; capped: false } {
  let count = 0;
  for (const row of rows) {
    if (row.livemode === false) continue;
    const indexed = indexInvoice(row);
    if (indexed === "bad") return { ok: false, capped: false };
    const existing = byInvoice.get(indexed.invoiceId);
    if (existing) {
      for (const intent of indexed.intents) {
        if (!existing.intents.includes(intent)) existing.intents.push(intent);
      }
      continue;
    }
    byInvoice.set(indexed.invoiceId, indexed);
    count += 1;
  }
  return { ok: true, count };
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
    invoiceId: invoiceIdFromSource(source),
    subscriptionId: null,
    customerId: null,
  };
}

function chargeId(source: unknown): string | null {
  if (typeof source === "string" && source.trim()) return source.trim();
  return text(record(source)?.id);
}

function invoiceIdFromSource(source: unknown): string | null {
  return stripeId(record(source)?.invoice);
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
