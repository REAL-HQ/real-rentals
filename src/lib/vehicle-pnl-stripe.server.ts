import { createReadOnlyStripe } from "./stripe-reader.server";
import { STRIPE_READER_PAGE_SIZE, paginateStripeList } from "./stripe-reader";
import type { VehiclePnlCharge, VehiclePnlRefund, VehiclePnlStripeRead } from "./vehicle-pnl";

/**
 * List and retrieve only. The caller already checked the flag and the role.
 * A capped or failed read is not a partial total.
 */

type Balance = { fee?: unknown; currency?: unknown };
type ChargeRow = {
  id: string;
  amount?: unknown;
  amount_captured?: unknown;
  currency?: unknown;
  created?: unknown;
  paid?: unknown;
  captured?: unknown;
  status?: unknown;
  payment_intent?: string | { id: string } | null;
  balance_transaction?: string | Balance | null;
};
type RefundRow = {
  id: string;
  amount?: unknown;
  currency?: unknown;
  created?: unknown;
  status?: string | null;
  charge?: string | { id: string } | null;
  balance_transaction?: string | Balance | null;
};

export async function readVehiclePnlStripe(window: { gte: number; lt: number }): Promise<VehiclePnlStripeRead> {
  try {
    const stripe = createReadOnlyStripe("live", { cache: true });
    const created = { gte: window.gte, lt: window.lt };
    const charges = await paginateStripeList(
      (cursor) => stripe.charges.list({ created, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] }),
      { label: "vehicle profit charges", dedupe: true, strict: true },
    );
    const refunds = await paginateStripeList(
      (cursor) => stripe.refunds.list({ created, limit: STRIPE_READER_PAGE_SIZE, starting_after: cursor, expand: ["data.balance_transaction"] }),
      { label: "vehicle profit refunds", dedupe: true, strict: true },
    );
    if (!charges.ok || !refunds.ok) {
      const truncated = (!charges.ok && charges.reason === "capped") || (!refunds.ok && refunds.reason === "capped");
      return { ok: false, truncated };
    }
    const chargeRows = charges.rows as ChargeRow[];
    const byId = new Map(chargeRows.map((charge) => [charge.id, charge]));
    for (const refund of refunds.rows as RefundRow[]) {
      const chargeId = idOf(refund.charge);
      if (!chargeId || byId.has(chargeId)) continue;
      const parent = (await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] })) as ChargeRow;
      if (!parent?.id) return { ok: false, truncated: false };
      byId.set(parent.id, parent);
    }
    const mappedCharges: VehiclePnlCharge[] = [];
    for (const charge of byId.values()) {
      const mapped = mapCharge(charge);
      if (!mapped) return { ok: false, truncated: false };
      mappedCharges.push(mapped);
    }
    const mappedRefunds: VehiclePnlRefund[] = [];
    for (const refund of refunds.rows as RefundRow[]) {
      const mapped = mapRefund(refund);
      if (!mapped) return { ok: false, truncated: false };
      mappedRefunds.push(mapped);
    }
    return { ok: true, truncated: false, charges: mappedCharges, refunds: mappedRefunds };
  } catch {
    return { ok: false, truncated: false };
  }
}

function mapCharge(charge: ChargeRow): VehiclePnlCharge | null {
  if (!charge.id || typeof charge.currency !== "string" || typeof charge.created !== "number") return null;
  if (typeof charge.paid !== "boolean" || typeof charge.captured !== "boolean" || typeof charge.status !== "string") return null;
  const amount = integer(charge.amount_captured) ?? integer(charge.amount);
  if (amount === null) return null;
  return {
    id: charge.id,
    paymentIntentId: idOf(charge.payment_intent),
    currency: charge.currency,
    amount,
    created: charge.created,
    paid: charge.paid,
    captured: charge.captured,
    status: charge.status,
    fee: feeOf(charge.balance_transaction, charge.currency),
  };
}

function mapRefund(refund: RefundRow): VehiclePnlRefund | null {
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

function feeOf(balance: string | Balance | null | undefined, currency: string): number | null {
  if (!balance || typeof balance === "string") return null;
  if (balance.currency !== currency) return null;
  return integer(balance.fee);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim()) return value.id;
  return null;
}
