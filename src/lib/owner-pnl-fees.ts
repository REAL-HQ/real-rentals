/**
 * Stripe processing fees and refund fees for one Eastern Time month.
 * The cash impact matches payout reconciliation: a fee-type balance
 * transaction contributes its net, and every other type contributes the
 * negative of its fee. Payout rows are skipped. The P&L cost is the
 * negative of that impact, so a fee paid is positive and a fee returned
 * on a refund reduces the cost. This module does not call Stripe.
 */

const FEE_TYPES = new Set(["stripe_fee", "stripe_fx_fee", "tax_fee", "application_fee", "application_fee_refund"]);

export type OwnerFeeTxn = {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
};

export type OwnerFeeRead = { ok: true; feesCents: number } | { ok: false };

export function stripeFeeCostCents(
  txns: readonly OwnerFeeTxn[],
  window: { gte: number; lt: number },
): OwnerFeeRead {
  if (!Number.isSafeInteger(window.gte) || !Number.isSafeInteger(window.lt) || window.lt <= window.gte) return { ok: false };
  let impact = 0;
  for (const txn of txns) {
    if (!Number.isSafeInteger(txn.created) || txn.created < window.gte || txn.created >= window.lt) continue;
    if (txn.type === "payout") continue;
    if (txn.currency !== "usd") return { ok: false };
    if (!Number.isSafeInteger(txn.amount) || !Number.isSafeInteger(txn.fee) || !Number.isSafeInteger(txn.net)) return { ok: false };
    if (txn.amount - txn.fee !== txn.net) return { ok: false };
    const contribution = FEE_TYPES.has(txn.type) ? txn.net : -txn.fee;
    const next = impact + contribution;
    if (!Number.isSafeInteger(contribution) || !Number.isSafeInteger(next)) return { ok: false };
    impact = next;
  }
  const feesCents = -impact;
  if (!Number.isSafeInteger(feesCents)) return { ok: false };
  return { ok: true, feesCents };
}
