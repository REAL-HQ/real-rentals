// One-off Stripe payments the app did not create: a Payment Link or a
// Checkout Session made in the Stripe Dashboard (or by FLEET), or a manual
// Dashboard charge. Before this, the webhook only wrote payments it created
// itself (metadata.paymentIds) or ones carrying metadata.rentalId, so a paid
// Payment Link with no metadata was received and silently dropped (Regina's
// $50, Nov 16 2026). Pure helpers; the database and Stripe reads live in
// one-off-payment.server.ts.
import { stripeId } from "@/lib/stripe-unmatched";

type Obj = Record<string, any> | null | undefined;

/** Everything the matcher can use, gathered from the session, intent and charge. */
export type OneOffIdentity = {
  paymentIntentId: string;
  chargeId: string | null;
  sessionId: string | null;
  paymentLinkId: string | null;
  rentalId: string | null;
  /** Distinct Stripe customer ids, most specific first. */
  customerIds: string[];
  /** Distinct lower-cased emails, most specific first. */
  emails: string[];
  amountCents: number;
  currency: string;
  /** Unix seconds the charge was created (falls back to the intent). */
  paidAt: number | null;
  purpose: string | null;
  reason: string | null;
  receiptUrl: string | null;
  cardPayment: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function uniq(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}

function meta(o: Obj): Record<string, unknown> {
  return o && typeof o.metadata === "object" && o.metadata ? o.metadata : {};
}

/** Metadata keys only the app's own payment flows write. */
const APP_KEYS = ["paymentIds", "applicationId", "agreementId"] as const;

/**
 * True when one of the app's own flows made this payment (collection runs,
 * initial payment, Reservation Fee) or the invoice path owns it. Those keep
 * their existing handlers; this module never writes them.
 */
export function appOwnsPayment(input: { session?: Obj; paymentIntent?: Obj; charge?: Obj; invoiceLinked?: boolean }): boolean {
  if (input.invoiceLinked) return true;
  const { session, paymentIntent, charge } = input;
  if (session && (session.mode !== "payment" || stripeId(session.subscription) || stripeId(session.invoice))) return true;
  for (const o of [session, paymentIntent, charge]) {
    const m = meta(o);
    if (APP_KEYS.some((k) => text(m[k]))) return true;
    if (m.reason === "reservation_fee") return true;
  }
  if (stripeId(paymentIntent?.invoice) || stripeId(charge?.invoice)) return true;
  const description = text(paymentIntent?.description) ?? text(charge?.description) ?? "";
  if (/^(subscription|invoice)\b/i.test(description)) return true;
  return false;
}

/** metadata.rentalId on the intent wins over the session (the existing intent path reads it). */
export function rentalIdOf(...objs: Obj[]): string | null {
  for (const o of objs) {
    const m = meta(o);
    const id = text(m.rentalId) ?? text(m.rental_id);
    if (id && UUID.test(id)) return id;
  }
  return null;
}

export function oneOffIdentity(input: { paymentIntent: Obj; session?: Obj; charge?: Obj }): OneOffIdentity | null {
  const { paymentIntent: pi, session, charge } = input;
  const paymentIntentId = stripeId(pi?.id) ?? stripeId(session?.payment_intent) ?? stripeId(charge?.payment_intent);
  if (!paymentIntentId) return null;
  const sm = meta(session), pm = meta(pi), cm = meta(charge);
  const metaCustomer = (m: Record<string, unknown>) => {
    const c = text(m.customer) ?? text(m.customerId) ?? text(m.stripe_customer_id);
    return c && c.startsWith("cus_") ? c : null;
  };
  const customerIds = uniq([
    metaCustomer(pm), metaCustomer(sm), metaCustomer(cm),
    stripeId(session?.customer), stripeId(pi?.customer), stripeId(charge?.customer),
  ]);
  const emails = uniq([
    text(sm.email), text(pm.email),
    text(session?.customer_details?.email), text(session?.customer_email),
    text(charge?.billing_details?.email), text(pi?.receipt_email), text(charge?.receipt_email),
  ].map((e) => (e ? e.toLowerCase() : null)).filter((e) => !!e && EMAIL.test(e)));
  const amount = Number(charge?.amount_captured ?? pi?.amount_received ?? session?.amount_total ?? pi?.amount ?? 0);
  const paidAt = Number(charge?.created ?? pi?.created ?? session?.created);
  return {
    paymentIntentId,
    chargeId: stripeId(charge?.id) ?? stripeId(pi?.latest_charge),
    sessionId: stripeId(session?.id),
    paymentLinkId: stripeId(session?.payment_link),
    rentalId: rentalIdOf(pi, session, charge),
    customerIds,
    emails,
    amountCents: Number.isFinite(amount) ? Math.round(amount) : 0,
    currency: text(charge?.currency) ?? text(pi?.currency) ?? text(session?.currency) ?? "usd",
    paidAt: Number.isFinite(paidAt) && paidAt > 0 ? paidAt : null,
    purpose: text(sm.purpose) ?? text(pm.purpose) ?? text(cm.purpose) ?? text(pi?.description) ?? null,
    reason: text(pm.reason) ?? text(sm.reason) ?? text(cm.reason),
    receiptUrl: text(charge?.receipt_url),
    cardPayment: (charge?.payment_method_details?.type ?? null) === "card",
  };
}

const ROW_TYPES = new Set(["rent", "deposit", "late_fee", "toll", "damage", "fee"]);

/** payments.type for a one-off payment: a known reason keeps its type, anything else is a fee. */
export function oneOffRowType(reason: string | null): "rent" | "deposit" | "late_fee" | "toll" | "damage" | "fee" {
  return reason && ROW_TYPES.has(reason) ? (reason as any) : "fee";
}

export type RentalCandidate = { id: string; application_id: string | null; vehicle_id: string | null; status: string | null; stripe_customer_id?: string | null };

/**
 * Exactly one rental, or nothing. An explicit metadata.rentalId may point at
 * any rental; a customer or email match only counts active rentals.
 */
export function pickRental(candidates: RentalCandidate[], opts: { explicit: boolean }): { rental: RentalCandidate | null; ambiguous: boolean } {
  const byId = new Map<string, RentalCandidate>();
  for (const c of candidates) if (opts.explicit || c.status === "active") byId.set(c.id, c);
  const rows = [...byId.values()];
  if (rows.length === 1) return { rental: rows[0], ambiguous: false };
  return { rental: null, ambiguous: rows.length > 1 };
}

/** Escape LIKE wildcards so an email is matched exactly (case-insensitive). */
export function exactILike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const UNMATCHED_TITLE = "Unmatched Stripe Payment";

export function unmatchedBody(id: OneOffIdentity, why: "no_match" | "ambiguous"): string {
  const amount = `$${(id.amountCents / 100).toFixed(2)}`;
  const via = id.paymentLinkId ? `payment link ${id.paymentLinkId}` : id.sessionId ? `checkout ${id.sessionId}` : "a Stripe charge";
  const reason = why === "ambiguous" ? "matches more than one rental" : "matches no rental";
  return `${amount} paid via ${via} (${id.paymentIntentId}) ${reason}. Record it from Payments or ask the renter.`;
}
