import { STRIPE_READER_MAX_PAGES, STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import { stripeFeeCostCents, type OwnerFeeRead, type OwnerFeeTxn } from "./owner-pnl-fees";

/**
 * Read-only Stripe fees for one Eastern Time month.
 * balanceTransactions.list is the only call, filtered by created gte/lt.
 * The client is createReadOnlyStripe with the 60 second cache on.
 * No new Stripe capability, and stripe-reader.server.ts is unchanged.
 * A failed, truncated, or malformed read is { ok: false }.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawBalance = {
  id?: unknown;
  amount?: unknown;
  fee?: unknown;
  net?: unknown;
  currency?: unknown;
  created?: unknown;
  type?: unknown;
  livemode?: unknown;
};

export type OwnerFeeStripeGateway = {
  balanceTransactions: {
    list: (
      params: { created: { gte: number; lt: number }; limit: number; starting_after?: string },
      options?: CallOptions,
    ) => Promise<Page<RawBalance>>;
  };
};

const DEFAULT_TIMEOUT_MS = 20_000;

export async function readOwnerPnlFees(
  gateway: OwnerFeeStripeGateway,
  window: { gte: number; lt: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<OwnerFeeRead> {
  if (!Number.isSafeInteger(window.gte) || !Number.isSafeInteger(window.lt) || window.lt <= window.gte) return { ok: false };
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.balanceTransactions.list(
        { created: { gte: window.gte, lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) },
        { timeout: remaining(deadline, now) },
      ),
      { label: "owner P&L balance transactions", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, strict: true },
    );
    if (!listed.ok) return { ok: false };
    const txns: OwnerFeeTxn[] = [];
    for (const row of listed.rows) {
      const mapped = mapBalance(row);
      if (mapped === "skip") continue;
      if (mapped === "bad") return { ok: false };
      txns.push(mapped);
    }
    return stripeFeeCostCents(txns, window);
  } catch {
    return { ok: false };
  }
}

export function readLiveOwnerPnlFees(window: { gte: number; lt: number }, signal?: AbortSignal) {
  return readOwnerPnlFees(createReadOnlyStripe("live", { cache: true }) as unknown as OwnerFeeStripeGateway, window, { signal });
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function mapBalance(row: RawBalance): OwnerFeeTxn | "skip" | "bad" {
  if (row.livemode === false) return "skip";
  if (typeof row.id !== "string" || !row.id || typeof row.type !== "string" || !row.type) return "bad";
  if (typeof row.currency !== "string" || !row.currency) return "bad";
  if (!integer(row.amount) || !integer(row.fee) || !integer(row.net) || !integer(row.created)) return "bad";
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    fee: row.fee,
    net: row.net,
    currency: row.currency.toLowerCase(),
    created: row.created,
  };
}
