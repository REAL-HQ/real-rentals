// Records a paid one-off Stripe payment (Payment Link, Dashboard Checkout,
// manual charge) against exactly one rental, or flags it for staff. Called
// from checkout.session.completed, charge.succeeded and payment_intent.succeeded;
// every call reads the same Stripe objects, so the three events agree and the
// first one to arrive writes the row (unique payment-intent index). Read-only
// against Stripe.
import { easternDateOf } from "@/lib/rent-reminders";
import { stripeId } from "@/lib/stripe-unmatched";
import {
  appOwnsPayment,
  exactILike,
  oneOffIdentity,
  oneOffRowType,
  pickRental,
  unmatchedBody,
  UNMATCHED_TITLE,
  type OneOffIdentity,
  type RentalCandidate,
} from "@/lib/one-off-payment";

type Admin = any;
type StripeLike = any;

export type OneOffOutcome =
  | { status: "skipped"; why: "app_owned" | "already_recorded" | "not_paid" | "no_intent" }
  | { status: "recorded"; rentalId: string; by: "metadata" | "customer" | "email"; inserted: boolean }
  | { status: "unmatched"; why: "no_match" | "ambiguous"; identity: OneOffIdentity };

const RENTAL_COLS = "id, application_id, vehicle_id, status, stripe_customer_id";

function must<T extends { error: any }>(res: T): T {
  if (res?.error && res.error.code !== "23505") throw new Error(res.error.message);
  return res;
}

async function rows<T = any>(q: any): Promise<T[]> {
  const res = must(await q);
  return Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
}

/** Stripe objects for one intent. Errors throw so Stripe retries the event. */
async function loadStripeObjects(stripe: StripeLike, piId: string, given: { session?: any; charge?: any; paymentIntent?: any }) {
  const paymentIntent = given.paymentIntent?.id === piId && given.paymentIntent?.status
    ? given.paymentIntent
    : await stripe.paymentIntents.retrieve(piId);
  let session = given.session ?? null;
  if (!session) {
    const list = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
    session = list?.data?.[0] ?? null;
  }
  let charge = given.charge ?? null;
  const latest = stripeId(paymentIntent?.latest_charge);
  if (!charge && latest) charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : await stripe.charges.retrieve(latest);
  let invoiceLinked = false;
  if (!session && stripe.invoicePayments?.list) {
    const ip = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: piId }, limit: 1 });
    invoiceLinked = (ip?.data?.length ?? 0) > 0;
  }
  return { paymentIntent, session, charge, invoiceLinked };
}

async function matchRental(admin: Admin, id: OneOffIdentity): Promise<{ rental: RentalCandidate | null; by: "metadata" | "customer" | "email" | null; ambiguous: boolean }> {
  if (id.rentalId) {
    const found = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).eq("id", id.rentalId));
    const pick = pickRental(found, { explicit: true });
    if (pick.rental) return { rental: pick.rental, by: "metadata", ambiguous: false };
  }
  if (id.customerIds.length) {
    const candidates: RentalCandidate[] = [];
    candidates.push(...await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("stripe_customer_id", id.customerIds)));
    const apps = await rows<{ id: string }>(admin.from("applications").select("id").in("stripe_customer_id", id.customerIds));
    if (apps.length) candidates.push(...await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("application_id", apps.map((a) => a.id))));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "customer", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  for (const email of id.emails) {
    const apps = await rows<{ id: string }>(admin.from("applications").select("id").ilike("email", exactILike(email)));
    if (!apps.length) continue;
    const candidates = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("application_id", apps.map((a) => a.id)));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "email", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  return { rental: null, by: null, ambiguous: false };
}

/** One staff notice per intent, however many of the three events arrive. */
async function flagUnmatched(admin: Admin, id: OneOffIdentity, why: "no_match" | "ambiguous", warn?: (pi: any) => Promise<void>) {
  try {
    if (warn) await warn({ id: id.paymentIntentId, customer: id.customerIds[0] ?? null, amount: id.amountCents });
  } catch { /* a log line never fails the event */ }
  try {
    const prior = await admin.from("notifications").select("id").eq("title", UNMATCHED_TITLE).ilike("body", `%${exactILike(id.paymentIntentId)}%`).limit(1);
    if (prior?.data?.length) return;
    await admin.from("notifications").insert({ driver_id: null, title: UNMATCHED_TITLE, body: unmatchedBody(id, why), kind: "payment", read: false });
  } catch (err) {
    console.error("[one-off-payment] staff notice failed", err);
  }
}

export async function recordOneOffPayment(
  admin: Admin,
  stripe: StripeLike,
  input: { paymentIntentId: string | null; session?: any; charge?: any; paymentIntent?: any },
  opts: { warn?: (pi: any) => Promise<void> } = {},
): Promise<OneOffOutcome> {
  const piId = input.paymentIntentId;
  if (!piId) return { status: "skipped", why: "no_intent" };
  // Cheap checks before any Stripe read.
  if (appOwnsPayment({ session: input.session, paymentIntent: input.paymentIntent, charge: input.charge })) return { status: "skipped", why: "app_owned" };
  if (input.session && input.session.payment_status !== "paid") return { status: "skipped", why: "not_paid" };
  const existing = await rows(admin.from("payments").select("id").eq("stripe_payment_intent_id", piId).limit(1));
  if (existing.length) return { status: "skipped", why: "already_recorded" };

  const objs = await loadStripeObjects(stripe, piId, input);
  if (objs.paymentIntent?.status !== "succeeded") return { status: "skipped", why: "not_paid" };
  if (appOwnsPayment(objs)) return { status: "skipped", why: "app_owned" };
  // metadata.rentalId on the intent is the existing intent path's job.
  const piRental = objs.paymentIntent?.metadata?.rentalId ?? objs.paymentIntent?.metadata?.rental_id;
  if (piRental) return { status: "skipped", why: "app_owned" };

  const id = oneOffIdentity(objs);
  if (!id || id.amountCents <= 0) return { status: "skipped", why: "not_paid" };
  const match = await matchRental(admin, id);
  if (!match.rental || !match.by) {
    const why = match.ambiguous ? "ambiguous" : "no_match";
    await flagUnmatched(admin, id, why, opts.warn);
    return { status: "unmatched", why, identity: id };
  }
  const r = match.rental;
  const amount = id.amountCents / 100;
  const day = id.paidAt ? easternDateOf(id.paidAt) : easternDateOf(Math.floor(Date.now() / 1000));
  const via = [id.paymentLinkId && `payment link ${id.paymentLinkId}`, id.sessionId && `checkout ${id.sessionId}`].filter(Boolean).join(", ");
  const ins = must(await admin.from("payments").insert({
    rental_id: r.id,
    driver_id: r.application_id ?? null,
    vehicle_id: r.vehicle_id ?? null,
    type: oneOffRowType(id.reason),
    reason: (id.purpose ?? id.reason ?? "Stripe payment").slice(0, 200),
    amount,
    balance_due: 0,
    status: "paid",
    due_date: day,
    paid_date: day,
    payment_method: id.cardPayment ? "card" : null,
    stripe_payment_intent_id: id.paymentIntentId,
    stripe_charge_id: id.chargeId,
    stripe_customer_id: id.customerIds[0] ?? r.stripe_customer_id ?? null,
    stripe_paid_at: id.paidAt ? new Date(id.paidAt * 1000).toISOString() : null,
    stripe_receipt_url: id.receiptUrl,
    // Stripe already emailed its own receipt; the app sends none for these.
    notified_status: "paid",
    notes: `Recorded from Stripe${via ? ` (${via})` : ""}; matched by ${match.by}.`,
  }).select("id"));
  const inserted = (ins.data?.length ?? 0) > 0; // 0 when another event won the unique index
  if (inserted) {
    await admin.from("notifications").insert({
      driver_id: null, title: "Payment Received", kind: "payment", read: false,
      body: `$${amount.toFixed(2)} — ${(id.purpose ?? "Stripe payment").slice(0, 120)}`,
    }).then(() => {}, () => {});
  }
  return { status: "recorded", rentalId: r.id, by: match.by, inserted };
}
