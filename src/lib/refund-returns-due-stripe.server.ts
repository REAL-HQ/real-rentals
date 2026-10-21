import { STRIPE_READER_MAX_PAGES, STRIPE_READER_TIMEOUT_MS, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { ReturnPayment, ReturnStripeCheck } from "./refund-returns-due";
import type { ReturnStripeRead } from "./refund-returns-due.server";

/**
 * Cross-check for Refunds & Deposit Returns Due.
 * paymentIntents.retrieve, charges.retrieve, and refunds.list only.
 * The client is createReadOnlyStripe("live", { cache: true }).
 * A page cap or any Stripe error returns ok: false. Nothing here creates a refund.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawIntent = { id?: unknown; latest_charge?: unknown; livemode?: unknown };
type RawCharge = { id?: unknown; amount?: unknown; amount_captured?: unknown; amount_refunded?: unknown; livemode?: unknown };
type RawRefund = { id?: unknown; amount?: unknown };

export type ReturnStripeGateway = {
  paymentIntents: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawIntent>;
  };
  charges: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
  refunds: {
    list: (
      params: { payment_intent: string; limit: number; starting_after?: string },
      options?: CallOptions,
    ) => Promise<Page<RawRefund>>;
  };
};

const PAGE = 100;

export async function readRefundReturnsStripe(gateway: ReturnStripeGateway, payments: ReturnPayment[]): Promise<ReturnStripeRead> {
  const started = Date.now();
  const deadline = started + STRIPE_READER_TIMEOUT_MS;
  const now = () => Date.now();
  const timeout = () => Math.max(1, Math.min(10_000, deadline - now()));
  try {
    const checks: ReturnStripeCheck[] = [];
    for (const payment of payments) {
      if (payment.type !== "deposit" || !payment.stripePaymentIntentId) continue;
      if (now() >= deadline) return { ok: false };
      const intentId = payment.stripePaymentIntentId;
      const intent = await gateway.paymentIntents.retrieve(intentId, {}, { timeout: timeout() });
      if (!intent || typeof intent !== "object" || intent.livemode === false) return { ok: false };
      if (typeof intent.id === "string" && intent.id !== intentId) return { ok: false };
      const charge = await chargeFor(gateway, intent, timeout);
      if (charge === "missing") continue;
      if (charge === "bad") return { ok: false };
      const captured = integerCents(charge.amount_captured ?? charge.amount);
      const refunded = integerCents(charge.amount_refunded);
      if (captured == null || refunded == null) return { ok: false };
      const listed = await paginateStripeList(
        (cursor) => gateway.refunds.list(
          { payment_intent: intentId, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) },
          { timeout: timeout() },
        ),
        { label: "deposit return refunds", maxPages: STRIPE_READER_MAX_PAGES, deadline, now, strict: true },
      );
      if (!listed.ok) return { ok: false };
      checks.push({ paymentId: payment.id, capturedCents: captured, refundedCents: refunded });
    }
    return { ok: true, checks };
  } catch {
    return { ok: false };
  }
}

export async function readLiveRefundReturnsStripe(payments: ReturnPayment[]): Promise<ReturnStripeRead> {
  if (!payments.some((payment) => payment.type === "deposit" && payment.stripePaymentIntentId)) {
    return { ok: true, checks: [] };
  }
  try {
    return await readRefundReturnsStripe(
      createReadOnlyStripe("live", { cache: true }) as unknown as ReturnStripeGateway,
      payments,
    );
  } catch {
    return { ok: false };
  }
}

async function chargeFor(
  gateway: ReturnStripeGateway,
  intent: RawIntent,
  timeout: () => number,
): Promise<RawCharge | "missing" | "bad"> {
  const latest = intent.latest_charge;
  if (latest == null || latest === "") return "missing";
  if (typeof latest === "string") {
    const charge = await gateway.charges.retrieve(latest, {}, { timeout: timeout() });
    if (!charge || typeof charge !== "object" || charge.livemode === false) return "bad";
    if (typeof charge.id === "string" && charge.id !== latest) return "bad";
    return charge;
  }
  if (typeof latest === "object") {
    const charge = latest as RawCharge;
    if (charge.livemode === false) return "bad";
    return charge;
  }
  return "bad";
}

function integerCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
