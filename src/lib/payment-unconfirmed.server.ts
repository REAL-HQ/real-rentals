// Owner recovery for a charge whose outcome Stripe never confirmed.
//
// collectRows leaves such a charge `pending` (Processing), and nothing starts a new payment on its
// rental until it settles. The webhook settles it when Stripe reports. If Stripe never reports
// (the request never reached Stripe), the Owner releases it back to `failed` — but only after this
// server-side check of Stripe itself finds no successful and no in-flight PaymentIntent for it.
// The Owner's word alone never releases a charge. Every release is audited, and an audit failure
// undoes it.
import type { createStripeClient } from "@/lib/stripe.server";

type Stripe = ReturnType<typeof createStripeClient>;

/** Longer than any Stripe request can still be in flight (client timeout plus its own retries). */
export const UNCONFIRMED_SETTLE_MINUTES = 10;
const IN_FLIGHT = ["processing", "requires_action", "requires_confirmation", "requires_capture"];

type Actor = { userId: string; email: string | null; role: string };

export async function releaseUnconfirmedCharge(
  admin: any,
  stripe: Stripe,
  args: { paymentId: string; reason: string; actor: Actor; now?: Date },
): Promise<{ ok: true; checked: number } | { error: string }> {
  const now = args.now ?? new Date();
  const { data: row } = await admin
    .from("payments")
    .select("id, status, amount, attempt_count, last_attempt_at, rental_id, stripe_payment_intent_id")
    .eq("id", args.paymentId)
    .maybeSingle();
  if (!row) return { error: "Payment not found." };
  if (row.status !== "pending") return { error: "Only a Processing charge can be checked and released." };
  const last = row.last_attempt_at ? new Date(row.last_attempt_at) : null;
  const settleAt = last ? new Date(last.getTime() + UNCONFIRMED_SETTLE_MINUTES * 60_000) : null;
  if (!settleAt || settleAt > now)
    return { error: `Wait until ${settleAt ? settleAt.toISOString().slice(11, 16) + " UTC" : "the attempt time is known"}: the charge may still be reaching Stripe.` };

  const { data: rental } = await admin.from("rentals").select("stripe_customer_id").eq("id", row.rental_id).maybeSingle();
  const customer = rental?.stripe_customer_id as string | undefined;
  if (!customer) return { error: "Can't verify with Stripe: the rental has no Stripe customer. Nothing was changed." };

  // Every PaymentIntent for this customer from an hour before the attempt until now (a list, not a
  // search, so it is not eventually consistent), plus the one stored on the row.
  const from = Math.floor(last!.getTime() / 1000) - 3600;
  let intents: any[];
  try {
    const page = await stripe.paymentIntents.list({ customer, created: { gte: from }, limit: 100 });
    if (page.has_more) return { error: "Too many Stripe payments to verify automatically. Nothing was changed; check Stripe by hand." };
    intents = [...page.data];
    if (row.stripe_payment_intent_id && !intents.some((pi) => pi.id === row.stripe_payment_intent_id))
      intents.push(await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id));
  } catch {
    return { error: "Could not reach Stripe to verify. Nothing was changed." };
  }
  const matches = intents.filter(
    (pi) =>
      pi.id === row.stripe_payment_intent_id ||
      String(pi.metadata?.paymentIds ?? "").split(",").map((s: string) => s.trim()).includes(row.id),
  );
  const collected = matches.filter((pi) => pi.status === "succeeded" || Number(pi.amount_received ?? 0) > 0);
  if (collected.length)
    return { error: `Stripe collected this charge (${collected.map((pi) => pi.id).join(", ")}). Not released. The webhook records it as Paid; if it is still Processing after 30 minutes, Mark as Paid naming that PaymentIntent.` };
  const inFlight = matches.filter((pi) => IN_FLIGHT.includes(pi.status));
  if (inFlight.length) return { error: `Stripe is still processing this charge (${inFlight.map((pi) => `${pi.id} ${pi.status}`).join(", ")}). Not released.` };

  const evidence = matches.map((pi) => ({ id: pi.id, status: pi.status, amount_received: pi.amount_received ?? 0 }));
  const { data: changed } = await admin
    .from("payments")
    .update({ status: "failed", failure_reason: "Not collected: Stripe shows no successful or processing charge (checked before the Owner released it)." })
    .eq("id", row.id)
    .eq("status", "pending")
    .eq("attempt_count", row.attempt_count)
    .select("id");
  if (!changed?.length) return { error: "This charge changed while it was being checked. Nothing was released; reload Payments." };

  const { error: auditErr } = await admin.from("audit_log").insert({
    actor_user_id: args.actor.userId,
    actor_email: args.actor.email,
    actor_role: args.actor.role,
    action: "payment.unconfirmed_released",
    entity_type: "payment",
    entity_id: row.id,
    summary: `Unconfirmed charge released after a Stripe check: $${Number(row.amount ?? 0).toFixed(2)}`,
    metadata: {
      reason: args.reason,
      from: "pending",
      to: "failed",
      attempt: row.attempt_count,
      last_attempt_at: row.last_attempt_at,
      stripe_customer: customer,
      checked_at: now.toISOString(),
      checked_from: new Date(from * 1000).toISOString(),
      intents_checked: intents.length,
      matching_intents: evidence,
    },
  });
  if (auditErr) {
    await admin.from("payments").update({ status: "pending" }).eq("id", row.id).eq("status", "failed").eq("attempt_count", row.attempt_count);
    return { error: "Could not record the release in the audit log, so it was undone." };
  }
  return { ok: true, checked: intents.length };
}
