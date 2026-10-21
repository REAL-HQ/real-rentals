import { STRIPE_READER_MAX_PAGES, StripeTemporarilyUnavailable, paginateStripeList, stripeReadFailureReason } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { WatchCustomer, WatchFailedCharge, WatchOpenInvoice, WatchSubscription } from "./collections-watch";

/**
 * Read-only Stripe window for Collections Watch.
 * subscriptions.list, charges.list, invoices.list, and retrieve for a customer,
 * invoice, or charge that a list did not expand. No create, update, capture,
 * confirm, cancel, or refund. Upcoming invoice preview is not a list or retrieve,
 * so it is not called.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCustomer = { id?: unknown; name?: unknown; email?: unknown; phone?: unknown; deleted?: unknown; livemode?: unknown };
type RawCharge = {
  id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; created?: unknown; customer?: unknown;
  failure_message?: unknown; failure_code?: unknown; outcome?: unknown; livemode?: unknown;
};
type RawInvoice = {
  id?: unknown; customer?: unknown; amount_remaining?: unknown; currency?: unknown; due_date?: unknown; created?: unknown;
  status_transitions?: unknown; charge?: unknown; subscription?: unknown; parent?: unknown; livemode?: unknown;
};
type RawSub = { id?: unknown; status?: unknown; customer?: unknown; items?: unknown; latest_invoice?: unknown; livemode?: unknown };

export type ReadOnlyStripeGateway = {
  subscriptions: { list: (params: { status: "past_due" | "unpaid" | "active"; limit: number; starting_after?: string; expand: ["data.customer", "data.latest_invoice"] }, options?: CallOptions) => Promise<Page<RawSub>> };
  charges: {
    list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string; expand: ["data.customer"] }, options?: CallOptions) => Promise<Page<RawCharge>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
  invoices: {
    list: (params: { status: "open"; due_date: { gte: number; lt: number }; limit: number; starting_after?: string; expand: ["data.customer"] }, options?: CallOptions) => Promise<Page<RawInvoice>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawInvoice>;
  };
  customers: { retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCustomer> };
};

const PAGE = 100;

export async function readCollectionsWatch(
  gateway: ReadOnlyStripeGateway,
  window: { failedGte: number; dueGte: number; dueLt: number; now: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: true; subscriptions: WatchSubscription[]; failedCharges: WatchFailedCharge[]; openInvoices: WatchOpenInvoice[] } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  const created = { gte: window.failedGte, lt: window.now };
  const due = { gte: window.dueGte, lt: window.dueLt };
  try {
    const pastDue = await pages(gateway.subscriptions.list, { status: "past_due" as const, expand: ["data.customer", "data.latest_invoice"] as ["data.customer", "data.latest_invoice"] }, options.signal, deadline, now, mapSub);
    const unpaid = await pages(gateway.subscriptions.list, { status: "unpaid" as const, expand: ["data.customer", "data.latest_invoice"] as ["data.customer", "data.latest_invoice"] }, options.signal, deadline, now, mapSub);
    const active = await pages(gateway.subscriptions.list, { status: "active" as const, expand: ["data.customer", "data.latest_invoice"] as ["data.customer", "data.latest_invoice"] }, options.signal, deadline, now, mapSub);
    const charges = await pages(gateway.charges.list, { created, expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, mapCharge);
    const invoices = await pages(gateway.invoices.list, { status: "open" as const, due_date: due, expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, (row) => mapInvoice(row, true));
    if (!pastDue || !unpaid || !active || !charges || !invoices) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    const subscriptions = [...pastDue, ...unpaid, ...active];
    const people = new Map<string, WatchCustomer>();
    const remember = (customer: WatchCustomer | null) => { if (customer) people.set(customer.id, customer); };
    for (const sub of subscriptions) remember(sub.customer);
    for (const charge of charges) remember(charge.customer);
    for (const invoice of invoices) remember(invoice.customer);
    const hydrate = async (customer: WatchCustomer | string | null): Promise<WatchCustomer | null> => {
      if (!customer) return null;
      if (typeof customer !== "string") return customer;
      const cached = people.get(customer);
      if (cached) return cached;
      if (now() >= deadline) throw new StripeTemporarilyUnavailable();
      options.signal?.throwIfAborted();
      const loaded = mapCustomer(await gateway.customers.retrieve(customer, {}, { timeout: remaining(deadline, now) }));
      if (!loaded) return null;
      people.set(loaded.id, loaded);
      return loaded;
    };
    for (const sub of subscriptions) {
      if (!sub.customer) {
        const loaded = await hydrate(sub.customerId);
        if (!loaded) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
        sub.customer = loaded;
      }
      if (sub.invoiceId && !sub.invoiceLoaded) {
        if (now() >= deadline) throw new StripeTemporarilyUnavailable();
        options.signal?.throwIfAborted();
        const invoice = mapInvoice(await gateway.invoices.retrieve(sub.invoiceId, {}, { timeout: remaining(deadline, now) }), false);
        if (!invoice) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
        sub.amountRemainingCents = invoice.amountRemainingCents;
        sub.currency = invoice.currency;
        sub.dueAt = invoice.dueAt;
        sub.chargeId = invoice.chargeId ?? sub.chargeId;
      }
    }
    const failed = charges.filter((charge) => charge.failed);
    for (const charge of failed) {
      if (charge.customer) continue;
      if (!charge.customerId) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      const loaded = await hydrate(charge.customerId);
      if (!loaded) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      charge.customer = loaded;
    }
    const latestFailed = new Map<string, MappedCharge>();
    for (const charge of failed) {
      if (!charge.customer) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      const prior = latestFailed.get(charge.customer.id);
      if (!prior || charge.created > prior.created) latestFailed.set(charge.customer.id, charge);
    }
    for (const sub of subscriptions) {
      if (sub.status === "active" || !sub.customer) continue;
      const known = latestFailed.get(sub.customer.id);
      if (known) { sub.failureReason = known.failureReason; sub.failureAt = known.created; continue; }
      if (!sub.chargeId) continue;
      if (now() >= deadline) throw new StripeTemporarilyUnavailable();
      options.signal?.throwIfAborted();
      const charge = mapCharge(await gateway.charges.retrieve(sub.chargeId, {}, { timeout: remaining(deadline, now) }));
      if (!charge) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      if (charge.failed) { sub.failureReason = charge.failureReason; sub.failureAt = charge.created; }
    }
    const openInvoices: WatchOpenInvoice[] = [];
    for (const invoice of invoices) {
      const customer = invoice.customer ?? await hydrate(invoice.customerId);
      if (!customer || invoice.dueAt === null || !invoice.currency) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      openInvoices.push({ id: invoice.id, customer, subscriptionId: invoice.subscriptionId, amountRemainingCents: invoice.amountRemainingCents, currency: invoice.currency, dueAt: invoice.dueAt });
    }
    return {
      ok: true,
      subscriptions: subscriptions.filter((sub): sub is MappedSub & { customer: WatchCustomer } => !!sub.customer).map((sub) => ({
        id: sub.id, status: sub.status, customer: sub.customer, periodEnd: sub.periodEnd, priceCents: sub.priceCents,
        amountRemainingCents: sub.amountRemainingCents, currency: sub.currency, dueAt: sub.dueAt, failureReason: sub.failureReason, failureAt: sub.failureAt,
      })),
      failedCharges: failed.flatMap((charge) => charge.customer ? [{ id: charge.id, customer: charge.customer, amountCents: charge.amountCents, currency: charge.currency, created: charge.created, failureReason: charge.failureReason }] : []),
      openInvoices,
    };
  } catch (error) {
    return { ok: false, reason: stripeReadFailureReason(error) };
  }
}

export function readLiveCollectionsWatch(window: { failedGte: number; dueGte: number; dueLt: number; now: number }, signal?: AbortSignal) {
  return readCollectionsWatch(createReadOnlyStripe("live"), window, { signal });
}

type MappedSub = {
  id: string; status: "past_due" | "unpaid" | "active"; customer: WatchCustomer | null; customerId: string | null;
  periodEnd: number | null; priceCents: number | null; amountRemainingCents: number | null; currency: string | null;
  dueAt: number | null; failureReason: string | null; failureAt: number | null; invoiceId: string | null; invoiceLoaded: boolean; chargeId: string | null;
};
type MappedCharge = { id: string; customer: WatchCustomer | null; customerId: string | null; amountCents: number | null; currency: string; created: number; failed: boolean; failureReason: string | null };
type MappedInvoice = { id: string; customer: WatchCustomer | null; customerId: string | null; subscriptionId: string | null; amountRemainingCents: number | null; currency: string | null; dueAt: number | null; chargeId: string | null };

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
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

function mapCustomer(row: RawCustomer): WatchCustomer | null {
  if (!live(row)) return null;
  if (row.deleted === true) return typeof row.id === "string" && row.id ? { id: row.id, name: null, email: null, phone: null } : null;
  if (typeof row.id !== "string" || !row.id) return null;
  return { id: row.id, name: text(row.name), email: text(row.email), phone: text(row.phone) };
}
function failureOf(row: RawCharge): string | null {
  const outcome = row.outcome && typeof row.outcome === "object" ? text((row.outcome as { seller_message?: unknown; reason?: unknown }).seller_message) ?? text((row.outcome as { reason?: unknown }).reason) : null;
  return text(row.failure_message) ?? text(row.failure_code) ?? outcome;
}
function mapCharge(row: RawCharge): MappedCharge | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string") return null;
  let customer: WatchCustomer | null = null;
  if (row.customer && typeof row.customer === "object") {
    customer = mapCustomer(row.customer as RawCustomer);
    if (!customer) return null;
  }
  return { id: row.id, customer, customerId: idOf(row.customer), amountCents: cents(row.amount), currency: row.currency.toLowerCase(), created: row.created, failed: row.status === "failed", failureReason: failureOf(row) };
}
function subscriptionOf(row: RawInvoice): string | null {
  const parent = row.parent && typeof row.parent === "object" ? (row.parent as { subscription_details?: unknown }).subscription_details : null;
  const nested = parent && typeof parent === "object" ? idOf((parent as { subscription?: unknown }).subscription) : null;
  return nested ?? idOf(row.subscription);
}
function mapInvoice(row: RawInvoice, requireDue: boolean): MappedInvoice | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  if (requireDue && typeof row.currency !== "string") return null;
  const transitions = row.status_transitions && typeof row.status_transitions === "object" ? (row.status_transitions as { finalized_at?: unknown }).finalized_at : null;
  const dueAt = cents(row.due_date) ?? cents(transitions) ?? cents(row.created);
  if (requireDue && (dueAt === null || dueAt <= 0)) return null;
  let customer: WatchCustomer | null = null;
  if (row.customer && typeof row.customer === "object") {
    customer = mapCustomer(row.customer as RawCustomer);
    if (!customer) return null;
  }
  return {
    id: row.id, customer, customerId: idOf(row.customer), subscriptionId: subscriptionOf(row),
    amountRemainingCents: cents(row.amount_remaining), currency: typeof row.currency === "string" ? row.currency.toLowerCase() : null,
    dueAt: dueAt !== null && dueAt > 0 ? dueAt : null, chargeId: idOf(row.charge),
  };
}
function mapSub(row: RawSub): MappedSub | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  if (row.status !== "past_due" && row.status !== "unpaid" && row.status !== "active") return null;
  let customer: WatchCustomer | null = null;
  if (row.customer && typeof row.customer === "object") {
    customer = mapCustomer(row.customer as RawCustomer);
    if (!customer) return null;
  }
  let invoice: MappedInvoice | null = null;
  if (row.latest_invoice && typeof row.latest_invoice === "object") {
    invoice = mapInvoice(row.latest_invoice as RawInvoice, false);
    if (!invoice) return null;
  }
  return {
    id: row.id, status: row.status, customer, customerId: idOf(row.customer), periodEnd: periodEnd(row.items), priceCents: priceCents(row.items),
    amountRemainingCents: invoice?.amountRemainingCents ?? null, currency: invoice?.currency ?? null, dueAt: invoice?.dueAt ?? null,
    failureReason: null, failureAt: null, invoiceId: invoice?.id ?? (typeof row.latest_invoice === "string" ? row.latest_invoice : null),
    invoiceLoaded: !!invoice, chargeId: invoice?.chargeId ?? null,
  };
}
function periodEnd(items: unknown): number | null {
  const data = itemRows(items);
  if (!data) return null;
  const ends = data.map((item) => cents((item as { current_period_end?: unknown }).current_period_end));
  if (ends.some((end) => end === null) || new Set(ends).size !== 1) return null;
  return ends[0] ?? null;
}
function priceCents(items: unknown): number | null {
  const data = itemRows(items);
  if (!data || data.length === 0) return null;
  let total = 0;
  for (const item of data) {
    const price = (item as { price?: unknown }).price;
    const quantity = (item as { quantity?: unknown }).quantity ?? 1;
    if (!price || typeof price !== "object") return null;
    const unit = cents((price as { unit_amount?: unknown }).unit_amount);
    const currency = (price as { currency?: unknown }).currency;
    if (unit === null || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return null;
    if (typeof currency !== "string" || currency.toLowerCase() !== "usd") return null;
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
