import { STRIPE_READER_MAX_PAGES, StripeTemporarilyUnavailable, paginateStripeList, stripeReadFailureReason } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { StatementCharge, StatementCustomer, StatementInvoice, StatementRefund } from "./driver-statement";

/**
 * List/retrieve-only Stripe read for one driver statement.
 * charges.list, refunds.list, and invoices.list expand the customer.
 * customers.retrieve and charges.retrieve run only when a list left an id.
 * No create, update, capture, confirm, cancel, or refund call.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCustomer = { id?: unknown; email?: unknown; phone?: unknown; deleted?: unknown; livemode?: unknown };
type RawCharge = {
  id?: unknown; amount?: unknown; amount_captured?: unknown; currency?: unknown; status?: unknown;
  paid?: unknown; captured?: unknown; created?: unknown; description?: unknown; customer?: unknown; livemode?: unknown;
};
type RawRefund = {
  id?: unknown; amount?: unknown; currency?: unknown; status?: unknown; reason?: unknown;
  created?: unknown; charge?: unknown; livemode?: unknown;
};
type RawInvoice = {
  id?: unknown; amount_due?: unknown; amount_paid?: unknown; amount_remaining?: unknown; currency?: unknown;
  status?: unknown; created?: unknown; description?: unknown; number?: unknown; customer?: unknown;
  subscription?: unknown; parent?: unknown; livemode?: unknown;
};

export type StatementStripeGateway = {
  charges: {
    list: (params: { limit: number; starting_after?: string; expand: ["data.customer"] }, options?: CallOptions) => Promise<Page<RawCharge>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
  refunds: { list: (params: { limit: number; starting_after?: string; expand: ["data.charge.customer"] }, options?: CallOptions) => Promise<Page<RawRefund>> };
  invoices: { list: (params: { limit: number; starting_after?: string; expand: ["data.customer"] }, options?: CallOptions) => Promise<Page<RawInvoice>> };
  customers: { retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCustomer> };
};

const PAGE = 100;

export async function readDriverStatement(
  gateway: StatementStripeGateway,
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: true; charges: StatementCharge[]; refunds: StatementRefund[]; invoices: StatementInvoice[] } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  const fail = { ok: false as const, reason: "Stripe evidence was incomplete or timed out" };
  try {
    const charges = await pages(gateway.charges.list, { expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, mapCharge);
    const refunds = await pages(gateway.refunds.list, { expand: ["data.charge.customer"] as ["data.charge.customer"] }, options.signal, deadline, now, mapRefund);
    const invoices = await pages(gateway.invoices.list, { expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, mapInvoice);
    if (!charges || !refunds || !invoices) return fail;
    const people = new Map<string, StatementCustomer>();
    const remember = (customer: StatementCustomer | null) => { if (customer) people.set(customer.id, customer); };
    for (const row of charges) remember(row.customer);
    for (const row of refunds) remember(row.customer);
    for (const row of invoices) remember(row.customer);
    const hydrate = async (customerId: string | null): Promise<StatementCustomer | null> => {
      if (!customerId) return null;
      const cached = people.get(customerId);
      if (cached) return cached;
      if (now() >= deadline) throw new StripeTemporarilyUnavailable();
      options.signal?.throwIfAborted();
      const loaded = mapCustomer(await gateway.customers.retrieve(customerId, {}, { timeout: remaining(deadline, now) }));
      if (!loaded) return null;
      people.set(loaded.id, loaded);
      return loaded;
    };
    for (const row of charges) {
      if (row.customer || !row.customerId) continue;
      const loaded = await hydrate(row.customerId);
      if (!loaded) return fail;
      row.customer = loaded;
    }
    for (const row of refunds) {
      if (!row.customer && row.chargeId && !row.chargeLoaded) {
        if (now() >= deadline) throw new StripeTemporarilyUnavailable();
        options.signal?.throwIfAborted();
        const charge = mapCharge(await gateway.charges.retrieve(row.chargeId, {}, { timeout: remaining(deadline, now) }));
        if (!charge) return fail;
        row.customer = charge.customer;
        row.customerId = charge.customerId;
      }
      if (!row.customer && row.customerId) {
        const loaded = await hydrate(row.customerId);
        if (!loaded) return fail;
        row.customer = loaded;
      }
    }
    for (const row of invoices) {
      if (row.skip || row.customer || !row.customerId) continue;
      const loaded = await hydrate(row.customerId);
      if (!loaded) return fail;
      row.customer = loaded;
    }
    return {
      ok: true,
      charges: charges.map((row) => ({
        id: row.id, amountCents: row.amountCents, currency: row.currency, created: row.created, description: row.description,
        status: row.status, succeeded: row.succeeded, customer: row.customer,
      })),
      refunds: refunds.map((row) => ({
        id: row.id, amountCents: row.amountCents, currency: row.currency, created: row.created, description: row.description,
        status: row.status, customer: row.customer,
      })),
      invoices: invoices.filter((row) => !row.skip).map((row) => ({
        id: row.id, amountCents: row.amountCents, currency: row.currency, created: row.created, description: row.description,
        status: row.status, outstandingCents: row.outstandingCents, customer: row.customer,
      })),
    };
  } catch (error) {
    return { ok: false, reason: stripeReadFailureReason(error) };
  }
}

export function readLiveDriverStatement(signal?: AbortSignal) {
  return readDriverStatement(createReadOnlyStripe("live", { cache: true }), { signal });
}

type MappedCharge = {
  id: string; amountCents: number | null; currency: string; created: number; description: string;
  status: string; succeeded: boolean; customer: StatementCustomer | null; customerId: string | null;
};
type MappedRefund = {
  id: string; amountCents: number | null; currency: string; created: number; description: string;
  status: string; customer: StatementCustomer | null; customerId: string | null; chargeId: string | null; chargeLoaded: boolean;
};
type MappedInvoice = {
  skip: boolean; id: string; amountCents: number | null; currency: string; created: number; description: string;
  status: string; outstandingCents: number | null; customer: StatementCustomer | null; customerId: string | null;
};

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
function titleReason(value: string): string {
  return value.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
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

function mapCustomer(row: RawCustomer): StatementCustomer | null {
  if (!live(row)) return null;
  if (row.deleted === true) return typeof row.id === "string" && row.id ? { id: row.id, email: null, phone: null } : null;
  if (typeof row.id !== "string" || !row.id) return null;
  return { id: row.id, email: text(row.email), phone: text(row.phone) };
}
function customerOf(value: unknown): { customer: StatementCustomer | null; customerId: string | null } | null {
  if (typeof value === "string") return { customer: null, customerId: value };
  if (value && typeof value === "object") {
    const customer = mapCustomer(value as RawCustomer);
    if (!customer) return null;
    return { customer, customerId: customer.id };
  }
  return { customer: null, customerId: null };
}
function mapCharge(row: RawCharge): MappedCharge | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string" || typeof row.status !== "string") return null;
  const succeeded = row.status === "succeeded";
  if (succeeded && (row.paid !== true || row.captured !== true)) return null;
  const amount = cents(row.amount_captured ?? row.amount);
  if (succeeded && amount === null) return null;
  const customer = customerOf(row.customer);
  if (!customer) return null;
  return {
    id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created,
    description: text(row.description) ?? "Charge", status: row.status.toLowerCase(), succeeded, ...customer,
  };
}
function mapRefund(row: RawRefund): MappedRefund | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created)) return null;
  if (typeof row.currency !== "string" || typeof row.status !== "string" || !row.status.trim()) return null;
  const amount = cents(row.amount);
  if (amount === null) return null;
  const reason = text(row.reason);
  let customer: StatementCustomer | null = null;
  let customerId: string | null = null;
  let chargeId: string | null = null;
  let chargeLoaded = false;
  if (typeof row.charge === "string") chargeId = row.charge;
  else if (row.charge && typeof row.charge === "object") {
    const charge = row.charge as RawCharge;
    if (!live(charge)) return null;
    const who = customerOf(charge.customer);
    if (!who) return null;
    customer = who.customer;
    customerId = who.customerId;
    chargeId = idOf(charge.id);
    chargeLoaded = true;
  } else return null;
  return {
    id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created,
    description: reason ? `Refund · ${titleReason(reason)}` : "Refund", status: row.status.trim().toLowerCase(),
    customer, customerId, chargeId, chargeLoaded,
  };
}
function subscriptionOf(row: RawInvoice): string | null {
  const parent = row.parent && typeof row.parent === "object" ? (row.parent as { subscription_details?: unknown }).subscription_details : null;
  const nested = parent && typeof parent === "object" ? idOf((parent as { subscription?: unknown }).subscription) : null;
  return nested ?? idOf(row.subscription);
}
function mapInvoice(row: RawInvoice): MappedInvoice | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  const subscriptionId = subscriptionOf(row);
  if (!subscriptionId) return { skip: true, id: row.id, amountCents: null, currency: "", created: 0, description: "", status: "", outstandingCents: null, customer: null, customerId: null };
  if (typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string" || typeof row.status !== "string" || !row.status.trim()) return null;
  const status = row.status.trim().toLowerCase();
  const remaining = cents(row.amount_remaining);
  if (status === "open" && remaining === null) return null;
  const amount = status === "open" ? remaining : status === "paid" ? cents(row.amount_paid) : cents(row.amount_due);
  if (status === "paid" && amount === null) return null;
  const customer = customerOf(row.customer);
  if (!customer) return null;
  const number = text(row.number);
  return {
    skip: false, id: row.id, amountCents: amount, currency: row.currency.toLowerCase(), created: row.created,
    description: text(row.description) ?? (number ? `Invoice ${number}` : "Subscription Invoice"),
    status, outstandingCents: status === "open" ? remaining : null, ...customer,
  };
}
