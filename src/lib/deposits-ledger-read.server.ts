import { STRIPE_READER_MAX_PAGES, paginateStripeList, stripeReadFailureReason } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { LedgerCharge, LedgerCustomer, LedgerRefund } from "./deposits-ledger";

/**
 * List-only Stripe window. refunds.list expands the original charge and its
 * customer. charges.list supplies gross collected. No retrieve, create, update,
 * capture, confirm, cancel, or refund call.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCustomer = { id?: unknown; email?: unknown; phone?: unknown; deleted?: unknown; livemode?: unknown };
type RawCharge = {
  id?: unknown; amount?: unknown; amount_captured?: unknown; currency?: unknown; status?: unknown;
  paid?: unknown; captured?: unknown; created?: unknown; customer?: unknown; livemode?: unknown;
};
type RawRefund = {
  id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; reason?: unknown;
  created?: unknown; charge?: unknown; livemode?: unknown;
};

export type ListOnlyStripeGateway = {
  refunds: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string; expand: ["data.charge.customer"] }, options?: CallOptions) => Promise<Page<RawRefund>> };
  charges: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawCharge>> };
};

const PAGE = 100;

export async function readDepositsLedger(
  gateway: ListOnlyStripeGateway,
  window: { gte: number; lt: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: true; charges: LedgerCharge[]; refunds: LedgerRefund[] } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  const created = { gte: window.gte, lt: window.lt };
  try {
    const refunds = await pages(gateway.refunds.list, { created, expand: ["data.charge.customer"] as ["data.charge.customer"] }, options.signal, deadline, now, mapRefund);
    const charges = await pages(gateway.charges.list, { created }, options.signal, deadline, now, mapCharge);
    if (!refunds || !charges) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    return { ok: true, charges, refunds };
  } catch (error) {
    return { ok: false, reason: stripeReadFailureReason(error) };
  }
}

export function readLiveDepositsLedger(window: { gte: number; lt: number }, signal?: AbortSignal) {
  return readDepositsLedger(createReadOnlyStripe("live", { cache: true }), window, { signal });
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
  const result = await paginateStripeList(
    (cursor) => list({ ...filter, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) }, { timeout: remaining(deadline, now) }),
    { label: `Stripe list ${Object.keys(filter).sort().join(",") || "page"}`, maxPages: STRIPE_READER_MAX_PAGES, signal, deadline, now, map, strict: true },
  );
  return result.ok ? result.rows : null;
}

function mapCustomer(row: RawCustomer): LedgerCustomer | null {
  if (!live(row)) return null;
  if (row.deleted === true) return typeof row.id === "string" && row.id ? { id: row.id, email: null, phone: null } : null;
  if (typeof row.id !== "string" || !row.id) return null;
  return { id: row.id, email: text(row.email), phone: text(row.phone) };
}
function mapCharge(row: RawCharge): LedgerCharge | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string") return null;
  const succeeded = row.status === "succeeded";
  if (succeeded && (row.paid !== true || row.captured !== true)) return null;
  const amount = cents(row.amount_captured ?? row.amount);
  if (succeeded && amount === null) return null;
  return { id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created, succeeded };
}
function mapRefund(row: RawRefund): LedgerRefund | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created)) return null;
  if (typeof row.currency !== "string" || typeof row.status !== "string" || !row.status.trim()) return null;
  const amount = cents(row.amount);
  if (amount === null || !row.charge || typeof row.charge !== "object") return null;
  const charge = row.charge as RawCharge;
  if (!live(charge) || typeof charge.created !== "number" || !Number.isSafeInteger(charge.created)) return null;
  let customer: LedgerCustomer | null = null;
  if (typeof charge.customer === "string") customer = { id: charge.customer, email: null, phone: null };
  else if (charge.customer && typeof charge.customer === "object") {
    customer = mapCustomer(charge.customer as RawCustomer);
    if (!customer) return null;
  }
  return {
    id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), status: row.status.trim().toLowerCase(),
    reason: text(row.reason), created: row.created, chargeCreated: charge.created, customer,
  };
}
