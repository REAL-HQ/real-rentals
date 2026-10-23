import { STRIPE_READER_MAX_PAGES, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { RiskDispute, RiskFailure, RiskSubscriptionFact, RiskWindow } from "./stripe-risk-monitor";

/**
 * Disputes, failed charges, failed payment intents, and past_due or unpaid subscriptions.
 * createReadOnlyStripe("live", { cache: true }) with list only.
 * A page cap or any Stripe error returns no partial rows.
 */

const PAGE = 100;
const DEFAULT_TIMEOUT_MS = 20_000;

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type Raw = Record<string, unknown>;

export type RiskStripeGateway = {
  disputes: { list: (params: { limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<Raw>> };
  charges: { list: (params: { limit: number; created: { gte: number; lt: number }; starting_after?: string }, options?: CallOptions) => Promise<Page<Raw>> };
  paymentIntents: { list: (params: { limit: number; created: { gte: number; lt: number }; starting_after?: string }, options?: CallOptions) => Promise<Page<Raw>> };
  subscriptions: { list: (params: { limit: number; status: "past_due" | "unpaid"; starting_after?: string }, options?: CallOptions) => Promise<Page<Raw>> };
};

export type RiskStripeRead =
  | { ok: true; disputes: RiskDispute[]; failures: RiskFailure[]; subscriptions: RiskSubscriptionFact[] }
  | { ok: false; capped: boolean };

export async function readStripeRisk(
  gateway: RiskStripeGateway,
  window: RiskWindow,
  options: { timeoutMs?: number; now?: () => number; signal?: AbortSignal } = {},
): Promise<RiskStripeRead> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const disputes = await listPages(gateway, "disputes", window, deadline, now, options.signal);
    if (!disputes.ok) return { ok: false, capped: disputes.reason === "capped" };
    const charges = await listPages(gateway, "charges", window, deadline, now, options.signal);
    if (!charges.ok) return { ok: false, capped: charges.reason === "capped" };
    const intents = await listPages(gateway, "payment intents", window, deadline, now, options.signal);
    if (!intents.ok) return { ok: false, capped: intents.reason === "capped" };
    const pastDue = await listPages(gateway, "past_due subscriptions", window, deadline, now, options.signal);
    if (!pastDue.ok) return { ok: false, capped: pastDue.reason === "capped" };
    const unpaid = await listPages(gateway, "unpaid subscriptions", window, deadline, now, options.signal);
    if (!unpaid.ok) return { ok: false, capped: unpaid.reason === "capped" };
    const listed = [...disputes.rows, ...charges.rows, ...intents.rows, ...pastDue.rows, ...unpaid.rows];
    if (listed.some((row) => row.livemode !== false && typeof row.id !== "string")) return { ok: false, capped: false };
    return {
      ok: true,
      disputes: disputes.rows.flatMap((row) => { const mapped = mapDispute(row); return mapped ? [mapped] : []; }),
      failures: [
        ...charges.rows.flatMap((row) => { const mapped = mapCharge(row, window); return mapped ? [mapped] : []; }),
        ...intents.rows.flatMap((row) => { const mapped = mapIntent(row, window); return mapped ? [mapped] : []; }),
      ],
      subscriptions: [...pastDue.rows, ...unpaid.rows].flatMap((row) => { const mapped = mapSubscription(row); return mapped ? [mapped] : []; }),
    };
  } catch {
    return { ok: false, capped: false };
  }
}

export function readLiveStripeRisk(window: RiskWindow): Promise<RiskStripeRead> {
  return readStripeRisk(createReadOnlyStripe("live", { cache: true }) as unknown as RiskStripeGateway, window);
}

async function listPages(
  gateway: RiskStripeGateway,
  label: string,
  window: RiskWindow,
  deadline: number,
  now: () => number,
  signal: AbortSignal | undefined,
) {
  const created = { gte: window.gte, lt: window.lt };
  return paginateStripeList(
    (cursor) => {
      const page = cursor ? { starting_after: cursor } : {};
      const timeout = { timeout: Math.max(1, Math.min(10_000, deadline - now())) };
      if (label === "disputes") return gateway.disputes.list({ limit: PAGE, ...page }, timeout);
      if (label === "charges") return gateway.charges.list({ limit: PAGE, created, ...page }, timeout);
      if (label === "payment intents") return gateway.paymentIntents.list({ limit: PAGE, created, ...page }, timeout);
      const status = label === "past_due subscriptions" ? "past_due" as const : "unpaid" as const;
      return gateway.subscriptions.list({ limit: PAGE, status, ...page }, timeout);
    },
    { label, maxPages: STRIPE_READER_MAX_PAGES, signal, deadline, now, strict: true },
  );
}

function mapDispute(row: Raw): RiskDispute | null {
  if (!live(row) || typeof row.id !== "string" || typeof row.status !== "string") return null;
  if (!["needs_response", "warning_needs_response", "under_review", "warning_under_review"].includes(row.status)) return null;
  return {
    id: row.id,
    status: row.status,
    dueBy: dueBy(row.evidence_details),
    created: unix(row.created) ?? 0,
    customerId: refId(row.customer),
    paymentIntentId: refId(row.payment_intent),
  };
}

function mapCharge(row: Raw, window: RiskWindow): RiskFailure | null {
  if (!live(row) || typeof row.id !== "string" || row.status !== "failed") return null;
  const created = unix(row.created);
  if (created == null || created < window.gte || created >= window.lt) return null;
  const outcome = record(row.outcome);
  return {
    id: row.id,
    created,
    customerId: refId(row.customer),
    paymentIntentId: refId(row.payment_intent),
    declineCode: text(outcome?.decline_code) ?? text(row.failure_code) ?? text(outcome?.reason),
  };
}

function mapIntent(row: Raw, window: RiskWindow): RiskFailure | null {
  if (!live(row) || typeof row.id !== "string" || row.status === "succeeded") return null;
  const created = unix(row.created);
  const error = record(row.last_payment_error);
  if (created == null || created < window.gte || created >= window.lt || !error) return null;
  return {
    id: row.id,
    created,
    customerId: refId(row.customer),
    paymentIntentId: row.id,
    declineCode: text(error.decline_code) ?? text(error.code),
  };
}

function mapSubscription(row: Raw): RiskSubscriptionFact | null {
  if (!live(row) || typeof row.id !== "string" || (row.status !== "past_due" && row.status !== "unpaid")) return null;
  return { id: row.id, status: row.status, customerId: refId(row.customer), currentPeriodEnd: unix(row.current_period_end) };
}

function live(row: Raw): boolean {
  return row.livemode === undefined || row.livemode === true;
}
function record(value: unknown): Raw | null {
  return value && typeof value === "object" ? value as Raw : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function unix(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function dueBy(value: unknown): number | null {
  return unix(record(value)?.due_by);
}
function refId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return text(record(value)?.id);
}
