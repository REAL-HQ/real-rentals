import { STRIPE_READER_MAX_PAGES, STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { DepositStripeRefund } from "./deposits-refunds-ledger";

/**
 * Read-only Stripe refunds for the deposits ledger.
 * refunds.list is the only call. The client is createReadOnlyStripe.
 * No create, update, refund, or charge call exists in this module.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawRefund = {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  charge?: unknown;
  payment_intent?: unknown;
  livemode?: unknown;
};

export type DepositStripeGateway = {
  refunds: {
    list: (params: { limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawRefund>>;
  };
};

export async function readDepositRefunds(
  gateway: DepositStripeGateway,
  options: { signal?: AbortSignal } = {},
): Promise<{ ok: true; refunds: DepositStripeRefund[] } | { ok: false }> {
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.refunds.list({ limit: STRIPE_READER_PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) }),
      { label: "deposit refunds", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, strict: true },
    );
    if (!listed.ok) return { ok: false };
    const refunds: DepositStripeRefund[] = [];
    for (const row of listed.rows) {
      const mapped = mapRefund(row);
      if (mapped === "skip") continue;
      if (mapped === "bad") return { ok: false };
      refunds.push(mapped);
    }
    return { ok: true, refunds };
  } catch {
    return { ok: false };
  }
}

export function readLiveDepositRefunds(signal?: AbortSignal) {
  return readDepositRefunds(createReadOnlyStripe("live", { cache: true }) as unknown as DepositStripeGateway, { signal });
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
}

function mapRefund(row: RawRefund): DepositStripeRefund | "skip" | "bad" {
  if (row.livemode === false) return "skip";
  if (typeof row.id !== "string" || !row.id || !integer(row.amount) || row.amount < 0) return "bad";
  if (typeof row.currency !== "string" || !row.currency || typeof row.status !== "string" || !row.status) return "bad";
  return {
    id: row.id,
    amountCents: row.amount,
    currency: row.currency.toLowerCase(),
    status: row.status,
    chargeId: idOf(row.charge),
    paymentIntentId: idOf(row.payment_intent),
  };
}
