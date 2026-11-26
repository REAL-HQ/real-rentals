// Required Stripe metadata for every charge the site or the FLEET API creates.
// Pure: no Stripe client and no database. Callers stamp the same object onto
// every metadata slot Stripe actually supports for that object.
//
// Required keys (both slots, when the object has both):
//   rental_id, lead_id, reason, for_date, renter, plate
//
// Nuance — pre-rental charges (Reservation Fee, initial payment Checkout):
//   A rental row often does not exist yet. rental_id may be omitted.
//   plate may be omitted only when no vehicle plate is on file
//   (allowBlankPlate). lead_id, reason, for_date and renter are still required.
//   The webhook still settles these by metadata.paymentIds / reason
//   reservation_fee. Do not use this allowance for an active rental.
//
// Nuance — card setup Checkout (mode "setup"):
//   Not a charge. CARD_SETUP_NOT_A_CHARGE marks those call sites. They do not
//   carry charge metadata.
//
// Nuance — subscriptions:
//   Stripe subscription create has no payment_intent_data. subscription.metadata
//   is the supported field. Invoice webhooks already merge
//   parent.subscription_details.metadata with invoice.metadata.
//
// Nuance — invoices:
//   Invoice create has no payment_intent_data. invoice.metadata is required.
//   After finalize, stampInvoicePaymentIntent copies the same object onto the
//   PaymentIntent when Stripe has created one.

export const CHARGE_METADATA_KEYS = ["rental_id", "lead_id", "reason", "for_date", "renter", "plate"] as const;
export type ChargeMetadataKey = (typeof CHARGE_METADATA_KEYS)[number];

/** Marker so a setup-mode Checkout is not treated as a charge. */
export const CARD_SETUP_NOT_A_CHARGE = "card_setup";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class StripeMetadataError extends Error {
  readonly missing: string[];
  readonly allowance: "rental" | "pre_rental";
  constructor(missing: string[], allowance: "rental" | "pre_rental") {
    const list = missing.join(", ");
    const nuance =
      allowance === "pre_rental"
        ? " A pre-rental Reservation Fee or initial payment may omit rental_id, and may omit plate only when no vehicle plate is on file."
        : " Active rental charges require every field.";
    super(
      `Stripe payment is missing required metadata: ${list}. ` +
        `Put rental_id, lead_id, reason, for_date, renter and plate on metadata and on payment_intent_data.metadata (or the metadata field Stripe supports for that object).` +
        nuance,
    );
    this.name = "StripeMetadataError";
    this.missing = missing;
    this.allowance = allowance;
  }
}

export type ChargeMetadataAllowance =
  | { kind: "rental" }
  | { kind: "pre_rental"; allowBlankPlate?: boolean };

export type ChargeMetadataInput = {
  rentalId?: string | null;
  leadId?: string | null;
  reason?: string | null;
  forDate?: string | null;
  renter?: string | null;
  plate?: string | null;
};

function clean(value: unknown, max = 500): string {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

/** Plate letters and digits only. Too short or too long is treated as missing. */
export function chargePlate(value: unknown): string {
  const plate = clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return plate.length >= 2 && plate.length <= 10 ? plate : "";
}

export function easternDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function missingChargeMetadata(meta: Record<string, unknown> | null | undefined, allowance: ChargeMetadataAllowance): ChargeMetadataKey[] {
  const m = meta ?? {};
  const present = (key: ChargeMetadataKey) => clean(m[key]).length > 0;
  const missing: ChargeMetadataKey[] = [];
  if (allowance.kind === "rental" && !present("rental_id")) missing.push("rental_id");
  if (!present("lead_id")) missing.push("lead_id");
  if (!present("reason")) missing.push("reason");
  const day = clean(m.for_date);
  if (!ISO_DAY.test(day)) missing.push("for_date");
  if (!present("renter")) missing.push("renter");
  const plateOptional = allowance.kind === "pre_rental" && allowance.allowBlankPlate === true;
  if (!plateOptional && !present("plate")) missing.push("plate");
  return missing;
}

export function assertChargeMetadata(meta: Record<string, unknown> | null | undefined, allowance: ChargeMetadataAllowance): void {
  const missing = missingChargeMetadata(meta, allowance);
  if (missing.length) throw new StripeMetadataError(missing, allowance.kind);
}

/**
 * Build the metadata object. Also keeps the camelCase aliases the existing
 * webhook already reads (rentalId, applicationId) so older matchers keep working.
 */
export function buildChargeMetadata(input: ChargeMetadataInput, allowance: ChargeMetadataAllowance): Record<string, string> {
  const meta: Record<string, string> = {};
  const rentalId = clean(input.rentalId);
  const leadId = clean(input.leadId);
  const reason = clean(input.reason);
  const forDate = clean(input.forDate);
  const renter = clean(input.renter);
  const plate = chargePlate(input.plate);
  if (rentalId) {
    meta.rental_id = rentalId;
    meta.rentalId = rentalId;
  }
  if (leadId) {
    meta.lead_id = leadId;
    meta.applicationId = leadId;
  }
  if (reason) meta.reason = reason;
  if (forDate) meta.for_date = forDate;
  if (renter) meta.renter = renter;
  if (plate) meta.plate = plate;
  assertChargeMetadata(meta, allowance);
  return meta;
}

/** Checkout payment: the same object on metadata and payment_intent_data.metadata. */
export function withCheckoutChargeMetadata(params: any, meta: Record<string, string>, allowance: ChargeMetadataAllowance): any {
  const metadata = { ...(params?.metadata ?? {}), ...meta };
  const pi = { ...(params?.payment_intent_data ?? {}) };
  const piMeta = { ...(pi.metadata ?? {}), ...meta };
  assertChargeMetadata(metadata, allowance);
  assertChargeMetadata(piMeta, allowance);
  return { ...params, metadata, payment_intent_data: { ...pi, metadata: piMeta } };
}

/** PaymentIntent create: one metadata object. There is no nested payment_intent_data. */
export function withPaymentIntentMetadata<T extends { metadata?: Record<string, string> }>(
  params: T,
  meta: Record<string, string>,
  allowance: ChargeMetadataAllowance,
): T {
  const metadata = { ...(params.metadata ?? {}), ...meta };
  assertChargeMetadata(metadata, allowance);
  return { ...params, metadata };
}

/**
 * Subscription create. Stripe does not accept payment_intent_data here.
 * subscription.metadata is the supported field.
 */
export function subscriptionChargeMetadata(meta: Record<string, string>, allowance: ChargeMetadataAllowance = { kind: "rental" }): { metadata: Record<string, string> } {
  assertChargeMetadata(meta, allowance);
  return { metadata: meta };
}

/** Invoice create. invoice.metadata is the supported field at create time. */
export function invoiceChargeMetadata(meta: Record<string, string>, allowance: ChargeMetadataAllowance = { kind: "rental" }): { metadata: Record<string, string> } {
  assertChargeMetadata(meta, allowance);
  return { metadata: meta };
}

/**
 * Copy charge metadata onto the PaymentIntent Stripe created when the invoice
 * was finalized. No-op when that intent does not exist yet (invoice.metadata
 * remains the supported field).
 */
export async function stampInvoicePaymentIntent(stripe: { paymentIntents?: { update?: (id: string, params: { metadata: Record<string, string> }) => Promise<unknown> } }, invoice: { payment_intent?: unknown } | null | undefined, meta: Record<string, string>): Promise<{ stamped: boolean }> {
  const raw = invoice?.payment_intent;
  const id = typeof raw === "string" ? raw : raw && typeof raw === "object" && "id" in raw && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "";
  if (!id || !stripe.paymentIntents?.update) return { stamped: false };
  await stripe.paymentIntents.update(id, { metadata: meta });
  return { stamped: true };
}
