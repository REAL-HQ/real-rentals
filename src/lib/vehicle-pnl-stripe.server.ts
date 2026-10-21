import { createReadOnlyStripe } from "./stripe-reader.server";
import { STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import {
  verifyCollectedCharges,
  type CollectionBalanceEvidence,
  type CollectionInvoicePayment,
  type CollectionInvoiceRef,
  type CollectionRefund,
  type CollectionSubscriptionRef,
  type UnverifiedCollectionCharge,
} from "./stripe-collections";
import type { VehiclePnlCharge, VehiclePnlRefund, VehiclePnlStripeRead } from "./vehicle-pnl";

/**
 * List and retrieve only, uncached, matching Overview. Verification is
 * verifyCollectedCharges: capture time, invoice customer ownership,
 * balance.amount against amount_captured, and bad refunds. An incomplete
 * relevant charge withholds the month. Charge has no invoice field on API
 * 2026-03-25.dahlia, so the invoice id comes from invoicePayments. The
 * caller already checked the flag and the role.
 */

type IdRef = string | { id: string } | null | undefined;
type Balance = { fee?: unknown; currency?: unknown; amount?: unknown; created?: unknown };
type ChargeRow = {
  id?: string;
  amount_captured?: unknown;
  currency?: unknown;
  created?: unknown;
  paid?: unknown;
  captured?: unknown;
  status?: unknown;
  customer?: IdRef;
  payment_intent?: IdRef;
  balance_transaction?: string | Balance | null;
};
type RefundRow = {
  id?: string;
  amount?: unknown;
  currency?: unknown;
  created?: unknown;
  status?: string | null;
  charge?: IdRef;
  balance_transaction?: string | Balance | null;
};
type InvoicePaymentRow = {
  id?: string;
  invoice?: IdRef;
  payment?: { type?: string; payment_intent?: IdRef; charge?: IdRef };
};
type InvoiceRow = {
  id?: string;
  customer?: IdRef;
  parent?: { subscription_details?: { subscription?: IdRef } };
};
type SubscriptionRow = { id?: string; customer?: IdRef };

export async function readVehiclePnlStripe(window: { gte: number; lt: number }): Promise<VehiclePnlStripeRead> {
  try {
    const stripe = createReadOnlyStripe("live");
    const [subscriptions, invoices, invoicePayments, charges, refunds] = await Promise.all([
      paginateStripeList(
        (cursor) => stripe.subscriptions.list({ status: "all", limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.customer"] }),
        { label: "vehicle profit subscriptions", dedupe: true, strict: true },
      ),
      paginateStripeList(
        (cursor) => stripe.invoices.list({ limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor }),
        { label: "vehicle profit invoices", dedupe: true, strict: true },
      ),
      paginateStripeList(
        (cursor) => stripe.invoicePayments.list({ limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor }),
        { label: "vehicle profit invoice payments", dedupe: true, strict: true },
      ),
      paginateStripeList(
        (cursor) => stripe.charges.list({ created: { lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] }),
        { label: "vehicle profit charges", dedupe: true, strict: true },
      ),
      paginateStripeList(
        (cursor) => stripe.refunds.list({ created: { gte: window.gte, lt: window.lt }, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] }),
        { label: "vehicle profit refunds", dedupe: true, strict: true },
      ),
    ]);
    const pages = [subscriptions, invoices, invoicePayments, charges, refunds];
    if (pages.some((page) => !page.ok)) {
      const truncated = pages.some((page) => !page.ok && page.reason === "capped");
      return { ok: false, truncated };
    }
    if (!subscriptions.ok || !invoices.ok || !invoicePayments.ok || !charges.ok || !refunds.ok) return { ok: false, truncated: false };
    const chargeRows = new Map((charges.rows as ChargeRow[]).filter((charge) => charge.id).map((charge) => [charge.id as string, charge]));
    for (const refund of refunds.rows as RefundRow[]) {
      const chargeId = idOf(refund.charge);
      if (!chargeId || chargeRows.has(chargeId)) continue;
      const parent = (await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] })) as ChargeRow;
      if (!parent?.id) return { ok: false, truncated: false };
      chargeRows.set(parent.id, parent);
    }
    const unverified: UnverifiedCollectionCharge[] = [];
    const meta = new Map<string, { paymentIntentId: string | null; invoiceId: string | null }>();
    for (const charge of chargeRows.values()) {
      const mapped = unverifiedCharge(charge);
      if (!mapped) return { ok: false, truncated: false };
      unverified.push(mapped);
      meta.set(mapped.id, {
        paymentIntentId: idOf(charge.payment_intent),
        invoiceId: invoiceIdForCharge(charge, invoicePayments.rows as InvoicePaymentRow[]),
      });
    }
    const normalizedRefunds: CollectionRefund[] = [];
    for (const refund of refunds.rows as RefundRow[]) {
      const mapped = mapRefund(refund);
      if (!mapped) return { ok: false, truncated: false };
      normalizedRefunds.push(mapped);
    }
    const links = (invoicePayments.rows as InvoicePaymentRow[]).map(invoicePayment);
    const invoiceRefs = (invoices.rows as InvoiceRow[]).map(invoiceRef);
    const subscriptionRefs = (subscriptions.rows as SubscriptionRow[]).map(subscriptionRef);
    if (links.some((link) => !link) || invoiceRefs.some((row) => !row) || subscriptionRefs.some((row) => !row)) {
      return { ok: false, truncated: false };
    }
    const verified = verifyCollectedCharges({
      window,
      charges: unverified,
      refunds: normalizedRefunds,
      invoicePayments: links as CollectionInvoicePayment[],
      invoices: invoiceRefs as CollectionInvoiceRef[],
      subscriptions: subscriptionRefs as CollectionSubscriptionRef[],
    });
    if (!verified.collectionsComplete) return { ok: false, truncated: false };
    const mappedCharges: VehiclePnlCharge[] = verified.charges.map((charge) => ({
      id: charge.id,
      paymentIntentId: meta.get(charge.id)?.paymentIntentId ?? null,
      invoiceId: meta.get(charge.id)?.invoiceId ?? null,
      currency: charge.currency,
      amount: charge.amount,
      created: charge.created,
      paid: charge.paid,
      captured: charge.captured,
      status: charge.status,
      fee: charge.fee,
    }));
    const mappedRefunds: VehiclePnlRefund[] = verified.refunds.map((refund) => ({
      id: refund.id,
      chargeId: refund.chargeId,
      currency: refund.currency,
      amount: refund.amount,
      created: refund.created,
      status: refund.status,
      fee: refund.fee,
    }));
    return { ok: true, truncated: false, charges: mappedCharges, refunds: mappedRefunds };
  } catch {
    return { ok: false, truncated: false };
  }
}

function unverifiedCharge(charge: ChargeRow): UnverifiedCollectionCharge | null {
  if (!charge.id || typeof charge.currency !== "string" || typeof charge.created !== "number") return null;
  if (typeof charge.paid !== "boolean" || typeof charge.captured !== "boolean" || typeof charge.status !== "string") return null;
  if (typeof charge.amount_captured !== "number" || !Number.isSafeInteger(charge.amount_captured)) return null;
  return {
    id: charge.id,
    customerId: idOf(charge.customer),
    paymentIntentId: idOf(charge.payment_intent),
    currency: charge.currency,
    amountCaptured: charge.amount_captured,
    paid: charge.paid,
    captured: charge.captured,
    status: charge.status,
    created: charge.created,
    balance: balanceEvidence(charge.balance_transaction),
  };
}

function invoicePayment(row: InvoicePaymentRow): CollectionInvoicePayment | null {
  if (!row.id || !row.payment) return null;
  return {
    id: row.id,
    invoiceId: idOf(row.invoice),
    intentId: idOf(row.payment.payment_intent),
    chargeId: idOf(row.payment.charge),
    externalRecord: row.payment.type === "payment_record",
  };
}

function invoiceRef(row: InvoiceRow): CollectionInvoiceRef | null {
  if (!row.id) return null;
  return {
    id: row.id,
    customerId: idOf(row.customer),
    subscriptionId: idOf(row.parent?.subscription_details?.subscription),
  };
}

function subscriptionRef(row: SubscriptionRow): CollectionSubscriptionRef | null {
  if (!row.id) return null;
  return { id: row.id, customerId: idOf(row.customer) };
}

function mapRefund(refund: RefundRow): CollectionRefund | null {
  const chargeId = idOf(refund.charge);
  if (!refund.id || !chargeId || typeof refund.currency !== "string" || typeof refund.created !== "number") return null;
  const amount = integer(refund.amount);
  if (amount === null) return null;
  return {
    id: refund.id,
    chargeId,
    currency: refund.currency,
    amount,
    created: refund.created,
    status: typeof refund.status === "string" ? refund.status : null,
    fee: feeOf(refund.balance_transaction, refund.currency),
  };
}

function balanceEvidence(balance: string | Balance | null | undefined): CollectionBalanceEvidence | null {
  if (!balance || typeof balance !== "object") return null;
  return { created: balance.created, currency: balance.currency, amount: balance.amount, fee: balance.fee };
}

function feeOf(balance: string | Balance | null | undefined, currency: string): number | null {
  if (!balance || typeof balance !== "object") return null;
  if (balance.currency !== currency) return null;
  return integer(balance.fee);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** One invoice for this charge, from an invoice payment that names the charge or its payment intent. */
export function invoiceIdForCharge(charge: { id?: string; payment_intent?: IdRef }, invoicePayments: InvoicePaymentRow[]): string | null {
  if (!charge.id) return null;
  const intent = idOf(charge.payment_intent);
  const invoices = new Set<string>();
  for (const row of invoicePayments) {
    const invoice = idOf(row.invoice);
    if (!invoice || !row.payment) continue;
    const namedCharge = idOf(row.payment.charge);
    const namedIntent = idOf(row.payment.payment_intent);
    if ((namedCharge && namedCharge === charge.id) || (intent && namedIntent === intent)) invoices.add(invoice);
  }
  return invoices.size === 1 ? [...invoices][0]! : null;
}

function idOf(value: IdRef): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim()) return value.id;
  return null;
}
