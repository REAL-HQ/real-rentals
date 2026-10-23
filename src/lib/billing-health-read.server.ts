import { STRIPE_READER_MAX_PAGES, StripeTemporarilyUnavailable, paginateStripeList, stripeReadFailureReason } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import { BILLING_PAGE_CAP, type BillingSubscription } from "./billing-health";

/**
 * Read-only Stripe subscriptions for Billing Health.
 * subscriptions.list and customers.retrieve only, cache opted in.
 * A page cap returns no partial list. No create, update, or cancel exists here.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCustomer = { id?: unknown; name?: unknown; deleted?: unknown; livemode?: unknown };
type RawSub = { id?: unknown; status?: unknown; customer?: unknown; items?: unknown; current_period_end?: unknown; livemode?: unknown };

export type BillingStripeGateway = {
  subscriptions: {
    list: (
      params: { status: "all"; limit: number; starting_after?: string; expand: ["data.customer"] },
      options?: CallOptions,
    ) => Promise<Page<RawSub>>;
  };
  customers: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCustomer>;
  };
};

const PAGE = 100;
const DEFAULT_TIMEOUT_MS = 20_000;

export type BillingStripeRead =
  | { ok: true; subscriptions: BillingSubscription[] }
  | { ok: false; capped: boolean; reason: string };

export async function readBillingSubscriptions(
  gateway: BillingStripeGateway,
  options: { timeoutMs?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<BillingStripeRead> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.subscriptions.list(
        { status: "all", limit: PAGE, expand: ["data.customer"], ...(cursor ? { starting_after: cursor } : {}) },
        { timeout: remaining(deadline, now) },
      ),
      { label: "Stripe subscriptions", maxPages: STRIPE_READER_MAX_PAGES, signal: options.signal, deadline, now, map: mapSub, strict: true },
    );
    if (!listed.ok) {
      if (listed.reason === "capped") return { ok: false, capped: true, reason: BILLING_PAGE_CAP };
      return { ok: false, capped: false, reason: "Stripe evidence was incomplete or timed out" };
    }
    const subscriptions: BillingSubscription[] = [];
    for (const sub of listed.rows) {
      if (sub.expanded) {
        subscriptions.push(sub.subscription);
        continue;
      }
      if (now() >= deadline) throw new StripeTemporarilyUnavailable();
      options.signal?.throwIfAborted();
      const raw = await gateway.customers.retrieve(sub.subscription.customerId, {}, { timeout: remaining(deadline, now) });
      const person = mapCustomer(raw);
      if (!person) return { ok: false, capped: false, reason: "Stripe evidence was incomplete or timed out" };
      subscriptions.push({ ...sub.subscription, customerName: person.name });
    }
    return { ok: true, subscriptions };
  } catch (error) {
    return { ok: false, capped: false, reason: stripeReadFailureReason(error) };
  }
}

export function readLiveBillingHealth(): Promise<BillingStripeRead> {
  return readBillingSubscriptions(createReadOnlyStripe("live", { cache: true }) as unknown as BillingStripeGateway);
}

type Mapped = { subscription: BillingSubscription; expanded: boolean; customerName: string | null | undefined };

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function live(row: { livemode?: unknown }): boolean {
  return row.livemode === undefined || row.livemode === true;
}
function mapCustomer(row: RawCustomer): { id: string; name: string | null } | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  if (row.deleted === true) return { id: row.id, name: null };
  return { id: row.id, name: text(row.name) };
}
function mapSub(row: RawSub): Mapped | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.status !== "string" || !row.status) return null;
  const customer = row.customer;
  let customerId: string | null = null;
  let expanded = false;
  let customerName: string | null | undefined;
  if (typeof customer === "string" && customer) {
    customerId = customer;
    customerName = undefined;
  } else if (customer && typeof customer === "object") {
    const person = mapCustomer(customer as RawCustomer);
    if (!person) return null;
    customerId = person.id;
    expanded = true;
    customerName = person.name;
  }
  if (!customerId) return null;
  return {
    expanded,
    customerName,
    subscription: {
      id: row.id,
      status: row.status,
      customerId,
      customerName: customerName ?? null,
      periodEnd: periodEnd(row),
      weeklyAmountCents: weeklyCents(row.items),
    },
  };
}
function periodEnd(row: RawSub): number | null {
  const fromItems = itemPeriodEnd(row.items);
  const top = typeof row.current_period_end === "number" && Number.isSafeInteger(row.current_period_end) ? row.current_period_end : null;
  if (fromItems !== null && top !== null && fromItems !== top) return null;
  return fromItems ?? top;
}
function itemPeriodEnd(items: unknown): number | null {
  const data = itemRows(items);
  if (!data || data.length === 0) return null;
  const ends = data.map((item) => {
    const value = (item as { current_period_end?: unknown }).current_period_end;
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  });
  if (ends.some((end) => end === null) || new Set(ends).size !== 1) return null;
  return ends[0] ?? null;
}
function weeklyCents(items: unknown): number | null {
  const data = itemRows(items);
  if (!data || data.length === 0) return null;
  let total = 0;
  for (const item of data) {
    if (!item || typeof item !== "object") return null;
    const price = (item as { price?: unknown }).price;
    const quantity = (item as { quantity?: unknown }).quantity ?? 1;
    if (!price || typeof price !== "object") return null;
    const unit = (price as { unit_amount?: unknown }).unit_amount;
    const currency = (price as { currency?: unknown }).currency;
    const recurring = (price as { recurring?: unknown }).recurring;
    if (typeof unit !== "number" || !Number.isSafeInteger(unit) || unit < 0) return null;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    if (typeof currency !== "string" || currency.toLowerCase() !== "usd") return null;
    if (!recurring || typeof recurring !== "object") return null;
    const interval = (recurring as { interval?: unknown }).interval;
    const count = (recurring as { interval_count?: unknown }).interval_count ?? 1;
    if (interval !== "week" || count !== 1) return null;
    const next = total + unit * quantity;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}
function itemRows(items: unknown): unknown[] | null {
  if (!items || typeof items !== "object") return null;
  const bag = items as { has_more?: unknown; data?: unknown };
  if (bag.has_more !== false || !Array.isArray(bag.data)) return null;
  return bag.data;
}
