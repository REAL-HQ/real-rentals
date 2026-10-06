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

export type CollectResult =
  | { ok: true; paymentIntentId: string; status: "paid" | "pending"; paymentIds: string[] }
  | { error: string; paymentIds: string[] };

/**
 * Attempt to collect `rows` with one off-session card charge.
 * The rows must already exist. They are updated, never inserted.
 */
export async function collectRows(
  admin: any,
  stripe: Stripe,
  rows: { id: string; amount: unknown; balance_due: unknown; attempt_count: number | null }[],
  opts: { customerId: string; paymentMethodId: string; description: string; metadata: Record<string, string> },
): Promise<CollectResult> {
  const ids = rows.map((r) => r.id);
  const cents = Math.round(rows.reduce((s, r) => s + owedOn(r), 0) * 100);
  if (cents < 50) return { error: "Nothing collectable on these charges", paymentIds: ids };
  const attempt = Math.max(0, ...rows.map((r) => r.attempt_count ?? 0)) + 1;
  const single = ids.length === 1;

  await admin
    .from("payments")
    .update({ attempt_count: attempt, last_attempt_at: new Date().toISOString(), status: "pending", failure_reason: null })
    .in("id", ids)
    .neq("status", "paid");

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
        metadata: { ...opts.metadata, paymentIds: ids.join(",") },
      },
      { idempotencyKey: `payments:${ids.join(",")}:attempt:${attempt}` },
    );
    const paid = pi.status === "succeeded";
    await admin
      .from("payments")
      .update({
        status: paid ? "paid" : "pending",
        ...(paid ? { paid_date: today(), balance_due: 0 } : {}),
        // A single charge keeps a pointer to its latest attempt; a combined
        // balance payment is matched by metadata.paymentIds instead.
        ...(single ? { stripe_payment_intent_id: pi.id } : {}),
      })
      .in("id", ids)
      .neq("status", "paid");
    return { ok: true, paymentIntentId: pi.id, status: paid ? "paid" : "pending", paymentIds: ids };
  } catch (e: any) {
    const message = getStripeErrorMessage(e);
    const piId: string | null = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id ?? null;
    await admin
      .from("payments")
      .update({
        status: "failed",
        failure_reason: message.slice(0, 500),
        ...(single && piId ? { stripe_payment_intent_id: piId } : {}),
      })
      .in("id", ids)
      .neq("status", "paid");
    return { error: message, paymentIds: ids };
  }
}

/** Record that a charge could not even be attempted (e.g. no card on file). It stays owed. */
export async function markUncollectable(admin: any, ids: string[], reason: string) {
  await admin
    .from("payments")
    .update({ status: "unpaid", failure_reason: reason.slice(0, 500), last_attempt_at: new Date().toISOString() })
    .in("id", ids)
    .neq("status", "paid");
}
