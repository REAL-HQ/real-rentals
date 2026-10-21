import type { VerifiedBalance, VerifiedCharge, VerifiedPayout } from "./unified-finance-verified";

/**
 * Read-only Stripe window. Lists balance transactions, payouts, and charges.
 * Retrieve loads a charge referenced by an in-period refund, and that charge's
 * balance transaction when the fee was created outside the listed window.
 * No create, update, refund, capture, or config call exists in this module.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCharge = {
  id?: unknown; amount?: unknown; amount_captured?: unknown; currency?: unknown; status?: unknown;
  paid?: unknown; captured?: unknown; created?: unknown; payment_intent?: unknown; balance_transaction?: unknown; livemode?: unknown;
};
type RawBalance = {
  id?: unknown; amount?: unknown; fee?: unknown; net?: unknown; currency?: unknown; created?: unknown;
  type?: unknown; source?: unknown; livemode?: unknown;
};
type RawPayout = { id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; arrival_date?: unknown; livemode?: unknown };

export type ReadOnlyStripeGateway = {
  balanceTransactions: {
    list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawBalance>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawBalance>;
  };
  payouts: { list: (params: { arrival_date: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawPayout>> };
  charges: {
    list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawCharge>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
};

const PAGE = 100;
const MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 20_000;

export async function readStripeFinanceWindow(
  gateway: ReadOnlyStripeGateway,
  period: { from: string; to: string },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number; retrieveChargeIds?: string[] } = {},
): Promise<{ ok: true; charges: VerifiedCharge[]; balances: VerifiedBalance[]; payouts: VerifiedPayout[] } | { ok: false; reason: string }> {
  const gte = unixDay(period.from);
  const lt = unixDay(period.to);
  if (gte === null || lt === null || lt <= gte) return { ok: false, reason: "Stripe period is invalid" };
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const window = { gte, lt };
  try {
    const balances = await pages(gateway.balanceTransactions.list, { created: window }, options.signal, deadline, now, mapBalance);
    const payouts = await pages(gateway.payouts.list, { arrival_date: window }, options.signal, deadline, now, mapPayout);
    const charges = await pages(gateway.charges.list, { created: window }, options.signal, deadline, now, mapCharge);
    if (!balances || !payouts || !charges) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    const have = new Set(charges.map((charge) => charge.id));
    for (const id of options.retrieveChargeIds ?? []) {
      if (!id || have.has(id)) continue;
      if (now() >= deadline) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      options.signal?.throwIfAborted();
      const raw = await gateway.charges.retrieve(id, {}, { timeout: remaining(deadline, now) });
      const charge = mapCharge(raw);
      if (!charge) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      charges.push(charge);
      have.add(charge.id);
    }
    const haveBalances = new Set(balances.map((balance) => balance.id));
    for (const charge of charges) {
      const balanceId = charge.balanceTransactionId;
      if (!balanceId || haveBalances.has(balanceId)) continue;
      if (now() >= deadline) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      options.signal?.throwIfAborted();
      const raw = await gateway.balanceTransactions.retrieve(balanceId, {}, { timeout: remaining(deadline, now) });
      const balance = mapBalance(raw);
      if (!balance) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      balances.push(balance);
      haveBalances.add(balance.id);
    }
    return { ok: true, charges, balances, payouts };
  } catch {
    return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
  }
}

function unixDay(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}
function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
}
function cents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function live(row: { livemode?: unknown }): boolean {
  return row.livemode === undefined || row.livemode === true;
}

async function pages<T, R, P extends Record<string, unknown>>(
  list: (params: P & { limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<T>>,
  filter: P,
  signal: AbortSignal | undefined,
  deadline: number,
  now: () => number,
  map: (row: T) => R | null,
): Promise<R[] | null> {
  const rows: R[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (now() >= deadline) return null;
    signal?.throwIfAborted();
    const result = await list({ ...filter, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) }, { timeout: remaining(deadline, now) });
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") return null;
    for (const row of result.data) {
      const mapped = map(row);
      if (!mapped) return null;
      rows.push(mapped);
    }
    if (!result.has_more) return rows;
    const next = idOf((result.data.at(-1) as { id?: unknown } | undefined)?.id);
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return null;
}

function mapCharge(row: RawCharge): VerifiedCharge | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || !cents(row.created) || typeof row.currency !== "string") return null;
  const captured = cents(row.amount_captured) ? row.amount_captured : cents(row.amount) ? row.amount : null;
  if (captured === null) return null;
  return {
    id: row.id, paymentIntentId: idOf(row.payment_intent), balanceTransactionId: idOf(row.balance_transaction),
    amountCents: captured, currency: row.currency.toLowerCase(),
    succeeded: row.paid === true && row.captured === true && row.status === "succeeded" && captured > 0, created: row.created,
  };
}
function mapBalance(row: RawBalance): VerifiedBalance | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || !cents(row.amount) || !cents(row.fee) || !cents(row.net) || !cents(row.created) || typeof row.type !== "string" || typeof row.currency !== "string") return null;
  return { id: row.id, type: row.type, amount: row.amount, fee: row.fee, net: row.net, currency: row.currency.toLowerCase(), created: row.created, sourceId: idOf(row.source) };
}
function mapPayout(row: RawPayout): VerifiedPayout | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || !cents(row.amount) || !cents(row.arrival_date) || typeof row.status !== "string" || typeof row.currency !== "string") return null;
  return { id: row.id, amount: row.amount, currency: row.currency.toLowerCase(), status: row.status, arrival: row.arrival_date };
}
