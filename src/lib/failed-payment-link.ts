// The one rule for which link a renter gets after a declined weekly charge.
//
// Why this exists: on 11/9/2026 three renters had paid through the generic
// Stripe Payment Link (buy.stripe.com/...) that staff texted at pickup. That
// link is in subscription mode, so every use starts a NEW customer and a NEW
// weekly subscription. When a weekly charge later failed, renters reused the
// old link and ended up billed twice (Schrita, Damon).
//
// The rule: a renter with a subscription is only ever sent the hosted page of
// the invoice that actually failed (invoice.stripe.com/...). Paying it settles
// that week on the SAME subscription, and the page lets them use a new card.
// A generic payment link is never sent. No valid invoice link = no text.
// Client-safe and pure; nothing here sends.

const HOSTED_INVOICE = /^https:\/\/invoice\.stripe\.com\/i\/[A-Za-z0-9_]+\/[A-Za-z0-9_\-]+(\?[A-Za-z0-9_=&\-]*)?$/;
const GENERIC_LINK = /^https?:\/\/(buy\.stripe\.com|checkout\.stripe\.com|donate\.stripe\.com)\//i;

/** True only for a Stripe hosted invoice page. */
export function isHostedInvoiceUrl(url: unknown): url is string {
  return typeof url === "string" && url.length <= 600 && HOSTED_INVOICE.test(url.trim());
}

/** A Payment Link / Checkout URL: starts a new purchase (and, here, a new subscription). */
export function isGenericPaymentLink(url: unknown): boolean {
  return typeof url === "string" && GENERIC_LINK.test(url.trim());
}

/** The link to send for a failed invoice, or null when there is no safe one. */
export function failedInvoiceLink(invoice: { hosted_invoice_url?: unknown; status?: unknown } | null | undefined): string | null {
  if (!invoice) return null;
  if (invoice.status != null && invoice.status !== "open") return null; // void/paid/uncollectible: nothing to pay
  return isHostedInvoiceUrl(invoice.hosted_invoice_url) ? invoice.hosted_invoice_url.trim() : null;
}

function money(n: number): string {
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

/** The renter text. Plain, short, one link, and says not to use older links. */
export function failedPaymentSmsBody(args: { firstName?: string | null; amount: number; invoiceUrl: string }): string {
  const first = (args.firstName ?? "").trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first}, ` : "Hi, ";
  return (
    `${hi}this is REAL RENTALS. Your weekly rental payment of ${money(args.amount)} did not go through. ` +
    `Please pay this week's invoice here (you can use a different card): ${args.invoiceUrl} ` +
    `Please use only this link, not any older payment link, so you are not charged twice. Reply STOP to opt out.`
  );
}

/** 8 AM to 9 PM Eastern. Outside that, the text is skipped (the email still goes). */
export function withinTextingHours(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8 && hour < 21;
}

export function digitsOnly(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

export type RentalContact = {
  rentalId: string;
  applicationId: string | null;
  email: string | null;
  phone: string | null;
  stripeSubscriptionId: string | null;
};

export type SubscriptionMatch =
  | { kind: "link"; rentalId: string; applicationId: string | null }
  | { kind: "duplicate"; rentalId: string; applicationId: string | null; existingSubscriptionId: string }
  | { kind: "already" ; rentalId: string }
  | { kind: "none" }
  | { kind: "ambiguous"; rentalIds: string[] };

/**
 * Match a Stripe subscription (by its customer's email/phone) to one active
 * rental. Exactly one renter must match, else nothing is linked.
 *   link       the rental has no subscription yet → safe to link
 *   already    the rental already has this subscription
 *   duplicate  the rental already has a DIFFERENT subscription → alert staff
 */
export function matchSubscriptionToRental(
  customer: { email?: string | null; phone?: string | null },
  subscriptionId: string,
  rentals: RentalContact[],
): SubscriptionMatch {
  const email = (customer.email ?? "").trim().toLowerCase() || null;
  const phone = digitsOnly(customer.phone);
  if (!email && !phone) return { kind: "none" };
  const hits = rentals.filter((r) =>
    (email && (r.email ?? "").trim().toLowerCase() === email) || (phone && digitsOnly(r.phone) === phone),
  );
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", rentalIds: hits.map((h) => h.rentalId) };
  const hit = hits[0];
  if (!hit.stripeSubscriptionId) return { kind: "link", rentalId: hit.rentalId, applicationId: hit.applicationId };
  if (hit.stripeSubscriptionId === subscriptionId) return { kind: "already", rentalId: hit.rentalId };
  return { kind: "duplicate", rentalId: hit.rentalId, applicationId: hit.applicationId, existingSubscriptionId: hit.stripeSubscriptionId };
}
