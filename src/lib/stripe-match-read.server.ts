import { createStripeClient } from "./stripe.server";
import { CHARGE_WINDOW_DAYS, type StripeMatchCustomer } from "./stripe-match";

/**
 * Read-only Stripe window for the match report.
 * Lists active and past_due subscriptions and recent charges.
 * Retrieve loads a customer that a subscription did not expand.
 * No create, update, refund, capture, or config call exists in this module.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCustomer = { id?: unknown; name?: unknown; email?: unknown; phone?: unknown; deleted?: unknown; livemode?: unknown };
type RawSub = { id?: unknown; status?: unknown; customer?: unknown; items?: unknown; livemode?: unknown };
type RawCharge = { id?: unknown; customer?: unknown; created?: unknown; paid?: unknown; captured?: unknown; status?: unknown; livemode?: unknown };

export type ReadOnlyStripeGateway = {
  subscriptions: { list: (params: { status: "active" | "past_due"; limit: number; starting_after?: string; expand: ["data.customer"] }, options?: CallOptions) => Promise<Page<RawSub>> };
  charges: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawCharge>> };
  customers: { retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCustomer> };
};

const PAGE = 100;
const MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 20_000;

export async function readStripeMatchWindow(
  gateway: ReadOnlyStripeGateway,
  options: { timeoutMs?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<{ ok: true; customers: StripeMatchCustomer[] } | { ok: false; reason: string }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const end = Math.floor(now() / 1000);
  const created = { gte: end - CHARGE_WINDOW_DAYS * 86400, lt: end };
  try {
    const active = await pages(gateway.subscriptions.list, { status: "active" as const, expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, mapSub);
    const pastDue = await pages(gateway.subscriptions.list, { status: "past_due" as const, expand: ["data.customer"] as ["data.customer"] }, options.signal, deadline, now, mapSub);
    const charges = await pages(gateway.charges.list, { created }, options.signal, deadline, now, mapCharge);
    if (!active || !pastDue || !charges) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
    const people = new Map<string, Person>();
    const subs = [...active, ...pastDue];
    for (const sub of subs) {
      if (sub.person) people.set(sub.customerId, sub.person);
    }
    for (const sub of subs) {
      if (people.has(sub.customerId)) continue;
      if (now() >= deadline) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      options.signal?.throwIfAborted();
      const raw = await gateway.customers.retrieve(sub.customerId, {}, { timeout: remaining(deadline, now) });
      const person = mapPerson(raw);
      if (!person) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      people.set(person.id, person);
    }
    const paidAt = new Map<string, number>();
    for (const charge of charges) {
      if (!charge.succeeded) continue;
      const prior = paidAt.get(charge.customerId);
      if (prior === undefined || charge.created > prior) paidAt.set(charge.customerId, charge.created);
    }
    const byCustomer = new Map<string, MappedSub[]>();
    for (const sub of subs) {
      const rows = byCustomer.get(sub.customerId) ?? [];
      rows.push(sub);
      byCustomer.set(sub.customerId, rows);
    }
    const customers: StripeMatchCustomer[] = [];
    for (const [id, rows] of byCustomer) {
      const person = people.get(id);
      if (!person) return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
      const weekly = rows.every((row) => row.weeklyAmountCents !== null)
        ? rows.reduce((sum, row) => sum + (row.weeklyAmountCents as number), 0)
        : null;
      customers.push({
        id,
        name: person.name,
        email: person.email,
        phone: person.phone,
        status: rows.some((row) => row.status === "past_due") ? "past_due" : "active",
        weeklyAmountCents: weekly !== null && Number.isSafeInteger(weekly) ? weekly : null,
        lastPaidAt: paidAt.get(id) ?? null,
      });
    }
    return { ok: true, customers };
  } catch {
    return { ok: false, reason: "Stripe evidence was incomplete or timed out" };
  }
}

export async function readLiveStripeMatch(): Promise<{ ok: true; customers: StripeMatchCustomer[] } | { ok: false; reason: string }> {
  return readStripeMatchWindow(createStripeClient("live"));
}

type Person = { id: string; name: string | null; email: string | null; phone: string | null };
type MappedSub = { customerId: string; status: "active" | "past_due"; weeklyAmountCents: number | null; person: Person | null };

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
    const next = typeof (result.data.at(-1) as { id?: unknown } | undefined)?.id === "string"
      ? (result.data.at(-1) as { id: string }).id
      : null;
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return null;
}

function mapPerson(row: RawCustomer): Person | null {
  if (!live(row)) return null;
  if (row.deleted === true) return typeof row.id === "string" && row.id ? { id: row.id, name: null, email: null, phone: null } : null;
  if (typeof row.id !== "string" || !row.id) return null;
  return { id: row.id, name: text(row.name), email: text(row.email), phone: text(row.phone) };
}
function mapSub(row: RawSub): MappedSub | null {
  if (!live(row) || typeof row.id !== "string" || !row.id) return null;
  if (row.status !== "active" && row.status !== "past_due") return null;
  const customer = row.customer;
  if (typeof customer === "string" && customer) return { customerId: customer, status: row.status, weeklyAmountCents: weeklyCents(row.items), person: null };
  const person = customer && typeof customer === "object" ? mapPerson(customer as RawCustomer) : null;
  if (!person) return null;
  return { customerId: person.id, status: row.status, weeklyAmountCents: weeklyCents(row.items), person };
}
function mapCharge(row: RawCharge): { customerId: string; created: number; succeeded: boolean } | null {
  if (!live(row) || typeof row.id !== "string" || !row.id || typeof row.created !== "number" || !Number.isSafeInteger(row.created)) return null;
  const customer = row.customer;
  const customerId = typeof customer === "string" ? customer : customer && typeof customer === "object" && typeof (customer as { id?: unknown }).id === "string" ? (customer as { id: string }).id : null;
  if (!customerId) return null;
  return { customerId, created: row.created, succeeded: row.paid === true && row.captured === true && row.status === "succeeded" };
}
function weeklyCents(items: unknown): number | null {
  if (!items || typeof items !== "object") return null;
  const bag = items as { has_more?: unknown; data?: unknown };
  if (bag.has_more !== false || !Array.isArray(bag.data) || bag.data.length === 0) return null;
  let total = 0;
  for (const item of bag.data) {
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
