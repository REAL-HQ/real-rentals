import { STRIPE_READER_TIMEOUT_MS } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { AgingStripeNet } from "./ar-aging";

/**
 * Verified Stripe net for receivables aging. paymentIntents.retrieve and
 * charges.retrieve only, with the 60 second cache on. A failed check omits
 * that payment intent. The caller treats a missing net as unknown.
 * Nothing here writes a charge or a refund.
 */

type CallOptions = { timeout?: number };
type RawIntent = { id?: unknown; latest_charge?: unknown; livemode?: unknown };
type RawBalance = { fee?: unknown; currency?: unknown };
type RawCharge = {
  id?: unknown;
  amount_captured?: unknown;
  amount_refunded?: unknown;
  currency?: unknown;
  livemode?: unknown;
  balance_transaction?: unknown;
};

export type ArAgingStripeGateway = {
  paymentIntents: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawIntent>;
  };
  charges: {
    retrieve: (id: string, params?: { expand?: string[] }, options?: CallOptions) => Promise<RawCharge>;
  };
};

export async function readArAgingStripe(gateway: ArAgingStripeGateway, paymentIntentIds: string[]): Promise<{ ok: true; nets: AgingStripeNet[] } | { ok: false }> {
  const started = Date.now();
  const deadline = started + STRIPE_READER_TIMEOUT_MS;
  try {
    const nets: AgingStripeNet[] = [];
    for (const paymentIntentId of paymentIntentIds) {
      if (Date.now() >= deadline) return { ok: false };
      const timeout = Math.max(1, Math.min(10_000, deadline - Date.now()));
      const intent = await gateway.paymentIntents.retrieve(paymentIntentId, {}, { timeout });
      if (!intent || typeof intent !== "object" || intent.livemode === false) continue;
      if (typeof intent.id === "string" && intent.id !== paymentIntentId) continue;
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : null;
      if (!chargeId) continue;
      const charge = await gateway.charges.retrieve(chargeId, { expand: ["balance_transaction"] }, { timeout });
      const net = netCents(charge, chargeId);
      if (net == null) continue;
      nets.push({ paymentIntentId, netCents: net });
    }
    return { ok: true, nets };
  } catch {
    return { ok: false };
  }
}

export async function readLiveArAgingStripe(paymentIntentIds: string[]): Promise<{ ok: true; nets: AgingStripeNet[] } | { ok: false }> {
  try {
    return await readArAgingStripe(createReadOnlyStripe("live", { cache: true }) as unknown as ArAgingStripeGateway, paymentIntentIds);
  } catch {
    return { ok: false };
  }
}

function netCents(charge: RawCharge, chargeId: string): number | null {
  if (!charge || typeof charge !== "object" || charge.livemode === false) return null;
  if (typeof charge.id === "string" && charge.id !== chargeId) return null;
  if (typeof charge.currency !== "string" || charge.currency.toLowerCase() !== "usd") return null;
  const captured = integerCents(charge.amount_captured);
  const refunded = integerCents(charge.amount_refunded);
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === "string" || typeof balance !== "object") return null;
  const feeCurrency = (balance as RawBalance).currency;
  const fee = integerCents((balance as RawBalance).fee);
  if (captured == null || refunded == null || fee == null) return null;
  if (typeof feeCurrency !== "string" || feeCurrency.toLowerCase() !== "usd") return null;
  const net = captured - refunded - fee;
  return Number.isSafeInteger(net) ? net : null;
}

function integerCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
