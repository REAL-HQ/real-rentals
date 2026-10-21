import { createStripeClient } from "./stripe.server";
import type { CashCharge, CashRefund } from "./weekly-cash-flow";

/**
 * List-only Stripe window for weekly cash flow.
 * charges.list and refunds.list. No retrieve, create, update, capture,
 * confirm, cancel, or refund call.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCharge = {
  id?: unknown; amount?: unknown; amount_captured?: unknown; currency?: unknown; status?: unknown;
  paid?: unknown; captured?: unknown; created?: unknown; livemode?: unknown;
};
type RawRefund = { id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; created?: unknown; livemode?: unknown };

export type CashFlowStripeGateway = {
  charges: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawCharge>> };
  refunds: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawRefund>> };
};

const PAGE = 100;
const MAX_PAGES = 100;

export async function readWeeklyCashFlow(
  gateway: CashFlowStripeGateway,
  window: { gte: number; lt: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: true; charges: CashCharge[]; refunds: CashRefund[] } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  const created = { gte: window.gte, lt: window.lt };
  try {
    const charges = await pages(gateway.charges.list, { created }, options.signal, deadline, now, mapCharge);
    const refunds = await pages(gateway.refunds.list, { created }, options.signal, deadline, now, mapRefund);
    if (!charges || !refunds) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    return { ok: true, charges, refunds };
  } catch {
    return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
  }
}

export function readLiveWeeklyCashFlow(window: { gte: number; lt: number }, signal?: AbortSignal) {
  return readWeeklyCashFlow(createStripeClient("live"), window, { signal });
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
}
function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
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

function mapCharge(row: RawCharge): CashCharge | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string") return null;
  const succeeded = row.status === "succeeded";
  if (succeeded && (row.paid !== true || row.captured !== true)) return null;
  const amount = cents(row.amount_captured ?? row.amount);
  if (succeeded && amount === null) return null;
  return { id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created, succeeded };
}
function mapRefund(row: RawRefund): CashRefund | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created)) return null;
  if (typeof row.currency !== "string" || typeof row.status !== "string" || !row.status.trim()) return null;
  const amount = cents(row.amount);
  if (amount === null) return null;
  return { id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created, status: row.status.trim().toLowerCase() };
}
