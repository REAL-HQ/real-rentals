/**
 * Staff Payments section on a renter's back-office profile.
 *
 * Pure helpers for Stripe receipt fields, renter matching, and display rows.
 * The webhook and the one-time backfill both use these so a replay and a
 * backfill cannot disagree about identity or links.
 */

import { easternDateOf } from "@/lib/rent-reminders";

export type PaymentReceiptFields = {
  stripe_invoice_id: string | null;
  stripe_invoice_number: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf_url: string | null;
  stripe_receipt_url: string | null;
  stripe_charge_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_subscription_id: string | null;
  stripe_paid_at: string | null;
};

export type RentalMatchRow = {
  id: string;
  application_id: string | null;
  vehicle_id: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  updated_at?: string | null;
  start_date?: string | null;
};

export type ApplicationMatchRow = {
  id: string;
  stripe_customer_id?: string | null;
};

export type PriorPaymentMatchRow = {
  rental_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

export type PaymentMatch = {
  rentalId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  /** How the renter was chosen, for the dry-run and staff unmatched list. */
  via: "subscription" | "customer_rental" | "customer_application" | "application_metadata" | "prior_payment" | "unmatched";
  /** More than one renter or rental could claim this payment. */
  ambiguous: boolean;
  reason?: string;
  invoiceSubscriptionId?: string | null;
  rentalSubscriptionId?: string | null;
};

export type StripePaymentIdentity = {
  invoiceId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  applicationId?: string | null;
};

export type RenterPaymentListItem = {
  id: string;
  paidDate: string | null;
  paidAt: string | null;
  amount: number;
  invoiceNumber: string | null;
  receiptUrl: string | null;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  status: string;
  rentalId: string | null;
  unmatched: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (value && typeof value === "object" && "id" in value) return text((value as { id?: unknown }).id);
  return null;
}

function unixToIso(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Subscription id from a classic or 2026-style Stripe invoice. */
export function subscriptionIdOf(invoice: any): string | null {
  if (!invoice || typeof invoice !== "object") return null;
  const raw = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  return idOf(raw);
}

export function applicationIdOf(invoice: any): string | null {
  const meta = invoice?.metadata?.application_id ?? invoice?.lines?.data?.[0]?.metadata?.application_id;
  return isUuid(meta) ? meta : null;
}

export function paymentIntentIdOf(invoice: any): string | null {
  return idOf(invoice?.payment_intent);
}

/**
 * Locate a charge (or pay_ object) and its receipt URL from an invoice or
 * payment-intent payload, including expanded objects and 2026 invoice payments.
 */
export function extractPaymentReceiptFields(invoice: any, charge?: any): PaymentReceiptFields {
  const chargeObj = coerceCharge(charge) ?? coerceCharge(invoice);
  const paidAt =
    unixToIso(invoice?.status_transitions?.paid_at) ??
    unixToIso(chargeObj?.created) ??
    unixToIso(invoice?.created);
  return {
    stripe_invoice_id: text(invoice?.id) && String(invoice.id).startsWith("in_") ? String(invoice.id) : null,
    stripe_invoice_number: text(invoice?.number),
    stripe_hosted_invoice_url: text(invoice?.hosted_invoice_url),
    stripe_invoice_pdf_url: text(invoice?.invoice_pdf),
    stripe_receipt_url: text(chargeObj?.receipt_url) ?? receiptUrlFrom(invoice),
    stripe_charge_id: idOf(chargeObj) ?? chargeIdFrom(invoice),
    stripe_customer_id: idOf(invoice?.customer) ?? idOf(chargeObj?.customer),
    stripe_payment_intent_id: paymentIntentIdOf(invoice) ?? idOf(chargeObj?.payment_intent),
    stripe_subscription_id: subscriptionIdOf(invoice),
    stripe_paid_at: paidAt,
  };
}

function receiptUrlFrom(invoice: any): string | null {
  return (
    text(invoice?.receipt_url) ??
    text(coerceCharge(invoice?.charge)?.receipt_url) ??
    text(coerceCharge(invoice?.latest_charge)?.receipt_url) ??
    text(firstInvoicePaymentCharge(invoice)?.receipt_url) ??
    null
  );
}

function chargeIdFrom(invoice: any): string | null {
  return (
    idOf(invoice?.charge) ??
    idOf(invoice?.latest_charge) ??
    idOf(firstInvoicePaymentCharge(invoice)) ??
    null
  );
}

function firstInvoicePaymentCharge(invoice: any): any | null {
  const payments = invoice?.payments?.data ?? invoice?.invoice_payments?.data;
  if (!Array.isArray(payments)) return null;
  for (const row of payments) {
    const payment = row?.payment ?? row;
    const charge = payment?.charge ?? payment?.payment_intent?.latest_charge;
    if (charge) return coerceCharge(charge) ?? charge;
  }
  return null;
}

function coerceCharge(value: unknown): any | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.startsWith("ch_") || value.startsWith("py_")) return { id: value };
    return null;
  }
  if (typeof value === "object") {
    const obj = value as any;
    if (obj.object === "charge" || (typeof obj.id === "string" && (obj.id.startsWith("ch_") || obj.id.startsWith("py_")))) {
      return obj;
    }
    if (obj.latest_charge) return coerceCharge(obj.latest_charge);
    if (obj.charges?.data?.[0]) return coerceCharge(obj.charges.data[0]);
  }
  return null;
}

function preferredRental(rows: RentalMatchRow[]): { rental: RentalMatchRow | null; ambiguous: boolean } {
  if (rows.length === 0) return { rental: null, ambiguous: false };
  if (rows.length === 1) return { rental: rows[0], ambiguous: false };
  const driverIds = new Set(rows.map((row) => row.application_id).filter(Boolean));
  if (driverIds.size > 1) return { rental: null, ambiguous: true };
  const active = rows.filter((row) => (row.status ?? "").toLowerCase() === "active");
  const pool = active.length === 1 ? active : active.length > 1 ? active : rows;
  if (pool.length === 1) return { rental: pool[0], ambiguous: false };
  const sorted = [...pool].sort((a, b) => String(b.start_date ?? b.updated_at ?? "").localeCompare(String(a.start_date ?? a.updated_at ?? "")));
  // Same renter, more than one rental: attach to the latest, flag for staff.
  return { rental: sorted[0] ?? null, ambiguous: true };
}

/**
 * Decide which renter and rental a Stripe payment belongs to.
 * Priority: subscription on a rental, then customer on a rental, then a prior
 * stored payment for that customer or subscription, then the application's
 * Stripe customer, then invoice metadata.application_id. Ambiguous matches
 * are not assigned a rental (or a driver, when two people share the ids).
 */
export function matchRenterPayment(
  identity: StripePaymentIdentity,
  input: {
    rentals: RentalMatchRow[];
    applications: ApplicationMatchRow[];
    priorPayments?: PriorPaymentMatchRow[];
  },
): PaymentMatch {
  const subscriptionId = text(identity.subscriptionId);
  const customerId = text(identity.customerId);
  const applicationId = isUuid(identity.applicationId) ? identity.applicationId : null;

  const finish = (match: PaymentMatch): PaymentMatch => ({
    ...match,
    invoiceSubscriptionId: subscriptionId,
    rentalSubscriptionId: match.rentalId
      ? (input.rentals.find((row) => row.id === match.rentalId)?.stripe_subscription_id ?? null)
      : null,
  });

  if (subscriptionId) {
    const hits = input.rentals.filter((row) => row.stripe_subscription_id === subscriptionId);
    const picked = preferredRental(hits);
    if (picked.ambiguous && !picked.rental) {
      return finish({ rentalId: null, driverId: null, vehicleId: null, via: "subscription", ambiguous: true, reason: "Multiple rentals share this subscription" });
    }
    if (picked.rental) {
      return finish({
        rentalId: picked.rental.id,
        driverId: picked.rental.application_id,
        vehicleId: picked.rental.vehicle_id,
        via: "subscription",
        ambiguous: picked.ambiguous,
      });
    }
  }

  if (customerId) {
    const hits = input.rentals.filter((row) => row.stripe_customer_id === customerId);
    const picked = preferredRental(hits);
    if (picked.ambiguous && !picked.rental) {
      return finish({ rentalId: null, driverId: null, vehicleId: null, via: "customer_rental", ambiguous: true, reason: "Multiple renters share this customer" });
    }
    if (picked.rental) {
      return finish({
        rentalId: picked.rental.id,
        driverId: picked.rental.application_id,
        vehicleId: picked.rental.vehicle_id,
        via: "customer_rental",
        ambiguous: picked.ambiguous,
      });
    }
  }

  const prior = (input.priorPayments ?? []).find((row) => {
    if (customerId && row.stripe_customer_id === customerId && (row.rental_id || row.driver_id)) return true;
    if (subscriptionId && row.stripe_subscription_id === subscriptionId && (row.rental_id || row.driver_id)) return true;
    return false;
  });
  if (prior) {
    return finish({
      rentalId: prior.rental_id,
      driverId: prior.driver_id,
      vehicleId: prior.vehicle_id,
      via: "prior_payment",
      ambiguous: false,
    });
  }

  if (customerId) {
    const apps = input.applications.filter((row) => row.stripe_customer_id === customerId);
    if (apps.length > 1) {
      return finish({ rentalId: null, driverId: null, vehicleId: null, via: "customer_application", ambiguous: true, reason: "Multiple applications share this customer" });
    }
    if (apps.length === 1) {
      const rentalsForApp = input.rentals.filter((row) => row.application_id === apps[0].id);
      const picked = preferredRental(rentalsForApp);
      return finish({
        rentalId: picked.rental?.id ?? null,
        driverId: apps[0].id,
        vehicleId: picked.rental?.vehicle_id ?? null,
        via: "customer_application",
        ambiguous: picked.ambiguous,
      });
    }
  }

  if (applicationId) {
    const app = input.applications.find((row) => row.id === applicationId) ?? { id: applicationId };
    const rentalsForApp = input.rentals.filter((row) => row.application_id === applicationId);
    const picked = preferredRental(rentalsForApp);
    return finish({
      rentalId: picked.rental?.id ?? null,
      driverId: app.id,
      vehicleId: picked.rental?.vehicle_id ?? null,
      via: "application_metadata",
      ambiguous: picked.ambiguous,
    });
  }

  return finish({ rentalId: null, driverId: null, vehicleId: null, via: "unmatched", ambiguous: false, reason: "No rental or application matched this customer or subscription" });
}

/** Paid_date for a Stripe invoice in America/New_York, matching rent-reminder weeks. */
export function paidDateOf(invoice: any, fields: PaymentReceiptFields = extractPaymentReceiptFields(invoice)): string {
  if (fields.stripe_paid_at) {
    const unix = Math.floor(Date.parse(fields.stripe_paid_at) / 1000);
    if (Number.isFinite(unix) && unix > 0) return easternDateOf(unix);
  }
  if (invoice?.status_transitions?.paid_at) return easternDateOf(Number(invoice.status_transitions.paid_at));
  if (invoice?.created) return easternDateOf(Number(invoice.created));
  return easternDateOf(Math.floor(Date.now() / 1000));
}

export function dueDateOf(invoice: any): string {
  if (invoice?.created) return easternDateOf(Number(invoice.created));
  if (invoice?.period_start) return new Date(Number(invoice.period_start) * 1000).toISOString().slice(0, 10);
  return paidDateOf(invoice);
}

/** Receipt emails and renter notices stay limited to a matched rental, as before. */
export function shouldNotifyRenter(match: PaymentMatch): boolean {
  if (!match.rentalId || match.ambiguous) return false;
  // A payment on a different subscription than the rental currently points at
  // is still stored on the renter, but must not send receipts, failure texts,
  // or move rental.payment_status. That covers a historical sub and a second
  // live subscription (staff already get the duplicate-subscription alert).
  if (match.invoiceSubscriptionId && match.rentalSubscriptionId
      && match.invoiceSubscriptionId !== match.rentalSubscriptionId) {
    return false;
  }
  return true;
}

export function isSuccessfulPaymentAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

export function formatPaymentDateEt(isoDate: string | null, isoTimestamp?: string | null): string {
  if (isoTimestamp) {
    const date = new Date(isoTimestamp);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
    }
  }
  if (!isoDate) return "—";
  const date = new Date(`${isoDate}T12:00:00-05:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatPaymentAmount(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function toRenterPaymentListItem(row: {
  id: string;
  paid_date?: string | null;
  stripe_paid_at?: string | null;
  amount?: number | null;
  stripe_invoice_number?: string | null;
  stripe_receipt_url?: string | null;
  stripe_hosted_invoice_url?: string | null;
  stripe_invoice_pdf_url?: string | null;
  status?: string | null;
  rental_id?: string | null;
  driver_id?: string | null;
}): RenterPaymentListItem {
  return {
    id: row.id,
    paidDate: row.paid_date ?? null,
    paidAt: row.stripe_paid_at ?? null,
    amount: Number(row.amount ?? 0),
    invoiceNumber: row.stripe_invoice_number ?? null,
    receiptUrl: row.stripe_receipt_url ?? null,
    invoiceUrl: row.stripe_hosted_invoice_url ?? null,
    invoicePdfUrl: row.stripe_invoice_pdf_url ?? null,
    status: String(row.status ?? ""),
    rentalId: row.rental_id ?? null,
    unmatched: !row.rental_id && !row.driver_id,
  };
}

export function visibleRenterPayments<T extends { amount?: number | null; status?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => isSuccessfulPaymentAmount(Number(row.amount ?? 0)) && ["paid", "refunded"].includes(String(row.status ?? "").toLowerCase()));
}
