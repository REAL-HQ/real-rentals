import { createReadOnlyStripe } from "./stripe-reader.server";
import type { PartnerCharge } from "./partner-statement";

/**
 * Read-only Stripe charges for Partner Statement and Owner P&L.
 * charges.list is the only call, through the shared reader, cache opted in.
 * The reader refuses every other method. No create, update, refund, capture, or config.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCharge = {
  id?: unknown; amount_captured?: unknown; currency?: unknown; status?: unknown; paid?: unknown;
  captured?: unknown; created?: unknown; customer?: unknown; payment_intent?: unknown; invoice?: unknown; livemode?: unknown;
  metadata?: unknown;
};
export type ReadOnlyStripeGateway = {
  charges: { list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string; expand: ["data.invoice"] }, options?: CallOptions) => Promise<Page<RawCharge>> };
};

const PAGE = 100;
const MAX_PAGES = 100;
const INCOMPLETE = "Stripe evidence was incomplete or timed out";
export const STRIPE_CHARGE_PAGE_CAP = `Stripe charge list reached its page limit (${MAX_PAGES} pages)`;

export async function readPartnerCharges(
  gateway: ReadOnlyStripeGateway,
  window: { gte: number; lt: number },
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {},
): Promise<{ ok: true; charges: PartnerCharge[] } | { ok: false; reason: string; capped?: boolean }> {
  if (!Number.isSafeInteger(window.gte) || !Number.isSafeInteger(window.lt) || window.lt <= window.gte) return { ok: false, reason: "Stripe period is invalid" };
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  try {
    const charges = await pages(gateway.charges.list, { created: window, expand: ["data.invoice"] as ["data.invoice"] }, options.signal, deadline, now);
    if (!charges) return { ok: false, reason: INCOMPLETE };
    if (charges.capped) return { ok: false, reason: STRIPE_CHARGE_PAGE_CAP, capped: true };
    return { ok: true, charges: charges.rows };
  } catch {
    return { ok: false, reason: INCOMPLETE };
  }
}

export function readLivePartnerCharges(window: { gte: number; lt: number }, signal?: AbortSignal) {
  return readPartnerCharges(createReadOnlyStripe("live", { cache: true }) as unknown as ReadOnlyStripeGateway, window, { signal });
}

function remaining(deadline: number, now: () => number): number {
  return Math.max(1, Math.min(10_000, deadline - now()));
}
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "id" in value) return idOf((value as { id?: unknown }).id);
  return null;
}
function subscriptionOf(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== "object") return null;
  const parent = (invoice as { parent?: unknown }).parent;
  const details = parent && typeof parent === "object" ? (parent as { subscription_details?: unknown }).subscription_details : null;
  const nested = details && typeof details === "object" ? idOf((details as { subscription?: unknown }).subscription) : null;
  return nested ?? idOf((invoice as { subscription?: unknown }).subscription);
}

async function pages(
  list: ReadOnlyStripeGateway["charges"]["list"],
  filter: { created: { gte: number; lt: number }; expand: ["data.invoice"] },
  signal: AbortSignal | undefined,
  deadline: number,
  now: () => number,
): Promise<{ rows: PartnerCharge[]; capped: boolean } | null> {
  const rows: PartnerCharge[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (now() >= deadline) return null;
    signal?.throwIfAborted();
    const result = await list({ ...filter, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) }, { timeout: remaining(deadline, now) });
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") return null;
    for (const row of result.data) {
      const mapped = mapCharge(row);
      if (!mapped) return null;
      rows.push(mapped);
    }
    if (!result.has_more) return { rows, capped: false };
    const next = idOf((result.data.at(-1) as { id?: unknown } | undefined)?.id);
    if (!next || next === cursor) return null;
    cursor = next;
  }
  console.warn(`Partner statement page cap reached (${MAX_PAGES})`);
  return { rows, capped: true };
}

function mapCharge(row: RawCharge): PartnerCharge | null {
  if ((row.livemode !== undefined && row.livemode !== true) || typeof row.id !== "string" || !row.id) return null;
  if (typeof row.created !== "number" || !Number.isSafeInteger(row.created) || typeof row.currency !== "string") return null;
  if (typeof row.amount_captured !== "number" || !Number.isSafeInteger(row.amount_captured)) return null;
  const invoice = row.invoice;
  return {
    id: row.id,
    customerId: idOf(row.customer),
    paymentIntentId: idOf(row.payment_intent),
    invoiceId: typeof invoice === "string" ? invoice : idOf(invoice),
    subscriptionId: subscriptionOf(invoice),
    amountCents: row.amount_captured,
    currency: row.currency.toLowerCase(),
    succeeded: row.paid === true && row.captured === true && row.status === "succeeded" && row.amount_captured > 0,
    created: row.created,
    paymentIds: paymentIdsOf(row.metadata),
  };
}

function paymentIdsOf(metadata: unknown): string[] {
  const raw = metadata && typeof metadata === "object" ? (metadata as { paymentIds?: unknown }).paymentIds : null;
  if (typeof raw !== "string") return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}
