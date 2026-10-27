// Collecting money against charges that already exist.
//
// The invariant (Phase 0): a `payments` row is a CHARGE — an amount owed. It is
// written BEFORE any attempt to collect it, so a declined card, a provider
// outage or a missing card never makes the charge disappear. A collection
// ATTEMPT only moves the row's state:
//
//   pending  → paid      money received (the only state counted as revenue)
//   pending  → failed    attempt failed; still owed; failure_reason recorded
//   failed   → pending   retry on the SAME row — never a second charge
//   pending stays pending while Stripe has not confirmed the outcome; no new
//   attempt starts on a rental while any of its rows is pending
//   paid     → refunded  money returned (charge.refunded webhook)
//
// Retries are idempotent per attempt (Stripe idempotency key = row + attempt
// number), and no update ever moves a row out of 'paid' except a refund.

import { getStripeErrorMessage, type createStripeClient } from "@/lib/stripe.server";

type Stripe = ReturnType<typeof createStripeClient>;

/** Charge states that still owe money. */
export const OUTSTANDING_STATUSES = ["pending", "failed", "late", "overdue", "past_due", "unpaid", "collections", "current"] as const;

/** What is still owed on a charge: its running balance (incl. late fees) or, if never set, its amount. */
export function owedOn(row: { amount: unknown; balance_due: unknown }): number {
  const bal = row.balance_due == null ? NaN : Number(row.balance_due);
  return Number.isFinite(bal) && bal > 0 ? bal : Number(row.amount ?? 0);
}

export const REASON_TO_TYPE: Record<string, string> = {
  rent: "rent",
  late_fee: "late_fee",
  toll: "toll",
  damage: "damage",
  cleaning: "fee",
  fuel: "fee",
  other: "other",
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Stripe idempotency key for one attempt on a set of rows. One row keeps the readable form; a set
 * uses a hash of its sorted ids, because the joined ids pass Stripe's 255-character limit at 7 rows.
 */
export async function attemptKey(ids: string[], attempt: number): Promise<string> {
  if (ids.length === 1) return `payments:${ids[0]}:attempt:${attempt}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([...ids].sort().join(",")));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `payments:set-${hex}:attempt:${attempt}`;
}

export type CollectResult =
  | { ok: true; paymentIntentId: string; status: "paid" | "pending"; paymentIds: string[] }
  | { error: string; paymentIds: string[]; outcome: "failed" | "unconfirmed" | "busy" };

/**
 * What the driver portal shows and what Pay Now collects, computed once so the two always agree.
 * Rows tied to a Stripe invoice are left to Stripe (it retries the invoice itself). Any pending
 * row on the rental means a payment is in flight or unconfirmed: nothing new may start.
 */
export async function rentalBalance(client: any, rentalId: string) {
  const { data, error } = await client
    .from("payments")
    .select("id, status, amount, balance_due, attempt_count, stripe_invoice_id, due_date")
    .eq("rental_id", rentalId)
    .in("status", [...OUTSTANDING_STATUSES])
    .order("due_date", { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) throw new Error("Could not read the balance.");
  const all = (data ?? []) as any[];
  const rows = all.filter((r) => r.status !== "pending" && !r.stripe_invoice_id).slice(0, 12);
  return {
    processing: all.some((r) => r.status === "pending"),
    rows,
    cents: Math.round(rows.reduce((s, r) => s + owedOn(r), 0) * 100),
  };
}

/** Statuses a new attempt may start from: owed, and no attempt in flight (`pending`). */
export const CLAIMABLE_STATUSES = OUTSTANDING_STATUSES.filter((s) => s !== "pending");

/**
 * True only for a card decline Stripe itself reported (card_error, HTTP 402): the attempt was made
 * and failed, so nothing was collected. Everything else is an unknown outcome — timeouts, 5xx,
 * 409, and also 4xx such as 400/401/403/429: requests pass through a gateway and the client
 * retries, so a 4xx on a retry can follow a first try that did charge.
 */
export function stripeDefinitelyNotCharged(e: any): boolean {
  const cardError = e?.type === "StripeCardError" || (e?.rawType ?? e?.raw?.type) === "card_error";
  const status = Number(e?.statusCode ?? e?.raw?.statusCode ?? 0);
  return cardError && status === 402;
}

/**
 * Attempt to collect `rows` with one off-session card charge.
 * The rows must already exist. They are updated, never inserted.
 *
 * One attempt at a time, enforced in the database rather than by hiding buttons:
 * 1. Claim: one conditional update moves every row to `pending` only if it is still owed, not
 *    already in flight, and its attempt_count is below this attempt (so a stale read can't
 *    claim). Concurrent requests for the same rows can't both claim them.
 * 2. Per rental: after claiming, any other `pending` row on the rental means another payment is
 *    in flight (or unconfirmed); this attempt backs out without calling Stripe. Each request
 *    claims before it checks, so of two concurrent requests at most one proceeds.
 * 3. An outcome Stripe has not confirmed stays `pending`, never `failed`: the webhook settles it,
 *    or the Owner releases it after Stripe shows nothing was collected (payment-unconfirmed).
 */
export async function collectRows(
  admin: any,
  stripe: Stripe,
  rows: { id: string; amount: unknown; balance_due: unknown; attempt_count: number | null; status?: string | null }[],
  opts: { rentalId: string; customerId: string; paymentMethodId: string; description: string; metadata: Record<string, string> },
): Promise<CollectResult> {
  const ids = rows.map((r) => r.id);
  const cents = Math.round(rows.reduce((s, r) => s + owedOn(r), 0) * 100);
  if (cents < 50) return { error: "Nothing collectable on these charges", paymentIds: ids, outcome: "busy" };
  const attempt = Math.max(0, ...rows.map((r) => r.attempt_count ?? 0)) + 1;
  const single = ids.length === 1;
  const busy = { error: "Another payment for this rental is already in progress or waiting for Stripe to confirm it. Nothing was charged.", paymentIds: ids, outcome: "busy" as const };

  // Leave failure_reason in place until the charge succeeds. An unresolved
  // combined charge does not store a payment intent, and Mark as Paid does
  // not write one, so clearing the reason here would drop that cash payment
  // from the non-Stripe total.
  const { data: claimed, error: claimErr } = await admin
    .from("payments")
    .update({ attempt_count: attempt, last_attempt_at: new Date().toISOString(), status: "pending" })
    .in("id", ids)
    .in("status", [...CLAIMABLE_STATUSES])
    .lt("attempt_count", attempt)
    .select("id");
  const claimedIds: string[] = (claimed ?? []).map((r: any) => r.id);
  const release = async () => {
    for (const r of rows.filter((x) => claimedIds.includes(x.id))) {
      await admin
        .from("payments")
        .update({ status: r.status ?? "failed", attempt_count: r.attempt_count ?? 0 })
        .eq("id", r.id)
        .eq("status", "pending")
        .eq("attempt_count", attempt);
    }
  };
  if (claimErr || claimedIds.length !== ids.length) {
    await release();
    return busy;
  }
  const { data: inFlight, error: inFlightErr } = await admin.from("payments").select("id").eq("rental_id", opts.rentalId).eq("status", "pending");
  if (inFlightErr || (inFlight ?? []).some((r: any) => !ids.includes(r.id))) {
    await release();
    return busy;
  }

  // Only rows this attempt claimed, and only while they are still on this attempt: a webhook
  // that already settled them wins.
  const mine = () => admin.from("payments");
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        customer: opts.customerId,
        payment_method: opts.paymentMethodId,
        off_session: true,
        confirm: true,
        description: opts.description,
        metadata: { ...opts.metadata, paymentIds: ids.join(","), attempt: String(attempt) },
      },
      { idempotencyKey: await attemptKey(ids, attempt) },
    );
    const paid = pi.status === "succeeded";
    // A row staff already marked paid is skipped by the update below. Leave
    // its failure reason, status, and paid_date alone so the manual receipt
    // stays visible. The webhook sends one Payment Received notice and one
    // staff alert when Stripe collects.
    await mine()
      .update({
        status: paid ? "paid" : "pending",
        ...(paid ? { paid_date: today(), balance_due: 0, failure_reason: null } : {}),
        // A single charge keeps a pointer to its latest attempt; a combined
        // balance payment is matched by metadata.paymentIds instead.
        ...(single ? { stripe_payment_intent_id: pi.id } : {}),
      })
      .in("id", ids)
      .eq("status", "pending")
      .eq("attempt_count", attempt);
    return { ok: true, paymentIntentId: pi.id, status: paid ? "paid" : "pending", paymentIds: ids };
  } catch (e: any) {
    const message = getStripeErrorMessage(e);
    const piId: string | null = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id ?? null;
    if (!stripeDefinitelyNotCharged(e)) {
      // Unknown outcome: stays pending (Processing). Never failed, so nothing offers a new attempt.
      if (single && piId) await mine().update({ stripe_payment_intent_id: piId }).eq("id", ids[0]).eq("status", "pending").eq("attempt_count", attempt);
      return { error: message, paymentIds: ids, outcome: "unconfirmed" };
    }
    await mine()
      .update({
        status: "failed",
        failure_reason: message.slice(0, 500),
        ...(single && piId ? { stripe_payment_intent_id: piId } : {}),
      })
      .in("id", ids)
      .eq("status", "pending")
      .eq("attempt_count", attempt);
    return { error: message, paymentIds: ids, outcome: "failed" };
  }
}

/** Record that a charge could not even be attempted (e.g. no card on file). It stays owed. */
export async function markUncollectable(admin: any, ids: string[], reason: string) {
  await admin
    .from("payments")
    .update({ status: "unpaid", failure_reason: reason.slice(0, 500), last_attempt_at: new Date().toISOString() })
    .in("id", ids)
    .in("status", [...CLAIMABLE_STATUSES]);
}
