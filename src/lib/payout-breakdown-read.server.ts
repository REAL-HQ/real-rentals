import { STRIPE_READER_MAX_PAGES, STRIPE_READER_PAGE_SIZE, paginateStripeList, stripeReadFailureReason } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { PayoutInput, PayoutTxn } from "./payout-breakdown";

/**
 * Read-only payout window. payouts.list, balanceTransactions.list, and
 * charges.retrieve / customers.retrieve for a charge the list did not expand.
 * The client is createReadOnlyStripe with the 60 second cache on.
 * No create, update, refund, capture, or config call exists in this module.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawPayout = { id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; created?: unknown; arrival_date?: unknown; livemode?: unknown };
type RawBalance = { id?: unknown; amount?: unknown; fee?: unknown; net?: unknown; currency?: unknown; created?: unknown; type?: unknown; source?: unknown; livemode?: unknown };
type RawCharge = { id?: unknown; customer?: unknown; livemode?: unknown };
type RawCustomer = { id?: unknown; name?: unknown; email?: unknown; phone?: unknown; deleted?: unknown; livemode?: unknown };

export type PayoutStripeGateway = {
  payouts: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawPayout>> };
  balanceTransactions: { list: (params: { payout: string; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawBalance>> };
  charges: { retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge> };
  customers: { retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCustomer> };
};

export type PayoutCustomer = { id: string; name: string | null; email: string | null; phone: string | null };
export type PayoutRead =
  | { ok: true; payouts: PayoutInput[]; customers: PayoutCustomer[]; capped: false }
  | { ok: false; reason: string; capped: boolean };

const CHARGE_TYPES = new Set(["charge", "payment"]);
const DEFAULT_TIMEOUT_MS = 20_000;

export async function readPayoutBreakdown(
  gateway: PayoutStripeGateway,
  window: { gte: number; lt: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<PayoutRead> {
  if (!Number.isSafeInteger(window.gte) || !Number.isSafeInteger(window.lt) || window.lt <= window.gte) return { ok: false, reason: "Stripe period is invalid", capped: false };
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.payouts.list({ created: { gte: window.gte, lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) }, { timeout: remaining(deadline, now) }),
      { label: "payouts", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, map: mapPayout, strict: true },
    );
    if (!listed.ok) return { ok: false, reason: listed.reason === "capped" ? "Stripe reader page cap reached" : "Stripe evidence was incomplete or timed out", capped: listed.reason === "capped" };
    const payouts: PayoutInput[] = [];
    for (const payout of listed.rows) {
      if (now() >= deadline) return { ok: false, reason: stripeReadFailureReason(new Error("timeout")), capped: false };
      const balances = await paginateStripeList(
        (cursor) => gateway.balanceTransactions.list({ payout: payout.id, limit: STRIPE_READER_PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) }, { timeout: remaining(deadline, now) }),
        { label: `payout ${payout.id} balance transactions`, maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, map: mapBalance, strict: true },
      );
      payouts.push({
        ...payout,
        transactions: balances.ok ? balances.rows : null,
        transactionsCapped: !balances.ok && balances.reason === "capped",
      });
    }
    const customers = await loadCustomers(gateway, payouts, options.signal, deadline, now);
    return { ok: true, payouts, customers, capped: false };
  } catch (error) {
    return { ok: false, reason: stripeReadFailureReason(error), capped: false };
  }
}

export function readLivePayoutBreakdown(window: { gte: number; lt: number }, signal?: AbortSignal) {
  return readPayoutBreakdown(createReadOnlyStripe("live", { cache: true }) as unknown as PayoutStripeGateway, window, { signal });
}

async function loadCustomers(gateway: PayoutStripeGateway, payouts: PayoutInput[], signal: AbortSignal | undefined, deadline: number, now: () => number): Promise<PayoutCustomer[]> {
  const chargeIds = new Set<string>();
  for (const payout of payouts) {
    for (const txn of payout.transactions ?? []) {
      if (CHARGE_TYPES.has(txn.type) && txn.sourceId) chargeIds.add(txn.sourceId);
    }
  }
  const profiles = new Map<string, PayoutCustomer>();
  for (const chargeId of chargeIds) {
    if (now() >= deadline) break;
    signal?.throwIfAborted();
    let charge: RawCharge;
    try {
      charge = await gateway.charges.retrieve(chargeId, {}, { timeout: remaining(deadline, now) });
    } catch {
      continue;
    }
    const customer = customerRef(charge);
    if (!customer) continue;
    const txn = findTxn(payouts, chargeId);
    if (txn) txn.customerId = customer.id;
    if (customer.profile) { profiles.set(customer.id, customer.profile); continue; }
    if (profiles.has(customer.id) || now() >= deadline) continue;
    try {
      const raw = await gateway.customers.retrieve(customer.id, {}, { timeout: remaining(deadline, now) });
      const person = mapCustomer(raw);
      if (person) profiles.set(person.id, person);
    } catch {
      profiles.set(customer.id, { id: customer.id, name: null, email: null, phone: null });
    }
  }
  return [...profiles.values()];
}

function findTxn(payouts: PayoutInput[], chargeId: string): PayoutTxn | undefined {
  for (const payout of payouts) {
    const txn = payout.transactions?.find((row) => row.sourceId === chargeId && CHARGE_TYPES.has(row.type));
    if (txn) return txn;
  }
  return undefined;
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function live(row: { livemode?: unknown }): boolean {
  return row.livemode === undefined || row.livemode === true;
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
}

function mapPayout(row: RawPayout): Omit<PayoutInput, "transactions" | "transactionsCapped"> | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || !integer(row.amount) || !integer(row.created) || !integer(row.arrival_date)) return null;
  if (typeof row.status !== "string" || !row.status || typeof row.currency !== "string") return null;
  return { id: row.id, amount: row.amount, currency: row.currency.toLowerCase(), status: row.status, created: row.created, arrival: row.arrival_date };
}

function mapBalance(row: RawBalance): PayoutTxn | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || !integer(row.amount) || !integer(row.fee) || !integer(row.net) || !integer(row.created)) return null;
  if (typeof row.type !== "string" || !row.type || typeof row.currency !== "string") return null;
  return { id: row.id, type: row.type, amount: row.amount, fee: row.fee, net: row.net, currency: row.currency.toLowerCase(), sourceId: idOf(row.source), customerId: null };
}

function mapCustomer(row: RawCustomer): PayoutCustomer | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  if (row.deleted === true) return { id: row.id, name: null, email: null, phone: null };
  return { id: row.id, name: text(row.name), email: text(row.email), phone: text(row.phone) };
}

function customerRef(charge: RawCharge): { id: string; profile: PayoutCustomer | null } | null {
  if (!live(charge)) return null;
  const customer = charge.customer;
  if (typeof customer === "string" && customer) return { id: customer, profile: null };
  if (customer && typeof customer === "object") {
    const person = mapCustomer(customer as RawCustomer);
    return person ? { id: person.id, profile: person } : null;
  }
  return null;
}
