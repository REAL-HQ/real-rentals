import type { FinanceReport, FinanceEvent, Measure, PaymentMethod } from "./unified-finance";
import { summarizeFinance } from "./unified-finance";
import { decimalSourceCents } from "./unified-finance-live-mapping";

/**
 * Verified Collections from Stripe list evidence plus payments rows.
 * A dollar is emitted only when a charge, fee, refund, or payout matches an
 * existing payment or refund row exactly. Anything else increments a count
 * and the cards stay incomplete. Fees come from the balance transaction;
 * payments have no fee column and none is invented.
 */

const REVENUE = new Set(["rent", "late_fee", "other", "toll", "damage", "fee"]);
const NON_STRIPE: Record<string, PaymentMethod> = {
  cash: "cash", cash_app: "cash_app", cashapp: "cash_app", venmo: "venmo", zelle: "zelle",
  bank_transfer: "bank_transfer", bank: "bank_transfer", check: "other", money_order: "other", other: "other",
};

export type VerifiedCharge = {
  id: string; paymentIntentId: string | null; balanceTransactionId: string | null;
  amountCents: number; currency: string; succeeded: boolean; created: number;
};
export type VerifiedBalance = {
  id: string; type: string; amount: number; fee: number; net: number; currency: string; created: number; sourceId: string | null;
};
export type VerifiedPayout = { id: string; amount: number; currency: string; status: string; arrival: number };
export type VerifiedPayment = {
  id: string; type: string; status: string; amount: string | number | null; refundedAmount: string | number | null;
  method: string | null; paidDate: string | null; paymentIntentId: string | null;
};
export type VerifiedRefundRow = {
  id: string; amount: string | number | null; status: string | null; chargeId: string | null;
  paymentIntentId: string | null; refundId: string; paymentIds: string[];
};
export type UnmatchedFinance = { charges: number; refunds: number; payouts: number; payments: number; balanceTransactions: number };

const emptyUnmatched = (): UnmatchedFinance => ({ charges: 0, refunds: 0, payouts: 0, payments: 0, balanceTransactions: 0 });
const day = (seconds: number) => Number.isSafeInteger(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;
const inWindow = (date: string, period: { from: string; to: string }) => date >= period.from && date < period.to;
const methodOf = (value: string | null): PaymentMethod | "stripe" | null => {
  if (!value?.trim()) return null;
  const text = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (text === "stripe" || text === "card" || text === "ach") return "stripe";
  return NON_STRIPE[text] ?? null;
};

export function buildVerifiedCollections(input: {
  period: { from: string; to: string }; basis: "cash" | "accrual";
  charges: VerifiedCharge[]; balances: VerifiedBalance[]; payouts: VerifiedPayout[];
  payments: VerifiedPayment[]; refunds: VerifiedRefundRow[];
}): { events: FinanceEvent[]; unmatched: UnmatchedFinance; complete: boolean; reasons: string[] } {
  const unmatched = emptyUnmatched();
  const events: FinanceEvent[] = [];
  const matchedPayments = new Set<string>();
  const handledBalances = new Set<string>();
  const reasons: string[] = [];
  const bump = (key: keyof UnmatchedFinance) => { unmatched[key] += 1; };
  const chargeById = new Map(input.charges.map((charge) => [charge.id, charge]));
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const moved = (balance: VerifiedBalance) => balance.amount !== 0 || balance.fee !== 0 || balance.net !== 0;
  const inside = (seconds: number) => {
    const cashDate = day(seconds);
    return cashDate !== null && inWindow(cashDate, input.period) ? cashDate : null;
  };

  for (const balance of input.balances) {
    if (balance.type === "payout") continue;
    const cashDate = inside(balance.created);
    if (balance.type === "stripe_fee") {
      handledBalances.add(balance.id);
      const amount = balance.amount < 0 && balance.fee === 0 && balance.net === balance.amount ? -balance.amount : balance.fee > 0 && balance.amount === 0 ? balance.fee : null;
      if (!cashDate) continue;
      if (amount === null || !Number.isSafeInteger(amount) || amount < 0 || balance.currency !== "usd") bump("balanceTransactions");
      else events.push({ id: `fee:${balance.id}`, kind: "processing_fee", amountCents: amount, currency: "USD", status: "succeeded", cashDate, evidence: "verified", method: "stripe" });
      continue;
    }
    if (balance.type !== "charge" && balance.type !== "payment" && balance.type !== "refund" && balance.type !== "payment_refund") {
      handledBalances.add(balance.id);
      if (cashDate) bump("balanceTransactions");
    }
  }

  for (const charge of input.charges) {
    const rows = input.balances.filter((row) => row.sourceId === charge.id && (row.type === "charge" || row.type === "payment"));
    const balance = rows[0];
    const cashDate = inside(balance?.created ?? charge.created);
    if (!cashDate) continue;
    for (const row of rows) handledBalances.add(row.id);
    if (rows.length > 1 || !charge.succeeded) {
      if (rows.length > 1 || (balance && moved(balance))) bump("balanceTransactions");
      continue;
    }
    const candidates = input.payments.filter((payment) => charge.paymentIntentId !== null && payment.paymentIntentId === charge.paymentIntentId);
    const payment = candidates.length === 1 ? candidates[0] : undefined;
    const amount = payment ? decimalSourceCents(payment.amount) : null;
    const feeOk = !!balance && balance.currency === "usd" && charge.currency === "usd" && balance.amount === charge.amountCents && balance.fee >= 0 && balance.net === balance.amount - balance.fee && Number.isSafeInteger(balance.fee);
    if (!payment || amount === null || amount !== charge.amountCents || !feeOk || !balance) {
      bump("charges");
      continue;
    }
    matchedPayments.add(payment.id);
    const kind = payment.type === "deposit" ? "deposit_received" : REVENUE.has(payment.type) ? "collection" : null;
    if (!kind) { bump("charges"); continue; }
    const id = `charge:${charge.id}`;
    events.push({
      id, kind, amountCents: charge.amountCents, currency: "USD", status: "succeeded", cashDate, evidence: "verified", method: "stripe",
      feeCents: kind === "collection" ? balance.fee : undefined, customerId: null, bookingId: null, vehicleId: null,
    });
    if (kind === "deposit_received" && balance.fee > 0) {
      events.push({ id: `fee:${balance.id}`, kind: "processing_fee", amountCents: balance.fee, currency: "USD", status: "succeeded", cashDate, evidence: "verified", method: "stripe", relatedEventId: id });
    }
  }

  const ensureCharge = (charge: VerifiedCharge, payment: VerifiedPayment): boolean => {
    if (events.some((event) => event.id === `charge:${charge.id}`)) return true;
    const balance = input.balances.find((row) => row.sourceId === charge.id && (row.type === "charge" || row.type === "payment"));
    const amount = decimalSourceCents(payment.amount);
    const cashDate = balance ? day(balance.created) : day(charge.created);
    const feeOk = !!balance && !!cashDate && balance.currency === "usd" && charge.currency === "usd" && balance.amount === charge.amountCents && balance.fee >= 0 && balance.net === balance.amount - balance.fee;
    const kind = payment.type === "deposit" ? "deposit_received" : REVENUE.has(payment.type) ? "collection" : null;
    if (!feeOk || !balance || !cashDate || amount === null || amount !== charge.amountCents || !kind || !charge.succeeded) return false;
    events.push({
      id: `charge:${charge.id}`, kind, amountCents: charge.amountCents, currency: "USD", status: "succeeded", cashDate, evidence: "verified", method: "stripe",
      feeCents: kind === "collection" ? balance.fee : undefined,
    });
    matchedPayments.add(payment.id);
    return true;
  };

  for (const balance of input.balances) {
    if (balance.type !== "refund" && balance.type !== "payment_refund") continue;
    const cashDate = day(balance.created);
    if (!cashDate || !inWindow(cashDate, input.period)) continue;
    handledBalances.add(balance.id);
    const row = input.refunds.find((refund) => refund.refundId === balance.sourceId);
    const amount = row ? decimalSourceCents(row.amount) : null;
    const charge = row?.chargeId ? chargeById.get(row.chargeId) : undefined;
    const payment = row?.paymentIds.map((id) => paymentById.get(id)).find((item): item is VerifiedPayment => !!item)
      ?? input.payments.find((item) => row?.paymentIntentId && item.paymentIntentId === row.paymentIntentId);
    if (!row || amount === null || amount !== Math.abs(balance.amount) || balance.fee !== 0 || balance.currency !== "usd" || !charge || !payment || !ensureCharge(charge, payment)) {
      bump("refunds");
      continue;
    }
    const returned = payment.type === "deposit";
    events.push({
      id: `refund:${row.refundId}`, kind: returned ? "deposit_returned" : "refund", amountCents: amount, currency: "USD",
      status: "succeeded", cashDate, evidence: "verified", method: "stripe", relatedEventId: returned ? null : `charge:${charge.id}`,
    });
  }

  for (const payout of input.payouts) {
    if (payout.status === "pending" || payout.status === "in_transit" || payout.status === "canceled" || payout.status === "failed") continue;
    const cashDate = day(payout.arrival);
    if (payout.status !== "paid" || !cashDate || !inWindow(cashDate, input.period) || payout.currency !== "usd" || !Number.isSafeInteger(payout.amount) || payout.amount < 0) {
      bump("payouts");
      continue;
    }
    events.push({ id: `payout:${payout.id}`, kind: "payout", amountCents: payout.amount, currency: "USD", status: "succeeded", cashDate, evidence: "verified", method: "stripe" });
  }

  for (const payment of input.payments) {
    if (payment.status !== "paid" && payment.status !== "refunded") continue;
    if (matchedPayments.has(payment.id)) continue;
    if (!payment.paidDate) { bump("payments"); continue; }
    if (!inWindow(payment.paidDate, input.period)) continue;
    const method = methodOf(payment.method);
    const amount = decimalSourceCents(payment.amount);
    if (payment.paymentIntentId || method === "stripe" || !method || amount === null) { bump("payments"); continue; }
    const kind = payment.type === "deposit" ? "deposit_received" : REVENUE.has(payment.type) ? "collection" : null;
    if (!kind) { bump("payments"); continue; }
    events.push({
      id: `payment:${payment.id}`, kind, amountCents: amount, currency: "USD", status: "succeeded", cashDate: payment.paidDate,
      evidence: "verified", method, feeCents: kind === "collection" ? 0 : undefined,
    });
    const refunded = decimalSourceCents(payment.refundedAmount ?? 0);
    if (payment.refundedAmount !== null && payment.refundedAmount !== 0 && (refunded === null || refunded <= 0)) bump("refunds");
    else if (refunded && refunded > 0) {
      events.push({
        id: `refund:payment:${payment.id}`, kind: kind === "deposit_received" ? "deposit_returned" : "refund", amountCents: refunded,
        currency: "USD", status: "succeeded", cashDate: payment.paidDate, evidence: "verified", method,
        relatedEventId: kind === "deposit_received" ? null : `payment:${payment.id}`,
      });
    }
  }

  for (const balance of input.balances) {
    if (handledBalances.has(balance.id) || balance.type === "payout") continue;
    if (!inside(balance.created) || !moved(balance)) continue;
    if (balance.type === "charge" || balance.type === "payment" || balance.type === "refund" || balance.type === "payment_refund") bump("balanceTransactions");
  }

  const total = unmatched.charges + unmatched.refunds + unmatched.payouts + unmatched.payments + unmatched.balanceTransactions;
  if (unmatched.charges) reasons.push(`${unmatched.charges} Unmatched Charges`);
  if (unmatched.refunds) reasons.push(`${unmatched.refunds} Unmatched Refunds`);
  if (unmatched.payouts) reasons.push(`${unmatched.payouts} Unmatched Payouts`);
  if (unmatched.payments) reasons.push(`${unmatched.payments} Unmatched Payments`);
  if (unmatched.balanceTransactions) reasons.push(`${unmatched.balanceTransactions} Unmatched Balance Transactions`);
  return { events, unmatched, complete: total === 0, reasons };
}

const unknown = (): Measure => ({ value: null, complete: false });
function derived(parts: Array<[Measure, 1 | -1]>): Measure {
  if (parts.some(([item]) => !item.complete || item.value === null)) return unknown();
  const value = parts.reduce((sum, [item, sign]) => sum + sign * (item.value as number), 0);
  return Number.isSafeInteger(value) ? { value, complete: true } : unknown();
}

/** Headline cards that this evidence can stand behind. Ledger, expenses, and disputes stay blank. */
export function verifiedCollectionReport(input: {
  period: { from: string; to: string }; basis: "cash" | "accrual"; events: FinanceEvent[]; complete: boolean;
}): FinanceReport {
  const report = summarizeFinance({ events: input.events, period: input.period, basis: input.basis, currency: "USD", coverage: input.complete ? "complete" : "incomplete" });
  if (!input.complete) return report;
  report.earnedRevenue = unknown();
  report.operatingExpenses = unknown();
  report.customerCompensation = unknown();
  report.openDisputes = unknown();
  report.projectedRenewals = unknown();
  report.netCollections = derived([[report.grossCollected, 1], [report.refunds, -1], [report.chargebacksLost, -1], [report.processingFees, -1]]);
  report.operatingResult = unknown();
  report.payoutDifference = derived([[report.actualPayouts, 1], [report.netCollections, -1]]);
  report.complete = [report.grossCollected, report.refunds, report.chargebacksLost, report.processingFees, report.netCollections, report.depositLiabilityChange, report.actualPayouts, report.payoutDifference].every((item) => item.complete);
  return report;
}
