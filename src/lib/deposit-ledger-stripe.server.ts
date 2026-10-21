import { STRIPE_READER_TIMEOUT_MS } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { DepositStripeCheck, DepositStripeRead, LedgerPayment } from "./deposit-ledger";

/**
 * Optional cross-check for Deposit Ledger. paymentIntents.retrieve and
 * charges.retrieve only, with the 60 second cache on. A livemode miss or
 * any Stripe error returns ok: false. The caller keeps the database rows.
 * Nothing here writes a charge or a refund.
 */

type CallOptions = { timeout?: number };
type RawIntent = { id?: unknown; latest_charge?: unknown; livemode?: unknown };
type RawCharge = { id?: unknown; amount?: unknown; amount_captured?: unknown; amount_refunded?: unknown; livemode?: unknown };

export type DepositStripeGateway = {
  paymentIntents: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawIntent>;
  };
  charges: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
};

export async function readDepositStripe(gateway: DepositStripeGateway, payments: LedgerPayment[]): Promise<DepositStripeRead> {
  const started = Date.now();
  const deadline = started + STRIPE_READER_TIMEOUT_MS;
  const now = () => Date.now();
  const timeout = () => Math.max(1, Math.min(10_000, deadline - now()));
  try {
    const checks: DepositStripeCheck[] = [];
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
      checks.push({ paymentId: payment.id, capturedCents: captured, refundedCents: refunded });
    }
    return { ok: true, checks };
  } catch {
    return { ok: false };
  }
}

export async function readLiveDepositStripe(payments: LedgerPayment[]): Promise<DepositStripeRead> {
  try {
    return await readDepositStripe(createReadOnlyStripe("live", { cache: true }) as unknown as DepositStripeGateway, payments);
  } catch {
    return { ok: false };
  }
}

async function chargeFor(
  gateway: DepositStripeGateway,
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
