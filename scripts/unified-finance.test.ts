import { describe, expect, it } from "vitest";
import { summarizeFinance, type FinanceEvent } from "../src/lib/unified-finance";
import { compensation, period, syntheticEvent, weeklyPayments } from "./fixtures/unified-finance";

const report = (events: FinanceEvent[], overrides: Partial<Parameters<typeof summarizeFinance>[0]> = {}) =>
  summarizeFinance({ events, period, basis: "cash", currency: "USD", coverage: "complete", ...overrides });
const adjustment = (kind: FinanceEvent["kind"], amountCents: number, extra: Partial<FinanceEvent> = {}) =>
  syntheticEvent({ id: `synthetic-${kind}`, kind, amountCents, feeCents: undefined, relatedEventId: "synthetic-receipt-a", ...extra });

describe("Unified finance synthetic reporting", () => {
  it("counts three weekly $350 payments once each", () => {
    const r = report(weeklyPayments);
    expect(r.grossCollected.value).toBe(105000);
    expect(r.processingFees.value).toBe(3135);
    expect(r.netCollections.value).toBe(101865);
    expect(r.counts.succeededCollections).toBe(3);
  });
  it("classifies $50 Zelle customer compensation as expense, not refund or revenue", () => {
    const r = report([...weeklyPayments, compensation]);
    expect(r.customerCompensation.value).toBe(5000);
    expect(r.refunds.value).toBe(0);
    expect(r.grossCollected.value).toBe(105000);
    expect(r.operatingResult.value).toBe(96865);
  });
  it("deducts a partial refund", () => {
    const r = report([syntheticEvent(), adjustment("refund", 5000)]);
    expect(r.refunds.value).toBe(5000);
    expect(r.netCollections.value).toBe(28955);
  });
  it("keeps current refunds of older receipts", () => {
    const r = report([syntheticEvent({ cashDate: "2026-09-08" }), adjustment("refund", 5000)]);
    expect(r.grossCollected.value).toBe(0);
    expect(r.netCollections.value).toBe(-5000);
  });
  it("does not collect failed or pending attempts", () => {
    const r = report([syntheticEvent({ id: "synthetic-failure", status: "failed" }), syntheticEvent({ status: "pending" })]);
    expect(r.grossCollected.value).toBe(0);
    expect(r.processingFees.value).toBe(0);
    expect(r.counts.failedCollections).toBe(1);
    expect(r.counts.pendingCollections).toBe(1);
  });
  it("never counts projected renewals as collected", () => {
    const r = report([adjustment("projected_renewal", 35000, { status: "pending" })]);
    expect(r.grossCollected.value).toBe(0);
    expect(r.projectedRenewals.value).toBe(35000);
  });
  it("keeps fees and net unavailable when actual fees are missing", () => {
    const r = report([syntheticEvent({ feeCents: null })]);
    expect(r.grossCollected.value).toBe(35000);
    expect(r.processingFees.value).toBeNull();
    expect(r.netCollections.value).toBeNull();
    expect(r.complete).toBe(false);
  });
  it.each(["stripe", "zelle", "cash_app", "venmo", "cash", "bank_transfer", "other"] as const)("requires an explicit actual fee even for %s", method => {
    expect(report([syntheticEvent({ method, feeCents: undefined })]).processingFees.value).toBeNull();
    expect(report([syntheticEvent({ method, feeCents: 0 })]).processingFees.value).toBe(0);
  });
  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects missing/invalid cents %s", amountCents => {
    expect(report([syntheticEvent({ amountCents })]).grossCollected.value).toBeNull();
  });
  it("keeps genuine zero distinct from unknown", () => {
    expect(report([syntheticEvent({ amountCents: 0, feeCents: 0 })]).grossCollected.value).toBe(0);
  });
  it("does not treat unavailable empty data as zero", () => {
    expect(report([], { coverage: "unavailable" }).grossCollected.value).toBeNull();
    expect(report([], { coverage: "incomplete" }).actualPayouts.value).toBeNull();
    expect(report([]).grossCollected.value).toBe(0);
  });
  it.each(["missing", "unverified"] as const)("excludes %s evidence and marks the affected total incomplete", evidence => {
    const r = report([syntheticEvent({ evidence })]);
    expect(r.grossCollected.value).toBeNull();
    expect(r.unverifiedAmount.value).toBe(35000);
    expect(r.counts.succeededCollections).toBe(0);
  });
  it.each([null, "EUR"])("never assumes or converts currency %s", currency => {
    const r = report([syntheticEvent({ currency })]);
    expect(r.grossCollected.value).toBeNull();
    expect(r.complete).toBe(false);
  });
  it("rejects a non-USD report request", () => {
    expect(() => report([], { currency: "JPY" })).toThrow("USD");
  });
  it("deduplicates identical event copies", () => {
    const e = syntheticEvent();
    expect(report([e, { ...e }]).grossCollected.value).toBe(35000);
  });
  it("fails closed on contradictory event copies", () => {
    const r = report([syntheticEvent(), syntheticEvent({ amountCents: 15000 })]);
    expect(r.grossCollected.value).toBeNull();
    expect(r.netCollections.value).toBeNull();
  });
  it("does not subtract the same actual fee twice", () => {
    const r = report([syntheticEvent(), adjustment("processing_fee", 1045)]);
    expect(r.processingFees.value).toBe(1045);
    expect(r.netCollections.value).toBe(33955);
  });
  it("quarantines contradictory fee evidence", () => {
    expect(report([syntheticEvent(), adjustment("processing_fee", 999)]).processingFees.value).toBeNull();
  });
  it("separates actual payout from calculated net", () => {
    const r = report([syntheticEvent(), adjustment("payout", 30000)]);
    expect(r.grossCollected.value).toBe(35000);
    expect(r.actualPayouts.value).toBe(30000);
    expect(r.payoutDifference.value).toBe(-3955);
  });
  it("treats received/applied/returned deposits only as liability changes", () => {
    const r = report([adjustment("deposit_received", 20000), adjustment("deposit_applied", 5000), adjustment("deposit_returned", 3000)]);
    expect(r.depositLiabilityChange.value).toBe(12000);
    expect(r.grossCollected.value).toBe(0);
    expect(r.netCollections.value).toBe(0);
  });
  it("shows open disputes as exposure, not a refund", () => {
    const r = report([syntheticEvent(), adjustment("chargeback", 35000, { disputeStage: "open", status: "pending" })]);
    expect(r.openDisputes.value).toBe(35000);
    expect(r.chargebacksLost.value).toBe(0);
    expect(r.netCollections.value).toBe(33955);
  });
  it("deducts actual lost chargebacks and keeps won disputes out", () => {
    expect(report([syntheticEvent(), adjustment("chargeback", 35000, { disputeStage: "lost" })]).netCollections.value).toBe(-1045);
    expect(report([syntheticEvent(), adjustment("chargeback", 35000, { disputeStage: "won" })]).netCollections.value).toBe(33955);
  });
  it("does not over-deduct overlapping refunds and chargebacks in either order", () => {
    const events = [syntheticEvent(), adjustment("refund", 5000), adjustment("chargeback", 35000, { disputeStage: "lost" })];
    for (const list of [events, [...events].reverse()]) {
      const r = report(list);
      expect(r.refunds.value).toBeNull();
      expect(r.chargebacksLost.value).toBeNull();
      expect(r.netCollections.value).toBeNull();
    }
  });
  it("does not invent a parent collection for a refund", () => {
    expect(report([adjustment("refund", 5000)]).refunds.value).toBeNull();
  });
  it("uses actual cash dates even in an accrual report's collected measure", () => {
    const e = syntheticEvent({ cashDate: "2026-11-02", recognitionDate: "2026-10-08" });
    expect(report([e], { basis: "accrual" }).grossCollected.value).toBe(0);
  });
  it("uses explicit recognized revenue for accrual result, never invoices as cash", () => {
    const earned = adjustment("earned_revenue", 35000, { cashDate: null });
    const expense = adjustment("operating_expense", 6000, { cashDate: "2026-11-02" });
    const accrual = report([earned, expense], { basis: "accrual" });
    expect(accrual.earnedRevenue.value).toBe(35000);
    expect(accrual.grossCollected.value).toBe(0);
    expect(accrual.operatingResult.value).toBe(29000);
    expect(report([expense]).operatingExpenses.value).toBe(0);
  });
  it("uses inclusive start and exclusive end dates", () => {
    const events = [syntheticEvent({ id: "synthetic-start", cashDate: period.from }), syntheticEvent({ id: "synthetic-end", cashDate: period.to })];
    expect(report(events).grossCollected.value).toBe(35000);
  });
  it("rejects invalid, impossible or reversed periods", () => {
    for (const p of [{ from: "bad", to: period.to }, { from: "2026-02-30", to: period.to }, { from: period.to, to: period.from }]) expect(() => report([], { period: p })).toThrow();
  });
  it("does not mutate input events", () => {
    const e = Object.freeze(syntheticEvent());
    expect(report([e]).grossCollected.value).toBe(35000);
    expect(e.id).toBe("synthetic-receipt-a");
  });
  it("marks unknown dispute outcomes unavailable", () => {
    expect(report([syntheticEvent(), adjustment("chargeback", 5000, { disputeStage: null })]).chargebacksLost.value).toBeNull();
  });
  it("marks unknown open-dispute evidence unavailable without inventing a loss", () => {
    const r = report([adjustment("chargeback", 5000, { disputeStage: "open", evidence: "missing" })]);
    expect(r.openDisputes.value).toBeNull();
    expect(r.chargebacksLost.value).toBe(0);
    expect(r.complete).toBe(false);
  });
  it("marks missing collection dates unavailable", () => {
    expect(report([syntheticEvent({ cashDate: null })]).grossCollected.value).toBeNull();
  });
  it("includes known operating costs separately from compensation", () => {
    const r = report([syntheticEvent(), adjustment("operating_expense", 6000), compensation]);
    expect(r.operatingExpenses.value).toBe(6000);
    expect(r.customerCompensation.value).toBe(5000);
    expect(r.operatingResult.value).toBe(22955);
  });
});