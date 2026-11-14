// Stripe ↔ rental linking rules. Pure and client-safe: nothing here reads a
// database or calls Stripe. The server half is stripe-link.server.ts.
//
// One renter = one Stripe customer, saved on applications.stripe_customer_id at
// approval and copied to the rental at activation. Every checkout, invoice and
// subscription the app creates carries that customer plus applicationId /
// rentalId metadata, so a Stripe object is matched to its rental in this order:
//   1. metadata      rentalId, then applicationId (also application_id)
//   2. customer id   rentals.stripe_customer_id or the application's
//   3. contact       email or phone (Subscription Matching switch, existing)
// Exactly one active rental must match at a step, otherwise that step matches
// nothing. A rental that already has a different subscription is never
// overwritten (reported as "duplicate").
import { addDaysIso, dayDiff, easternDateOf } from "@/lib/rent-reminders";

export type LinkCandidate = {
  rentalId: string;
  applicationId: string | null;
  stripeCustomerId: string | null;
  applicationStripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

export type StripeRef = {
  metadata?: Record<string, unknown> | null;
  clientReferenceId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
};

export type LinkMatch =
  | { kind: "link"; rentalId: string; applicationId: string | null; by: "metadata" | "customer" }
  | { kind: "already"; rentalId: string; applicationId: string | null; by: "metadata" | "customer" }
  | { kind: "duplicate"; rentalId: string; applicationId: string | null; by: "metadata" | "customer"; existingSubscriptionId: string }
  | { kind: "ambiguous"; by: "metadata" | "customer"; rentalIds: string[] }
  | { kind: "none" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** rentalId / applicationId from Stripe metadata (camelCase or snake_case) and client_reference_id. */
export function metadataIds(ref: StripeRef): { rentalId: string | null; applicationId: string | null } {
  const m = (ref.metadata ?? {}) as Record<string, unknown>;
  return {
    rentalId: str(m.rentalId) ?? str(m.rental_id) ?? str(ref.clientReferenceId),
    applicationId: str(m.applicationId) ?? str(m.application_id),
  };
}

function settle(hits: LinkCandidate[], by: "metadata" | "customer", subscriptionId: string | null): LinkMatch | null {
  if (hits.length === 0) return null;
  if (hits.length > 1) return { kind: "ambiguous", by, rentalIds: hits.map((h) => h.rentalId) };
  const hit = hits[0];
  const base = { rentalId: hit.rentalId, applicationId: hit.applicationId, by };
  if (!subscriptionId || !hit.stripeSubscriptionId) return { kind: "link", ...base };
  if (hit.stripeSubscriptionId === subscriptionId) return { kind: "already", ...base };
  return { kind: "duplicate", ...base, existingSubscriptionId: hit.stripeSubscriptionId };
}

/** Match a Stripe object to one active rental by metadata, then customer id. Contact matching stays in failed-payment-link.ts. */
export function matchStripeToRental(ref: StripeRef, rentals: LinkCandidate[]): LinkMatch {
  const sub = str(ref.subscriptionId);
  const ids = metadataIds(ref);
  if (ids.rentalId) {
    const r = settle(rentals.filter((x) => x.rentalId === ids.rentalId), "metadata", sub);
    if (r) return r;
  }
  if (ids.applicationId) {
    const r = settle(rentals.filter((x) => x.applicationId === ids.applicationId), "metadata", sub);
    if (r) return r;
  }
  const cus = str(ref.customerId);
  if (cus) {
    const r = settle(rentals.filter((x) => x.stripeCustomerId === cus || x.applicationStripeCustomerId === cus), "customer", sub);
    if (r) return r;
  }
  return { kind: "none" };
}

// ------------------------------------------------------------------ invoices

export type PaidInvoice = {
  id: string;
  customerId: string | null;
  customerEmail: string | null;
  subscriptionId: string | null;
  amountPaid: number; // dollars
  createdOn: string; // ET date the invoice was created (the week it bills)
  paidOn: string | null; // ET date it was paid
};

/** Normalise a Stripe invoice. Null unless it is paid with money actually collected. */
export function paidInvoiceOf(invoice: any): PaidInvoice | null {
  if (!invoice || invoice.status !== "paid") return null;
  const amountPaid = Number(invoice.amount_paid ?? 0) / 100;
  if (!(amountPaid > 0)) return null;
  const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const rawSub = typeof invoice.subscription === "string" ? invoice.subscription
    : invoice.subscription?.id ?? invoice.parent?.subscription_details?.subscription ?? null;
  const paidAt = Number(invoice.status_transitions?.paid_at ?? 0);
  const created = Number(invoice.created ?? 0);
  if (!created) return null;
  return {
    id: String(invoice.id),
    customerId: customer,
    customerEmail: invoice.customer_email ?? null,
    subscriptionId: typeof rawSub === "string" ? rawSub : null,
    amountPaid: Math.round(amountPaid * 100) / 100,
    createdOn: easternDateOf(created),
    paidOn: paidAt ? easternDateOf(paidAt) : null,
  };
}

/**
 * The payments row the webhook writes for a paid invoice (same shape, so the
 * unique stripe_invoice_id index makes imports and webhook replays no-ops).
 * notified_status "paid" means an import never triggers a receipt email.
 */
export function paymentRowForPaidInvoice(
  inv: PaidInvoice,
  rental: { id: string; application_id: string | null; vehicle_id: string | null },
): Record<string, unknown> {
  return {
    rental_id: rental.id,
    driver_id: rental.application_id,
    vehicle_id: rental.vehicle_id ?? null,
    amount: inv.amountPaid,
    balance_due: 0,
    type: "rent",
    reason: "rent",
    status: "paid",
    due_date: inv.createdOn,
    paid_date: inv.paidOn ?? inv.createdOn,
    stripe_invoice_id: inv.id,
    stripe_subscription_id: inv.subscriptionId,
    notified_status: "paid",
  };
}

/** Days before a due date that an early payment still counts for that week. */
export const EARLY_PAYMENT_DAYS = 2;

/**
 * True when a paid rent amount was billed for the week starting dueDate:
 * created from EARLY_PAYMENT_DAYS before the due date through 6 days after,
 * and at least the weekly rate.
 */
export function coversWeek(p: { createdOn: string | null; amount: number }, dueDate: string, weeklyRate: number): boolean {
  if (!p.createdOn || !(weeklyRate > 0)) return false;
  const d = dayDiff(dueDate, p.createdOn);
  return d >= -EARLY_PAYMENT_DAYS && d <= 6 && p.amount + 0.005 >= weeklyRate;
}

/**
 * next_payment_due after importing paid weeks: one week after the latest paid
 * week that covers the rate, never earlier than the current due date.
 */
export function nextDueAfterPaidWeeks(currentDue: string | null, paid: { createdOn: string; amount: number }[], weeklyRate: number): string | null {
  let latest: string | null = null;
  for (const p of paid) {
    if (!(weeklyRate > 0) || p.amount + 0.005 < weeklyRate) continue;
    if (latest == null || p.createdOn > latest) latest = p.createdOn;
  }
  if (!latest) return currentDue;
  const next = addDaysIso(latest, 7);
  return currentDue && currentDue > next ? currentDue : next;
}

// ------------------------------------------------------------ reconciliation

export type ReconcileInput = {
  invoices: PaidInvoice[];
  recordedInvoiceIds: Set<string>;
  /** Customer ids linked to an active rental (rental's or its application's). */
  activeCustomerIds: Set<string>;
  /** Customer ids linked to any rental at all (closed rentals are fine to be "unlinked" from active). */
  knownCustomerIds: Set<string>;
};

export type ReconcileReport = {
  missing: PaidInvoice[];
  unlinkedCustomers: { customerId: string; email: string | null; invoiceIds: string[] }[];
};

/**
 * Paid invoices with no payments row, and customers with paid invoices that no
 * rental knows about. A customer on a closed rental is not flagged.
 */
export function reconcileStripeLinks(input: ReconcileInput): ReconcileReport {
  const missing = input.invoices.filter((i) => !input.recordedInvoiceIds.has(i.id));
  const byCustomer = new Map<string, { customerId: string; email: string | null; invoiceIds: string[] }>();
  for (const inv of input.invoices) {
    const c = inv.customerId;
    if (!c || input.activeCustomerIds.has(c) || input.knownCustomerIds.has(c)) continue;
    const e = byCustomer.get(c) ?? { customerId: c, email: inv.customerEmail, invoiceIds: [] };
    e.invoiceIds.push(inv.id);
    byCustomer.set(c, e);
  }
  return { missing, unlinkedCustomers: [...byCustomer.values()] };
}

export function reconcileReportIsEmpty(r: ReconcileReport): boolean {
  return r.missing.length === 0 && r.unlinkedCustomers.length === 0;
}
