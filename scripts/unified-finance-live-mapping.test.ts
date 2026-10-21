import { describe, expect, it } from "vitest";
import { c1SourceContract, decimalSourceCents, expenseSourceContract, mapFinanceSource, mapLedgerBatch, operationalPaymentContract, settlementSourceContract } from "../src/lib/unified-finance-live-mapping";
import { reconcileFinance } from "../src/lib/unified-finance-reconciliation";
import { summarizeFinance } from "../src/lib/unified-finance";
import { actor, charge, facts, ledger, scope } from "./fixtures/unified-finance-live-readers";
import { buildMockUnifiedFinanceReport } from "../src/lib/unified-finance-report.server";
import { FINANCE_SOURCES, type FinanceReadPlan } from "../src/lib/unified-finance-contract";
import type { Representation } from "../src/lib/unified-finance-reconciliation";
const representation = (mapped: ReturnType<typeof mapFinanceSource>): Representation => { if (!mapped.row?.representation) throw new Error("Missing mock representation"); return mapped.row.representation; };
describe("Isolated live-shaped financial field mapping", () => {
  it("maps immutable provider fields and integer cents without current-vehicle inference", () => {
    const r = mapFinanceSource("stripe", charge(), scope); expect(r.reasons).toEqual([]);
    expect(r.row?.representation?.event).toMatchObject({ amountCents: 35000, cashDate: "2026-10-18", currency: "USD", feeCents: 1045, vehicleId: null });
  });
  it.each([{ identities: [] }, { amountCents: null }, { amountCents: 1.5 }, { amountCents: -1 }, { currency: null }, { feeCents: null }, { cashDate: null }, { cashDate: "2026-02-30" }])("marks missing financial evidence incomplete %j", override => {
    expect(mapFinanceSource("stripe", charge(override), scope).reasons.length).toBeGreaterThan(0);
  });
  it("rejects provider scope collisions and parent-only child identity", () => {
    expect(mapFinanceSource("stripe", charge(), { ...scope, account: "other-account" }).reasons.length).toBeGreaterThan(0);
    expect(mapFinanceSource("stripe", charge({ object: "refund", kind: "refund", parentChargeId: "synthetic-charge" }), scope).reasons).toContain("Missing scoped provider money-event identity");
  });
  it("reconciles Stripe/payment/C1 copies once with separate posting and verification", () => {
    const provider = representation(mapFinanceSource("stripe", charge(), scope));
    const payment = representation(mapFinanceSource("payments", { ...facts(), id: "synthetic-payment", paymentId: "synthetic-payment", visibility: "operating" }));
    const c1 = representation(mapFinanceSource("ledger", ledger()));
    expect(reconcileFinance([provider, payment, c1]).events).toHaveLength(1);
    expect(mapFinanceSource("ledger", ledger({ verified: false })).row?.representation?.event.evidence).toBe("unverified");
  });
  it("two methods are distinct receipts, not one combined charge", () => {
    const a = representation(mapFinanceSource("payments", { ...facts({ amountCents: 20000 }), id: "synthetic-a", paymentId: "synthetic-a", visibility: "operating" }));
    const b = representation(mapFinanceSource("payments", { ...facts({ amountCents: 15000, method: "cash", identities: [], feeCents: 0 }), id: "synthetic-b", paymentId: "synthetic-b", visibility: "operating" }));
    const r = reconcileFinance([a, b]); expect(r.events).toHaveLength(2); expect(r.events.reduce((n, e) => n + (e.amountCents ?? 0), 0)).toBe(35000);
  });
  it("historical charge supports two independent current refunds without current gross", () => {
    const parent = representation(mapFinanceSource("stripe", charge({ cashDate: "2026-09-18" }), scope));
    const refunds = ["synthetic-refund-a", "synthetic-refund-b"].map(id => representation(mapFinanceSource("stripe", charge({ id, object: "refund", kind: "refund", amountCents: 2500,
      parentChargeId: "synthetic-charge", identities: [{ provider: "stripe", ...scope, object: "refund", id }] }), scope)));
    const r = summarizeFinance({ events: reconcileFinance([parent, ...refunds, refunds[0] as Representation]).events, period: { from: "2026-10-01", to: "2026-11-01" }, basis: "cash", currency: "USD", coverage: "complete" });
    expect(r.refunds.value).toBe(5000); expect(r.grossCollected.value).toBe(0);
  });
  it("fee identities stay separate from refunded and collected amounts", () => {
    const fee = mapFinanceSource("stripe", charge({ id: "synthetic-fee", kind: "processing_fee", object: "balance_transaction", amountCents: 1500, relatedEventId: "synthetic-charge",
      identities: [{ provider: "stripe", ...scope, object: "balance_transaction", id: "synthetic-fee" }] }), scope);
    expect(fee.reasons).toEqual([]); expect(fee.row?.representation?.event.feeCents).toBeUndefined();
  });
  it("corrected originals and opposite-direction reversals are represented without negative amounts", () => {
    const original = ledger({ id: "synthetic-original", transactionId: "synthetic-original", kind: "operating_expense", direction: "out", posting: "corrected", amountCents: 3000 });
    const reversal = ledger({ id: "synthetic-reverse", transactionId: "synthetic-reverse", kind: "operating_expense", direction: "in", reversesId: original.transactionId, amountCents: 3000 });
    const correction = ledger({ id: "synthetic-correct", transactionId: "synthetic-correct", kind: "operating_expense", direction: "out", correctsId: original.transactionId, amountCents: 2500 });
    const r = mapLedgerBatch([original, reversal, correction]); expect(r.flatMap(m => m.reasons)).toEqual([]);
    expect(r[0]?.row?.posting).toBe("reversed"); expect(r[1]?.row?.representation?.event.amountCents).toBe(3000);
    expect(mapLedgerBatch([original, { ...reversal, direction: "out" }]).flatMap(m => m.reasons)).toContain("Unsupported or invalid directional reversal");
    expect(mapLedgerBatch([correction]).flatMap(m => m.reasons)).toContain("Missing correction/reversal evidence");
  });
  it("collection reversals remain unsupported rather than invented refunds", () => {
    const r = mapLedgerBatch([ledger({ posting: "reversed" }), ledger({ id: "synthetic-reverse", transactionId: "synthetic-reverse", reversesId: "synthetic-c1", direction: "out" })]);
    expect(r.flatMap(m => m.reasons)).toContain("Unsupported or invalid directional reversal");
  });
  it("settlement facts require positive cents and links", () => {
    expect(mapFinanceSource("settlements", { id: "synthetic-s", paymentId: "synthetic-p", obligationId: "synthetic-o", amountCents: 1000, currency: "USD", visibility: "operating" }).reasons).toEqual([]);
    expect(mapFinanceSource("settlements", { id: "synthetic-s", paymentId: "", obligationId: "synthetic-o", amountCents: null, currency: null, visibility: "operating" }).row).toBeNull();
  });
  it("expense identity links expense/C1 without memo matching", () => {
    const e = representation(mapFinanceSource("expenses", { ...facts({ kind: "operating_expense" }), id: "synthetic-expense", expenseId: "synthetic-expense", visibility: "operating" }));
    const c = representation(mapFinanceSource("ledger", ledger({ kind: "operating_expense", direction: "out", expenseId: "synthetic-expense" })));
    expect(reconcileFinance([e, c]).events).toHaveLength(1);
  });
  it.each([["350.00", 35000], ["0.01", 1], ["1.5", 150], ["1.005", null], ["-1", null], ["1e3", null], ["90071992547409.92", null]])("converts exact source decimal %s without rounding", (amount, cents) => {
    expect(decimalSourceCents(amount as string)).toBe(cents);
  });
  it("uses operational original charge fields, not net or cumulative refunded amount", () => {
    const f = facts(); const evidence = { customerId: f.customerId, verified: f.verified, feeCents: f.feeCents, currency: f.currency, method: f.method, identities: f.identities, cashDate: null, kind: f.kind };
    const p = operationalPaymentContract({ id: "synthetic-payment", amount: "350.00", status: "refunded", paid_date: "2026-10-18T12:00:00Z", driver_id: "synthetic-customer", rental_id: "synthetic-rental", type: "weekly", stripe_payment_intent_id: null, stripe_invoice_id: null }, evidence);
    expect(p.amountCents).toBe(35000); expect(p.cashDate).toBe("2026-10-18"); expect(p.status).toBe("succeeded");
  });
  it("maps C1 source fields and rejects unclassified capital/financing facts", () => {
    const f = facts(); const evidence = { customerId: f.customerId, verified: true, feeCents: f.feeCents, currency: f.currency, method: f.method, identities: f.identities, cashDate: f.cashDate, kind: null };
    const p = { id: "synthetic-c1", amount: "350.00", currency: "USD", txn_type: "payment", status: "posted" as const, direction: "in" as const, sensitivity: "owner_only" as const,
      recognition_date: null, cash_date: "2026-10-18", rental_id: "synthetic-rental", payment_id: "synthetic-payment", expense_id: null, reverses_id: null, corrects_id: null };
    expect(c1SourceContract(p, evidence)).toMatchObject({ kind: "collection", visibility: "owner_only", paymentId: "synthetic-payment", amountCents: 35000 });
    expect(() => c1SourceContract({ ...p, txn_type: "financing_draw" }, evidence)).toThrow("Unsupported");
  });
  it("expense incurred date is not proof of paid date, currency or payment verification", () => {
    const e = expenseSourceContract({ id: "synthetic-e", amount: "30.00", incurred_on: "2026-10-18", rental_id: null, category: "repair" }, { customerId: null, verified: false, feeCents: null, currency: null, method: null, identities: [], cashDate: null, kind: null });
    expect(e.cashDate).toBeNull(); expect(e.recognitionDate).toBe("2026-10-18"); expect(e.status).toBe("pending"); expect(mapFinanceSource("expenses", e).reasons.length).toBeGreaterThan(0);
  });
  it("settlement projection uses C1 endpoints and requires currency from evidence", () => {
    const p = { id: "synthetic-s", obligation_id: "synthetic-o", payment_txn_id: "synthetic-p", amount: "10.00", status: "posted" };
    expect(settlementSourceContract(p, null)).toMatchObject({ paymentId: "synthetic-p", obligationId: "synthetic-o", currency: null, amountCents: 1000 });
    expect(settlementSourceContract({ ...p, status: "reversed" }, "USD")).toBeNull();
  });
  it("malformed source payload reports incomplete instead of throwing", () => {
    expect(mapFinanceSource("stripe", { ...charge(), id: null } as unknown as ReturnType<typeof charge>, scope).reasons).toContain("Malformed source facts");
  });
  it("unposted corrections and currency conflicts cannot pass evidence checks", () => {
    const original = ledger({ posting: "corrected", kind: "operating_expense", direction: "out" });
    const reversal = ledger({ id: "synthetic-r", transactionId: "synthetic-r", kind: "operating_expense", direction: "in", reversesId: original.transactionId });
    const correction = ledger({ id: "synthetic-c", transactionId: "synthetic-c", kind: "operating_expense", direction: "out", posting: "discarded", correctsId: original.transactionId });
    expect(mapLedgerBatch([original, reversal, correction]).flatMap(m => m.reasons)).toContain("Missing correction/reversal evidence");
  });
  it("mapped correction chain reaches unchanged Phase 2 projection with 2500 cents", async () => {
    const original = ledger({ id: "synthetic-original", transactionId: "synthetic-original", kind: "operating_expense", direction: "out", posting: "corrected", amountCents: 3000, identities: [], paymentId: null });
    const reversal = ledger({ id: "synthetic-reverse", transactionId: "synthetic-reverse", kind: "operating_expense", direction: "in", reversesId: original.transactionId, amountCents: 3000, identities: [], paymentId: null });
    const correction = ledger({ id: "synthetic-correct", transactionId: "synthetic-correct", kind: "operating_expense", direction: "out", correctsId: original.transactionId, amountCents: 2500, identities: [], paymentId: null });
    const mapped = mapLedgerBatch([original, reversal, correction]);
    const plan: FinanceReadPlan = Object.fromEntries(FINANCE_SOURCES.map(s => [s, async () => ({ rows: s === "ledger" ? mapped.flatMap(m => m.row ? [m.row] : []) : [], nextCursor: null })]));
    const r = await buildMockUnifiedFinanceReport({ period: { from: "2026-10-01", to: "2026-11-01" }, basis: "cash", currency: "USD" }, actor, plan);
    expect(r.complete).toBe(true); expect(r.postedLedger.operatingExpenses.value).toBe(2500);
  });
});