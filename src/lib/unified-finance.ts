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
  /** Collection fee in cents; null = unknown; undefined = not applicable (non-provider method). */
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
  refunds: Measure;
  chargebacksLost: Measure;
  processingFees: Measure;
  netCollections: Measure; // gross − refunds − lost chargebacks − fees
  operatingExpenses: Measure;
  customerCompensation: Measure;
  operatingResult: Measure; // net collections − operating expenses − compensation
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
export function assertPeriod(p: { from: string; to: string }) {
  if (!DATE.test(p.from) || !DATE.test(p.to) || Number.isNaN(Date.parse(p.from)) || Number.isNaN(Date.parse(p.to))) throw new Error("Invalid period");
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
  if (e.kind === "projected_renewal") return e.recognitionDate;
  if (basis === "cash" || e.kind === "payout" || e.kind.startsWith("deposit")) return e.cashDate;
  return e.recognitionDate;
}

function sameContent(a: FinanceEvent, b: FinanceEvent) {
  return JSON.stringify({ ...a }) === JSON.stringify({ ...b });
}

export function summarizeFinance(input: { events: FinanceEvent[]; period: { from: string; to: string }; basis: FinanceBasis; currency: string }): FinanceReport {
  assertPeriod(input.period);
  const currency = input.currency.toUpperCase();
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
    gross: acc(), refunds: acc(), chargebacks: acc(), fees: acc(), expenses: acc(), compensation: acc(),
    depositIn: acc(), depositApplied: acc(), depositOut: acc(), payouts: acc(), disputes: acc(), projected: acc(), unverified: acc(),
  };
  const counts = { succeededCollections: 0, failedCollections: 0, pendingCollections: 0 };
  const target: Record<FinanceEventKind, Acc> = {
    collection: a.gross, refund: a.refunds, chargeback: a.chargebacks, processing_fee: a.fees, operating_expense: a.expenses,
    customer_compensation: a.compensation, deposit_received: a.depositIn, deposit_applied: a.depositApplied,
    deposit_returned: a.depositOut, payout: a.payouts, projected_renewal: a.projected,
  };
  const all = [...byId.values()];
  const events = all.filter(e => !conflicted.has(e.id));
  for (const id of conflicted) for (const k of Object.values(target)) if (k) { /* conflict poisons the measure it would affect */ }
  for (const id of conflicted) { const e = byId.get(id)!; target[e.kind].complete = false; }

  const collections = new Map(events.filter(e => e.kind === "collection").map(e => [e.id, e]));
  const feeOnCollection = new Set(events.filter(e => e.kind === "collection" && typeof e.feeCents === "number").map(e => e.id));
  const reversedByCollection = new Map<string, number>();

  for (const e of events) {
    const t = target[e.kind];
    if (e.kind === "collection") {
      if (e.status === "failed" || e.status === "canceled") { counts.failedCollections++; continue; }
      if (e.status === "pending") { counts.pendingCollections++; continue; }
    } else if (e.status !== "succeeded" && e.kind !== "projected_renewal" && !(e.kind === "chargeback" && e.disputeStage === "open")) continue;

    const d = eventDate(e, input.basis);
    if (!d || !DATE.test(d)) { t.complete = false; flag(e.id, "missing_date", `No ${input.basis} date`); continue; }
    if (!inPeriod(d, input.period)) continue;

    if (e.amountCents === null || e.amountCents === undefined) { t.complete = false; flag(e.id, "missing_amount", "Amount unknown"); continue; }
    if (!Number.isInteger(e.amountCents) || e.amountCents < 0) { t.complete = false; flag(e.id, "invalid_amount", "Amount must be whole non-negative cents"); continue; }
    if (!e.currency) { t.complete = false; flag(e.id, "missing_currency", "Currency unknown"); continue; }
    if (e.currency.toUpperCase() !== currency) { t.complete = false; flag(e.id, "currency_mismatch", `${e.currency.toUpperCase()} is not summed into ${currency}`); continue; }

    if (e.kind === "projected_renewal") { a.projected.total += e.amountCents; continue; }

    if (e.evidence !== "verified") {
      a.unverified.total += e.amountCents;
      if (e.evidence === "missing") { t.complete = false; flag(e.id, "missing_evidence", "No evidence money moved; excluded"); }
      else flag(e.id, "unverified", "Awaiting verification; excluded");
      continue;
    }

    if (e.kind === "chargeback") {
      if (e.disputeStage === "open") { a.disputes.total += e.amountCents; continue; }
      if (e.disputeStage !== "lost") continue; // won = no money withdrawn
    }

    if (e.kind === "refund" || e.kind === "chargeback") {
      const c = e.relatedEventId ? collections.get(e.relatedEventId) : undefined;
      if (!c || c.amountCents === null) { t.complete = false; flag(e.id, "missing_related_event", "Reversal has no known collection"); continue; }
      const already = reversedByCollection.get(c.id) ?? 0;
      if (already + e.amountCents > c.amountCents) { t.complete = false; flag(e.id, "reversal_exceeds_collection", "Refund and chargeback together exceed the collection; excluded"); continue; }
      reversedByCollection.set(c.id, already + e.amountCents);
    }

    if (e.kind === "processing_fee" && e.relatedEventId && feeOnCollection.has(e.relatedEventId)) {
      flag(e.id, "duplicate_fee", "Fee already carried on its collection; not subtracted twice"); continue;
    }

    t.total += e.amountCents;
    if (e.kind === "collection") {
      counts.succeededCollections++;
      if (e.feeCents === null) { a.fees.complete = false; flag(e.id, "unknown_fee", "Provider fee unknown"); }
      else if (typeof e.feeCents === "number") a.fees.total += e.feeCents;
      else if (e.method === "stripe") { a.fees.complete = false; flag(e.id, "unknown_fee", "Provider fee not supplied"); }
    }
  }

  const grossCollected = m(a.gross), refunds = m(a.refunds), chargebacksLost = m(a.chargebacks), processingFees = m(a.fees);
  const netCollections = combine([[grossCollected, 1], [refunds, -1], [chargebacksLost, -1], [processingFees, -1]]);
  const operatingExpenses = m(a.expenses), customerCompensation = m(a.compensation);
  const operatingResult = combine([[netCollections, 1], [operatingExpenses, -1], [customerCompensation, -1]]);
  const depositLiabilityChange = combine([[m(a.depositIn), 1], [m(a.depositApplied), -1], [m(a.depositOut), -1]]);
  const actualPayouts = m(a.payouts);
  const payoutDifference = combine([[actualPayouts, 1], [netCollections, -1]]);
  const unverifiedAmount = { value: a.unverified.total, complete: true };
  const report: FinanceReport = {
    currency, basis: input.basis, period: input.period,
    grossCollected, refunds, chargebacksLost, processingFees, netCollections, operatingExpenses, customerCompensation,
    operatingResult, depositLiabilityChange, actualPayouts, payoutDifference, openDisputes: m(a.disputes),
    projectedRenewals: m(a.projected), unverifiedAmount, counts, complete: false, issues,
  };
  report.complete = [grossCollected, refunds, chargebacksLost, processingFees, operatingExpenses, customerCompensation, depositLiabilityChange, actualPayouts].every(x => x.complete);
  return report;
}