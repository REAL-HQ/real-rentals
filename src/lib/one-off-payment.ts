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
  /**
   * Renter application / lead ids from metadata (lead_id, leadId,
   * application_id). Payment Links cannot set a Stripe customer, so FLEET's
   * daily links carry these instead (Dolmar, Nov 21 2026: every payment link
   * must always link to the renter).
   */
  applicationIds: string[];
  /** Normalized plates from metadata (plate, vehicle, license_plate). */
  plates: string[];
  /** The day a daily-rent link pays for (metadata for_date / date), YYYY-MM-DD. */
  forDate: string | null;
  /** Renter name from metadata, for the staff notice only. */
  renterName: string | null;
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

/** Lead / application ids from metadata, in object order. applicationId is an app key and never reaches here. */
export function applicationIdsOf(...objs: Obj[]): string[] {
  const out: (string | null)[] = [];
  for (const o of objs) {
    const m = meta(o);
    for (const k of ["lead_id", "leadId", "application_id"]) {
      const v = text(m[k]);
      out.push(v && UUID.test(v) ? v.toLowerCase() : null);
    }
  }
  return uniq(out);
}

/** A plate as stored on vehicles: letters and digits, upper case. */
export function normalizePlate(value: unknown): string | null {
  const t = text(value);
  if (!t) return null;
  const p = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return p.length >= 4 && p.length <= 10 ? p : null;
}

export function platesOf(...objs: Obj[]): string[] {
  const out: (string | null)[] = [];
  for (const o of objs) {
    const m = meta(o);
    for (const k of ["plate", "license_plate", "vehicle_plate", "vehicle"]) out.push(normalizePlate(m[k]));
  }
  return uniq(out);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day a link pays for: for_date (preferred) or date, as YYYY-MM-DD. */
export function forDateOf(...objs: Obj[]): string | null {
  for (const o of objs) {
    const m = meta(o);
    for (const k of ["for_date", "forDate", "rent_date", "date"]) {
      const v = text(m[k]);
      if (v && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return v;
    }
  }
  return null;
}

export function oneOffIdentity(input: { paymentIntent: Obj; session?: Obj; charge?: Obj; paymentLink?: Obj }): OneOffIdentity | null {
  const { paymentIntent: pi, session, charge, paymentLink: link } = input;
  const paymentIntentId = stripeId(pi?.id) ?? stripeId(session?.payment_intent) ?? stripeId(charge?.payment_intent);
  if (!paymentIntentId) return null;
  const sm = meta(session), pm = meta(pi), cm = meta(charge), lm = meta(link);
  const metaCustomer = (m: Record<string, unknown>) => {
    const c = text(m.customer) ?? text(m.customerId) ?? text(m.stripe_customer_id);
    return c && c.startsWith("cus_") ? c : null;
  };
  const customerIds = uniq([
    metaCustomer(pm), metaCustomer(sm), metaCustomer(cm), metaCustomer(lm),
    stripeId(session?.customer), stripeId(pi?.customer), stripeId(charge?.customer),
  ]);
  const emails = uniq([
    text(sm.email), text(pm.email), text(lm.email),
    text(session?.customer_details?.email), text(session?.customer_email),
    text(charge?.billing_details?.email), text(pi?.receipt_email), text(charge?.receipt_email),
  ].map((e) => (e ? e.toLowerCase() : null)).filter((e) => !!e && EMAIL.test(e)));
  const amount = Number(charge?.amount_captured ?? pi?.amount_received ?? session?.amount_total ?? pi?.amount ?? 0);
  const paidAt = Number(charge?.created ?? pi?.created ?? session?.created);
  return {
    paymentIntentId,
    chargeId: stripeId(charge?.id) ?? stripeId(pi?.latest_charge),
    sessionId: stripeId(session?.id),
    paymentLinkId: stripeId(session?.payment_link) ?? stripeId(link?.id),
    rentalId: rentalIdOf(pi, session, charge, link),
    applicationIds: applicationIdsOf(pi, session, charge, link),
    plates: platesOf(pi, session, charge, link),
    forDate: forDateOf(pi, session, charge, link),
    renterName: text(pm.renter) ?? text(sm.renter) ?? text(lm.renter) ?? text(cm.renter),
    customerIds,
    emails,
    amountCents: Number.isFinite(amount) ? Math.round(amount) : 0,
    currency: text(charge?.currency) ?? text(pi?.currency) ?? text(session?.currency) ?? "usd",
    paidAt: Number.isFinite(paidAt) && paidAt > 0 ? paidAt : null,
    purpose: text(sm.purpose) ?? text(pm.purpose) ?? text(cm.purpose) ?? text(lm.purpose) ?? text(pi?.description) ?? null,
    reason: text(pm.reason) ?? text(sm.reason) ?? text(cm.reason) ?? text(lm.reason),
    receiptUrl: text(charge?.receipt_url),
    cardPayment: (charge?.payment_method_details?.type ?? null) === "card",
  };
}

const ROW_TYPES = new Set(["rent", "deposit", "late_fee", "toll", "damage", "fee"]);

/**
 * payments.type for a one-off payment: a known reason keeps its type. With no
 * reason, a payment from a renter on an active rental is rent (Dolmar, Nov 19
 * 2026: Payment Links FLEET sends for rent, including $50/day, were landing as
 * Fee, so Schrita's $350 never settled her week). Anything else is a fee.
 */
export function oneOffRowType(
  reason: string | null,
  ctx: { activeRental?: boolean } = {},
): "rent" | "deposit" | "late_fee" | "toll" | "damage" | "fee" {
  if (reason && ROW_TYPES.has(reason)) return reason as any;
  if (!reason && ctx.activeRental) return "rent";
  return "fee";
}

/**
 * The week a rent payment pays for: the oldest open rent row still owed that
 * is due on or before the payment day (within 21 days), else the payment day.
 * Daily-plan rentals keep the payment day (each payment pays the next day owed).
 */
export function rentWeekFor(paidOn: string, openRentDues: string[], opts: { dailyPlan?: boolean; forDate?: string | null } = {}): string {
  if (opts.dailyPlan) return dailyDueFor(paidOn, opts.forDate ?? null);
  const floor = new Date(`${paidOn}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - 21);
  const min = floor.toISOString().slice(0, 10);
  const candidates = openRentDues.filter((d) => d <= paidOn && d >= min).sort();
  return candidates[0] ?? paidOn;
}

/**
 * The day a daily-rent payment pays for. A link made for Nov 20 and paid at
 * 12:31 AM ET Nov 21 pays Nov 20, not Nov 21 (Regina, Nov 21 2026). The link's
 * date counts when it is from 7 days before to 1 day after the payment day;
 * otherwise the payment day.
 */
export function dailyDueFor(paidOn: string, forDate: string | null): string {
  if (!forDate) return paidOn;
  const diff = (Date.parse(`${paidOn}T00:00:00Z`) - Date.parse(`${forDate}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(diff) && diff >= -1 && diff <= 7 ? forDate : paidOn;
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
  const hint = [id.renterName && `renter ${id.renterName}`, id.plates[0] && `plate ${id.plates[0]}`].filter(Boolean).join(", ");
  return `${amount} paid via ${via} (${id.paymentIntentId}) ${reason}${hint ? ` (${hint})` : ""}. Record it from Payments or ask the renter.`;
}
