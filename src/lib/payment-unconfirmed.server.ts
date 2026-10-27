// Owner recovery for a charge whose outcome Stripe never confirmed.
//
// collectRows leaves such a charge `pending` (Processing), and nothing starts a new payment on its
// rental until it settles. The webhook settles it when Stripe reports. If Stripe never reports
// (the request never reached Stripe), the Owner releases it back to `failed` — but only after this
// server-side check of Stripe itself finds no successful and no in-flight PaymentIntent for it.
// The Owner's word alone never releases a charge.
//
// The check does not trust anything that can change after the attempt: it lists every
// PaymentIntent in each configured Stripe account (live and sandbox) created within an hour either
// side of the attempt, whatever customer it was made for, and matches this row's id in the
// metadata collectRows writes. The audit row is written first; no audit row, no release.
import type { createStripeClient } from "@/lib/stripe.server";

type Stripe = ReturnType<typeof createStripeClient>;
export type StripeAccount = { env: string; stripe: Stripe };

/** Longer than any Stripe request can still be in flight (client timeout plus its own retries). */
export const UNCONFIRMED_SETTLE_MINUTES = 10;
const WINDOW_SECONDS = 3600;
const MAX_PAGES = 10;
const IN_FLIGHT = ["processing", "requires_action", "requires_confirmation", "requires_capture"];

type Actor = { userId: string; email: string | null; role: string };

async function intentsAround(stripe: Stripe, anchor: number): Promise<any[] | "too_many"> {
  const out: any[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await stripe.paymentIntents.list({
      created: { gte: anchor - WINDOW_SECONDS, lte: anchor + WINDOW_SECONDS },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    out.push(...res.data);
    if (!res.has_more) return out;
    startingAfter = res.data[res.data.length - 1]?.id;
  }
  return "too_many";
}

export async function releaseUnconfirmedCharge(
  admin: any,
  accounts: StripeAccount[],
  args: { paymentId: string; reason: string; actor: Actor; now?: Date },
): Promise<{ ok: true; checked: number } | { error: string }> {
  const now = args.now ?? new Date();
  if (!accounts.length) return { error: "No Stripe account is configured to verify against. Nothing was changed." };
  const { data: row } = await admin
    .from("payments")
    .select("id, status, amount, attempt_count, last_attempt_at, created_at, rental_id, stripe_payment_intent_id")
    .eq("id", args.paymentId)
    .maybeSingle();
  if (!row) return { error: "Payment not found." };
  if (row.status !== "pending") return { error: "Only a Processing charge can be checked and released." };
  const anchorAt = new Date(row.last_attempt_at ?? row.created_at);
  const settleAt = new Date(anchorAt.getTime() + UNCONFIRMED_SETTLE_MINUTES * 60_000);
  if (Number.isNaN(settleAt.getTime()) || settleAt > now)
    return { error: `Wait until ${Number.isNaN(settleAt.getTime()) ? "the attempt time is known" : settleAt.toISOString().slice(11, 16) + " UTC"}: the charge may still be reaching Stripe.` };
  const anchor = Math.floor(anchorAt.getTime() / 1000);

  const matches: any[] = [];
  let checked = 0;
  try {
    for (const { env, stripe } of accounts) {
      const intents = await intentsAround(stripe, anchor);
      if (intents === "too_many") return { error: `Too many ${env} Stripe payments around that time to verify automatically. Nothing was changed; check Stripe by hand.` };
      checked += intents.length;
      if (row.stripe_payment_intent_id && !intents.some((pi) => pi.id === row.stripe_payment_intent_id)) {
        try {
          intents.push(await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id));
        } catch (e: any) {
          if (Number(e?.statusCode) !== 404) throw e; // it belongs to the other account
        }
      }
      for (const pi of intents) {
        const ids = String(pi.metadata?.paymentIds ?? "").split(",").map((s: string) => s.trim());
        if (pi.id === row.stripe_payment_intent_id || ids.includes(row.id)) matches.push({ ...pi, env });
      }
    }
  } catch {
    return { error: "Could not reach Stripe to verify. Nothing was changed." };
  }
  const collected = matches.filter((pi) => pi.status === "succeeded" || Number(pi.amount_received ?? 0) > 0);
  if (collected.length)
    return { error: `Stripe collected this charge (${collected.map((pi) => pi.id).join(", ")}). Not released. The webhook records it as Paid; if it is still Processing after 30 minutes, Mark as Paid naming that PaymentIntent.` };
  const inFlight = matches.filter((pi) => IN_FLIGHT.includes(pi.status));
  if (inFlight.length) return { error: `Stripe is still processing this charge (${inFlight.map((pi) => `${pi.id} ${pi.status}`).join(", ")}). Not released.` };

  const audit = (action: string, summary: string, extra: Record<string, unknown> = {}) =>
    admin.from("audit_log").insert({
      actor_user_id: args.actor.userId,
      actor_email: args.actor.email,
      actor_role: args.actor.role,
      action,
      entity_type: "payment",
      entity_id: row.id,
      summary,
      metadata: {
        reason: args.reason,
        from: "pending",
        to: "failed",
        attempt: row.attempt_count,
        attempt_at: anchorAt.toISOString(),
        checked_at: now.toISOString(),
        accounts_checked: accounts.map((a) => a.env),
        window_seconds: WINDOW_SECONDS,
        intents_checked: checked,
        matching_intents: matches.map((pi) => ({ id: pi.id, env: pi.env, status: pi.status, amount_received: pi.amount_received ?? 0 })),
        ...extra,
      },
    });
  // Audit first: a release never exists without its record.
  const { error: auditErr } = await audit("payment.unconfirmed_released", `Unconfirmed charge released after a Stripe check: $${Number(row.amount ?? 0).toFixed(2)}`);
  if (auditErr) return { error: "Could not record the release in the audit log. Nothing was changed." };
  const { data: changed } = await admin
    .from("payments")
    .update({ status: "failed", failure_reason: "Not collected: Stripe shows no successful or processing charge (checked before the Owner released it)." })
    .eq("id", row.id)
    .eq("status", "pending")
    .eq("attempt_count", row.attempt_count)
    .select("id");
  if (!changed?.length) {
    await audit("payment.unconfirmed_release_not_applied", "Release not applied: the charge changed while it was being checked", { applied: false });
    return { error: "This charge changed while it was being checked. Nothing was released; reload Payments." };
  }
  return { ok: true, checked };
}
