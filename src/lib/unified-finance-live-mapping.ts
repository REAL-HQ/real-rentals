import { validFinanceDate } from "./unified-finance";
import type { FinanceSource, FinanceSourceRow } from "./unified-finance-contract";
import { providerIdentityKey, type Representation } from "./unified-finance-reconciliation";
import type { C1Projection, C1SettlementProjection, LedgerRow, MappedSource, OperationalPaymentProjection, RawSources, SourceEvidence, SourceFacts, SourceScope, VehicleExpenseProjection } from "./unified-finance-source-contracts";

/** Live-shaped, normalized input contracts only. No claimed raw DB/Stripe mapping or I/O. */
function facts(row: SourceFacts): string[] {
  const reasons: string[] = [];
  if (!row.id.trim()) reasons.push("Missing immutable row identity");
  if (!Number.isSafeInteger(row.amountCents) || row.amountCents === null || row.amountCents < 0) reasons.push("Missing or invalid cents");
  if (row.currency !== "USD") reasons.push("Missing or unsupported currency");
  const date = row.kind === "earned_revenue" ? row.recognitionDate : row.cashDate;
  if (!date || !validFinanceDate(date)) reasons.push("Missing or invalid reporting date");
  if (row.recognitionDate && !validFinanceDate(row.recognitionDate)) reasons.push("Invalid recognition date");
  if (row.kind === "collection" && (row.feeCents === null || !Number.isSafeInteger(row.feeCents) || row.feeCents < 0)) reasons.push("Missing or invalid collection fee");
  for (const identity of row.identities) {
    try { providerIdentityKey(identity); } catch { reasons.push("Missing provider identity"); }
  }
  return reasons;
}
function representation(row: SourceFacts, source: Representation["source"]): Representation {
  return { id: row.id, source, identities: row.identities.map(i => ({ ...i })), event: {
    id: row.id, kind: row.kind, amountCents: row.amountCents, currency: row.currency,
    cashDate: row.cashDate, recognitionDate: row.recognitionDate, feeCents: row.kind === "collection" ? row.feeCents : undefined,
    status: row.status, evidence: row.verified ? "verified" : "unverified", method: row.method,
    relatedEventId: row.relatedEventId, customerId: row.customerId, bookingId: row.rentalId, vehicleId: null,
  } };
}
const expectedDirection = (kind: SourceFacts["kind"]) => ["collection", "earned_revenue", "deposit_received", "payout"].includes(kind) ? "in" : "out";
export function mapFinanceSource<S extends FinanceSource>(source: S, input: RawSources[S], scope?: SourceScope): MappedSource {
  try { return mapSourceUnchecked(source, input, scope); }
  catch { return { row: null, reasons: ["Malformed source facts"] }; }
}
function mapSourceUnchecked<S extends FinanceSource>(source: S, input: RawSources[S], scope?: SourceScope): MappedSource {
  if (source === "settlements") {
    const s = input as RawSources["settlements"];
    const valid = Boolean(s.id && s.paymentId && s.obligationId && s.currency === "USD" && s.amountCents !== null && Number.isSafeInteger(s.amountCents) && s.amountCents > 0);
    return { row: valid ? { id: s.id, visibility: s.visibility, settlement: { paymentId: s.paymentId, obligationId: s.obligationId, amountCents: s.amountCents as number, currency: "USD" } } : null,
      reasons: valid ? [] : ["Invalid settlement facts"] };
  }
  if (source === "relationships") {
    const r = input as RawSources["relationships"];
    return { row: r.id && r.relationship.eventId ? { id: r.id, visibility: r.visibility, relationship: { ...r.relationship, allocations: r.relationship.allocations.map(a => ({ ...a })) } } : null,
      reasons: r.id && r.relationship.eventId ? [] : ["Missing relationship identity"] };
  }
  const raw = input as SourceFacts;
  const reasons = facts(raw);
  const rep = representation(raw, source === "stripe" ? "provider" : source === "ledger" ? "c1" : "operational");
  const row: FinanceSourceRow = { id: raw.id, visibility: "operating", representation: rep };
  if (source === "stripe") {
    const p = input as RawSources["stripe"];
    if (!scope?.account || !p.identities.some(i => i.provider === "stripe" && i.object === p.object && i.account === scope.account && i.environment === scope.environment && i.id.trim())) reasons.push("Missing scoped provider money-event identity");
    if (p.identities.some(i => i.account !== scope?.account || i.environment !== scope?.environment || i.provider !== "stripe")) reasons.push("Conflicting provider scope");
    const expected = p.object === "charge" ? "collection" : p.object === "refund" ? "refund" : "processing_fee";
    if (p.kind !== expected) reasons.push("Provider object/kind mismatch");
    if (p.object === "refund") {
      if (!p.parentChargeId?.trim()) reasons.push("Missing refund parent");
      rep.event.relatedEventId = p.parentChargeId;
    }
  } else if (source === "payments") {
    const p = input as RawSources["payments"]; row.visibility = p.visibility;
    if (!p.paymentId.trim()) reasons.push("Missing operational payment identity");
    rep.operationalPaymentId = p.paymentId;
    if (p.method === "stripe" && !p.identities.some(i => i.provider === "stripe" && (i.object === "charge" || i.object === "payment_intent") && i.id.trim())) reasons.push("Missing operational Stripe identity");
  } else if (source === "expenses") {
    const e = input as RawSources["expenses"]; row.visibility = e.visibility; row.expenseId = e.expenseId;
    if (!e.expenseId.trim() || e.kind !== "operating_expense") reasons.push("Invalid expense identity/kind");
    rep.operationalPaymentId = `expense:${e.expenseId}`;
  } else {
    const l = input as LedgerRow; row.visibility = l.visibility;
    row.id = l.transactionId;
    rep.c1TransactionId = l.transactionId; rep.operationalPaymentId = l.paymentId;
    row.expenseId = l.expenseId; row.reversesId = l.reversesId; row.correctsId = l.correctsId;
    if (l.expenseId && l.kind === "operating_expense") rep.operationalPaymentId = `expense:${l.expenseId}`;
    row.posting = l.posting === "posted" ? "posted" : l.posting === "reversed" || l.posting === "corrected" ? "reversed" : "draft";
    if (!l.transactionId.trim()) reasons.push("Missing C1 identity");
    if (l.direction !== expectedDirection(l.kind) && !l.reversesId) reasons.push("Unsupported accounting direction");
    if (l.reversesId) {
      // Opposite-direction cancellation must be proven against its original by mapLedgerBatch.
      rep.event.relatedEventId = l.reversesId;
    }
  }
  return { row, reasons };
}
/** Proves direction, original identity and event relationship without creating negative cash. */
export function mapLedgerBatch(rows: readonly LedgerRow[]): MappedSource[] {
  const byId = new Map(rows.map(r => [r.transactionId, r]));
  return rows.map(raw => {
    const result = mapFinanceSource("ledger", raw);
    if (raw.reversesId) {
      const original = byId.get(raw.reversesId);
      if (!original || !["reversed", "corrected"].includes(original.posting) || raw.posting !== "posted" || raw.direction === original.direction || raw.kind !== original.kind ||
        raw.amountCents !== original.amountCents || raw.currency !== original.currency || !["operating_expense", "earned_revenue"].includes(raw.kind)) result.reasons.push("Unsupported or invalid directional reversal");
      if (result.row?.representation && original) result.row.representation.event.relatedEventId = original.id;
    }
    if (raw.correctsId) {
      const original = byId.get(raw.correctsId);
      if (!original || original.posting !== "corrected" || raw.posting !== "posted" || raw.kind !== original.kind || raw.currency !== original.currency ||
        raw.direction !== original.direction || !rows.some(r => r.reversesId === original.transactionId && r.posting === "posted" && r.direction !== original.direction && r.amountCents === original.amountCents && r.currency === original.currency)) result.reasons.push("Missing correction/reversal evidence");
      if (result.row?.representation && original) result.row.representation.event.relatedEventId = original.id;
    }
    return result;
  });
}

/** Decimal-major-unit columns converted exactly, rejecting rounding and unsafe totals. */
export function decimalSourceCents(value: string | number | null): number | null {
  if (value === null) return null;
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
function sourceDate(value: string | null): string | null {
  if (!value) return null;
  if (validFinanceDate(value)) return value;
  // Explicit UTC provider/database instants only; timezone-free text is not evidence.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) return null;
  const date = value.slice(0, 10);
  return validFinanceDate(date) ? new Date(value).toISOString().slice(0, 10) : null;
}
function baseFacts(id: string, amount: string | number | null, evidence: SourceEvidence): SourceFacts {
  if (!evidence.kind) throw new Error("Unsupported or unclassified financial kind");
  return { id, kind: evidence.kind, amountCents: decimalSourceCents(amount), currency: evidence.currency,
    cashDate: sourceDate(evidence.cashDate), recognitionDate: null, feeCents: evidence.feeCents, verified: evidence.verified,
    status: "pending", method: evidence.method, customerId: evidence.customerId, rentalId: null, identities: evidence.identities.map(i => ({ ...i })), relatedEventId: null };
}
export function operationalPaymentContract(p: OperationalPaymentProjection, evidence: SourceEvidence): RawSources["payments"] {
  // payments.amount is the original charge, not net_collected or a cumulative refund adjustment.
  const f = baseFacts(p.id, p.amount, evidence); f.cashDate = sourceDate(p.paid_date); f.rentalId = p.rental_id; f.customerId = p.driver_id;
  f.status = ["paid", "refunded"].includes(p.status) ? "succeeded" : p.status === "failed" ? "failed" : ["void", "canceled", "cancelled"].includes(p.status) ? "canceled" : "pending";
  return { ...f, paymentId: p.id, visibility: "operating" };
}
export function c1SourceContract(p: C1Projection, evidence: SourceEvidence): LedgerRow {
  const kinds: Record<string, SourceFacts["kind"]> = { obligation: "earned_revenue", invoice: "earned_revenue", payment: "collection", expense: "operating_expense", refund: "refund",
    deposit_received: "deposit_received", deposit_returned: "deposit_returned", deposit_applied: "deposit_applied" };
  const kind = kinds[p.txn_type];
  if (!kind) throw new Error("Unsupported C1 balance-sheet category");
  const f = baseFacts(p.id, p.amount, { ...evidence, kind, currency: p.currency });
  f.cashDate = sourceDate(p.cash_date); f.recognitionDate = sourceDate(p.recognition_date); f.rentalId = p.rental_id;
  f.status = ["posted", "corrected", "reversed"].includes(p.status) ? "succeeded" : "pending";
  return { ...f, transactionId: p.id, posting: p.status, direction: p.direction, visibility: p.sensitivity === "owner_only" ? "owner_only" : "operating",
    paymentId: p.payment_id, expenseId: p.expense_id, reversesId: p.reverses_id, correctsId: p.corrects_id };
}
export function expenseSourceContract(p: VehicleExpenseProjection, evidence: SourceEvidence): RawSources["expenses"] {
  const f = baseFacts(p.id, p.amount, { ...evidence, kind: "operating_expense" });
  f.recognitionDate = sourceDate(p.incurred_on); f.rentalId = p.rental_id; f.status = evidence.verified && f.cashDate ? "succeeded" : "pending";
  return { ...f, expenseId: p.id, visibility: "operating" };
}
export function settlementSourceContract(p: C1SettlementProjection, currency: string | null): RawSources["settlements"] | null {
  // Only posted links count; currency must be established from both C1 endpoints, not defaulted.
  if (p.status !== "posted") return null;
  return { id: p.id, paymentId: p.payment_txn_id, obligationId: p.obligation_id, amountCents: decimalSourceCents(p.amount), currency, visibility: "operating" };
}