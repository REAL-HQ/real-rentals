// Unified finance reporting core (Phase 1). Pure, synthetic-testable functions only:
// no database, Stripe, network or I/O. Amounts are integer minor units (cents).
// Missing data is never zero: any unknown input makes the affected measure null + incomplete.
// Inputs are economic events that are already reconciled (see unified-finance-reconciliation.ts),
// so one real money movement appears here exactly once. This is a reporting projection,
// not a ledger; C1 financial_transactions stays the only accounting record.

export type FinanceBasis = "cash" | "accrual";
export type EvidenceState = "verified" | "unverified" | "missing";
export type PaymentMethod = "stripe" | "zelle" | "cash_app" | "venmo" | "cash" | "bank_transfer" | "other";

export type FinanceEventKind =
  | "collection" // money received from a customer for rent/fees
  | "earned_revenue" // explicitly recognized C1 obligation; never collected cash
  | "refund" // money returned against a collection
  | "chargeback" // card dispute; see disputeStage
  | "processing_fee" // separate provider fee (e.g. dispute fee); collection fees use feeCents
  | "operating_expense"
  | "customer_compensation" // money paid to a customer for loss (not a refund, credit or reimbursement)
  | "deposit_received" // liability, never revenue
  | "deposit_applied" // non-cash: held deposit settles a charge
  | "deposit_returned"
  | "payout" // provider → bank transfer of already-collected funds; never revenue
  | "projected_renewal"; // future billing; never collected

export type FinanceEvent = {
  id: string;
  kind: FinanceEventKind;
  amountCents: number | null;
  currency: string | null;
  /** Only "succeeded" moves money. */
  status: "succeeded" | "pending" | "failed" | "canceled";
  cashDate?: string | null; // YYYY-MM-DD, when money actually moved
  recognitionDate?: string | null; // YYYY-MM-DD, when earned/incurred
  method?: PaymentMethod | null;
  evidence: EvidenceState;
  /** Actual collection fee in cents, including explicit zero; null/undefined = unknown. */
  feeCents?: number | null;
  /** Refund/chargeback/fee/deposit links to the event they adjust. */
  relatedEventId?: string | null;
  disputeStage?: "open" | "lost" | "won" | null;
  customerId?: string | null;
  bookingId?: string | null;
  vehicleId?: string | null;
};

export type Measure = { value: number | null; complete: boolean };
export type FinanceIssue = { eventId: string; code: IssueCode; detail: string };
export type IssueCode =
  | "missing_amount" | "missing_currency" | "currency_mismatch" | "missing_date" | "invalid_amount"
  | "missing_evidence" | "unverified" | "duplicate_event" | "conflicting_event" | "duplicate_fee"
  | "reversal_exceeds_collection" | "unknown_fee" | "missing_related_event";

export type FinanceReport = {
  currency: string;
  basis: FinanceBasis;
  period: { from: string; to: string };
  grossCollected: Measure;
  earnedRevenue: Measure;
  refunds: Measure;
  chargebacksLost: Measure;
  processingFees: Measure;
  netCollections: Measure; // gross − refunds − lost chargebacks − fees
  operatingExpenses: Measure;
  customerCompensation: Measure;
  operatingResult: Measure; // cash: net collections less costs; accrual: earned revenue less adjustments/costs
  depositLiabilityChange: Measure; // received − applied − returned (never revenue)
  actualPayouts: Measure;
  payoutDifference: Measure; // actual payouts − calculated net (timing/settlement gap)
  openDisputes: Measure; // exposure only, not deducted
  projectedRenewals: Measure; // shown separately, never collected
  unverifiedAmount: Measure; // recorded but not verified; excluded from totals
  counts: { succeededCollections: number; failedCollections: number; pendingCollections: number };
  complete: boolean;
  issues: FinanceIssue[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validFinanceDate(d: string): boolean {
  return DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
}
export function assertPeriod(p: { from: string; to: string }) {
  if (!validFinanceDate(p.from) || !validFinanceDate(p.to)) throw new Error("Invalid period");
  if (p.from >= p.to) throw new Error("Period start must be before its end");
}
const inPeriod = (d: string, p: { from: string; to: string }) => d >= p.from && d < p.to;

type Acc = { total: number; complete: boolean };
const acc = (): Acc => ({ total: 0, complete: true });
const m = (a: Acc): Measure => ({ value: a.complete ? a.total : null, complete: a.complete });
function combine(parts: Array<[Measure, 1 | -1]>): Measure {
  if (parts.some(([x]) => !x.complete || x.value === null)) return { value: null, complete: false };
  return { value: parts.reduce((s, [x, sign]) => s + sign * (x.value as number), 0), complete: true };
}

/** Which date places an event in a period under each basis. */
function eventDate(e: FinanceEvent, basis: FinanceBasis): string | null | undefined {
  if (e.kind === "deposit_applied") return e.recognitionDate ?? e.cashDate; // non-cash settlement
  if (e.kind === "projected_renewal" || e.kind === "earned_revenue") return e.recognitionDate;
  if (e.kind === "collection") return e.cashDate; // collected revenue always means actual cash
  if (basis === "cash" || e.kind === "payout" || e.kind.startsWith("deposit")) return e.cashDate;
  return e.recognitionDate;
}

function sameContent(a: FinanceEvent, b: FinanceEvent) {
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])] as Array<keyof FinanceEvent>;
  return fields.every(k => a[k] === b[k]);
}

export type FinanceCoverage = "complete" | "incomplete" | "unavailable";
export function summarizeFinance(input: { events: FinanceEvent[]; period: { from: string; to: string }; basis: FinanceBasis; currency: string; coverage: FinanceCoverage }): FinanceReport {
  assertPeriod(input.period);
  const currency = input.currency.toUpperCase();
  if (currency !== "USD") throw new Error("Phase 1 supports USD cents only; no currency conversion");
  const issues: FinanceIssue[] = [];
  const flag = (eventId: string, code: IssueCode, detail: string) => issues.push({ eventId, code, detail });

  // One event id contributes once; differing copies of one id are a conflict and contribute nothing.
  const byId = new Map<string, FinanceEvent>();
  const conflicted = new Set<string>();
  for (const e of input.events) {
    const prior = byId.get(e.id);
    if (!prior) { byId.set(e.id, e); continue; }
    if (sameContent(prior, e)) flag(e.id, "duplicate_event", "Repeated event counted once");
    else if (!conflicted.has(e.id)) { conflicted.add(e.id); flag(e.id, "conflicting_event", "Same identity with different facts; excluded"); }
  }

  const a = {
    gross: acc(), earned: acc(), refunds: acc(), chargebacks: acc(), fees: acc(), expenses: acc(), compensation: acc(),
    depositIn: acc(), depositApplied: acc(), depositOut: acc(), payouts: acc(), disputes: acc(), projected: acc(), unverified: acc(),
  };
  const counts = { succeededCollections: 0, failedCollections: 0, pendingCollections: 0 };
  const target: Record<FinanceEventKind, Acc> = {
    collection: a.gross, earned_revenue: a.earned, refund: a.refunds, chargeback: a.chargebacks, processing_fee: a.fees, operating_expense: a.expenses,
    customer_compensation: a.compensation, deposit_received: a.depositIn, deposit_applied: a.depositApplied,
    deposit_returned: a.depositOut, payout: a.payouts, projected_renewal: a.projected,
  };
  const all = [...byId.values()];
  const events = all.filter(e => !conflicted.has(e.id));
  if (input.coverage !== "complete") for (const item of Object.values(a)) item.complete = false;
  for (const e of input.events) if (conflicted.has(e.id)) {
    target[e.kind].complete = false;
    if (e.kind === "collection") a.fees.complete = false;
  }

  const collections = new Map(events.filter(e => e.kind === "collection").map(e => [e.id, e]));
  const feeOnCollection = new Set(events.filter(e => e.kind === "collection" && typeof e.feeCents === "number").map(e => e.id));
  // Validate aggregate reversals before processing so conflicts cannot depend on arrival order.
  const reversedByCollection = new Map<string, number>();
  for (const e of events) if ((e.kind === "refund" || (e.kind === "chargeback" && e.disputeStage === "lost")) && e.status === "succeeded" && e.evidence === "verified" && e.relatedEventId && e.amountCents !== null) {
    reversedByCollection.set(e.relatedEventId, (reversedByCollection.get(e.relatedEventId) ?? 0) + e.amountCents);
  }

  for (const e of events) {
    const t = e.kind === "chargeback" && e.disputeStage === "open" ? a.disputes : target[e.kind];
    if (e.kind === "collection") {
      if (e.status === "failed" || e.status === "canceled") { counts.failedCollections++; continue; }
      if (e.status === "pending") { counts.pendingCollections++; continue; }
    } else if (e.status !== "succeeded" && e.kind !== "projected_renewal" && !(e.kind === "chargeback" && e.disputeStage === "open")) continue;

    const d = eventDate(e, input.basis);
    if (!d || !validFinanceDate(d)) { t.complete = false; flag(e.id, "missing_date", `No valid ${input.basis} date`); continue; }
    if (!inPeriod(d, input.period)) continue;

    if (e.amountCents === null || e.amountCents === undefined) { t.complete = false; flag(e.id, "missing_amount", "Amount unknown"); continue; }
    if (!Number.isSafeInteger(e.amountCents) || e.amountCents < 0) { t.complete = false; flag(e.id, "invalid_amount", "Amount must be safe whole non-negative cents"); continue; }
    if (!e.currency) { t.complete = false; flag(e.id, "missing_currency", "Currency unknown"); continue; }
    if (e.currency.toUpperCase() !== currency) { t.complete = false; flag(e.id, "currency_mismatch", `${e.currency.toUpperCase()} is not summed into ${currency}`); continue; }

    if (e.kind === "projected_renewal") { a.projected.total += e.amountCents; continue; }

    if (e.evidence !== "verified") {
      a.unverified.total += e.amountCents;
      t.complete = false;
      if (e.evidence === "missing") { flag(e.id, "missing_evidence", "No evidence money moved; excluded"); }
      else flag(e.id, "unverified", "Awaiting verification; excluded");
      continue;
    }

    if (e.kind === "chargeback") {
      if (e.disputeStage === "open") { a.disputes.total += e.amountCents; continue; }
      if (e.disputeStage === "won") continue; // won = no money withdrawn
      if (e.disputeStage !== "lost") { t.complete = false; flag(e.id, "missing_evidence", "Dispute outcome unknown"); continue; }
    }

    if (e.kind === "refund" || e.kind === "chargeback") {
      const c = e.relatedEventId ? collections.get(e.relatedEventId) : undefined;
      if (!c || c.amountCents === null) { t.complete = false; flag(e.id, "missing_related_event", "Reversal has no known collection"); continue; }
      if (c.currency?.toUpperCase() !== currency || c.status !== "succeeded" || c.evidence !== "verified") { t.complete = false; flag(e.id, "missing_related_event", "Collection evidence incompatible"); continue; }
      if ((reversedByCollection.get(c.id) ?? 0) > c.amountCents) { t.complete = false; flag(e.id, "reversal_exceeds_collection", "Refund and chargeback together exceed the collection; excluded"); continue; }
    }

    if (e.kind === "processing_fee" && e.relatedEventId && feeOnCollection.has(e.relatedEventId)) {
      const collection = collections.get(e.relatedEventId);
      if (collection?.feeCents !== e.amountCents) { a.fees.complete = false; flag(e.id, "conflicting_event", "Fee representations disagree"); }
      else flag(e.id, "duplicate_fee", "Fee already carried on its collection; not subtracted twice");
      continue;
    }

    t.total += e.amountCents;
    if (e.kind === "collection") {
      counts.succeededCollections++;
      if (e.feeCents === null) { a.fees.complete = false; flag(e.id, "unknown_fee", "Provider fee unknown"); }
      else if (typeof e.feeCents === "number" && Number.isSafeInteger(e.feeCents) && e.feeCents >= 0) a.fees.total += e.feeCents;
      else { a.fees.complete = false; flag(e.id, "unknown_fee", "Supply actual fee, including explicit zero for fee-free methods"); }
    }
  }

  const grossCollected = m(a.gross), refunds = m(a.refunds), chargebacksLost = m(a.chargebacks), processingFees = m(a.fees);
  const earnedRevenue = m(a.earned);
  const netCollections = combine([[grossCollected, 1], [refunds, -1], [chargebacksLost, -1], [processingFees, -1]]);
  const operatingExpenses = m(a.expenses), customerCompensation = m(a.compensation);
  const resultRevenue = input.basis === "cash" ? netCollections : combine([[earnedRevenue, 1], [refunds, -1], [chargebacksLost, -1], [processingFees, -1]]);
  const operatingResult = combine([[resultRevenue, 1], [operatingExpenses, -1], [customerCompensation, -1]]);
  const depositLiabilityChange = combine([[m(a.depositIn), 1], [m(a.depositApplied), -1], [m(a.depositOut), -1]]);
  const actualPayouts = m(a.payouts);
  const payoutDifference = combine([[actualPayouts, 1], [netCollections, -1]]);
  const unverifiedAmount = m(a.unverified);
  const report: FinanceReport = {
    currency, basis: input.basis, period: input.period,
    grossCollected, earnedRevenue, refunds, chargebacksLost, processingFees, netCollections, operatingExpenses, customerCompensation,
    operatingResult, depositLiabilityChange, actualPayouts, payoutDifference, openDisputes: m(a.disputes),
    projectedRenewals: m(a.projected), unverifiedAmount, counts, complete: false, issues,
  };
  report.complete = [grossCollected, earnedRevenue, refunds, chargebacksLost, processingFees, operatingExpenses, customerCompensation, depositLiabilityChange, actualPayouts, operatingResult, report.openDisputes, report.projectedRenewals, unverifiedAmount].every(x => x.complete);
  return report;
}