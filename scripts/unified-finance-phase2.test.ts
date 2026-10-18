import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { unifiedFinanceRequestSchema } from "../src/lib/unified-finance-contract";
import { buildMockUnifiedFinanceReport, disabledUnifiedFinanceResponse, UNIFIED_FINANCE_ENDPOINT_ENABLED } from "../src/lib/unified-finance-report.server";
import { readFinancePages } from "../src/lib/unified-finance-readers.server";
import { readMockStripeFinance } from "../src/lib/unified-finance-stripe.server";
import { clearUnifiedFinanceQueries, unifiedFinanceQueryOptions } from "../src/lib/unified-finance-query";
import { identity, request, mockPlan, sourceRow, duplicateRows, refundRow } from "./fixtures/unified-finance-phase2";
import { syntheticEvent, syntheticRepresentation } from "./fixtures/unified-finance";

describe("Phase 2 isolated reporting", () => {
  it("reconciles provider/payment/C1 collections without adding ledger twice", async () => {
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan(duplicateRows));
    expect(r.verifiedCollections.grossCollected.value).toBe(35000);
    expect(r.verifiedCollections.processingFees.value).toBe(1045);
    expect(r.postedLedger.grossCollected.value).toBe(35000);
    expect(r.reconciliation.verified.groups).toHaveLength(1);
  });
  it("keeps partial historical refunds independent of parent reporting period", async () => {
    const old = sourceRow({ representation: syntheticRepresentation({ event: syntheticEvent({ cashDate: "2026-09-08", recognitionDate: "2026-09-08" }) }) });
    const a = refundRow("synthetic-refund-a"), b = refundRow("synthetic-refund-b", 3000);
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: [old, a, b, { ...a, id: "synthetic-refund-copy" }] }));
    expect(r.verifiedCollections.refunds.value).toBe(8000);
    expect(r.verifiedCollections.netCollections.value).toBe(-8000);
  });
  it.each([{ feeCents: null }, { currency: null }, { cashDate: null }, { amountCents: null }])("missing financial fact %j withholds complete totals", async facts => {
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: [sourceRow({ representation: syntheticRepresentation({ event: syntheticEvent(facts) }) })] }));
    expect(r.verifiedCollections.netCollections.value).toBeNull(); expect(r.complete).toBe(false);
  });
  it("missing immutable identity is not inferred from matching money/date", async () => {
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: [sourceRow({ representation: syntheticRepresentation({ identities: [] }) })] }));
    expect(r.reconciliation.verified.counts.Incomplete).toBe(1); expect(r.complete).toBe(false);
  });
  it("posting alone cannot establish verified collections", async () => {
    const row = sourceRow({ posting: "posted", representation: syntheticRepresentation({ c1TransactionId: "synthetic-c1", identities: [], event: syntheticEvent({ evidence: "unverified" }) }) });
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ ledger: [row] }));
    expect(r.verifiedCollections.grossCollected.value).toBe(0);
    expect(r.postedLedger.grossCollected.value).toBeNull();
  });
  it("draft ledger entries never become posted totals", async () => {
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ ledger: [sourceRow({ posting: "draft" })] }));
    expect(r.postedLedger.grossCollected.value).toBe(0);
  });
  it("settlement links do not count obligation and payment as two collections", async () => {
    const payment = sourceRow({ id: "synthetic-payment", posting: "posted", representation: syntheticRepresentation({ c1TransactionId: "synthetic-pay" }) });
    const obligation = sourceRow({ id: "synthetic-obligation", posting: "posted", representation: syntheticRepresentation({ identities: [], c1TransactionId: "synthetic-invoice", event: syntheticEvent({ id: "synthetic-earned", kind: "earned_revenue" }) }) });
    const link = sourceRow({ id: "synthetic-settlement", representation: undefined, settlement: { paymentId: payment.id, obligationId: obligation.id, amountCents: 35000, currency: "USD" } });
    const r = await buildMockUnifiedFinanceReport({ ...request, basis: "accrual" }, identity, mockPlan({ ledger: [payment, obligation], settlements: [link] }));
    expect(r.postedLedger.grossCollected.value).toBe(35000); expect(r.postedLedger.earnedRevenue.value).toBe(35000);
    const invalid = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ ledger: [payment, obligation], settlements: [link, { ...link, id: "synthetic-overlink" }] }));
    expect(invalid.complete).toBe(false); expect(invalid.issues.some(i => i.includes("exceeds source"))).toBe(true);
  });
  it("explicit same-period reversal and correction replace rather than duplicate expense", async () => {
    const event = syntheticEvent({ kind: "operating_expense", amountCents: 5000, feeCents: undefined });
    const old = sourceRow({ id: "synthetic-old", posting: "reversed", representation: syntheticRepresentation({ identities: [], c1TransactionId: "synthetic-old", event }) });
    const reversal = sourceRow({ id: "synthetic-reversal", posting: "posted", reversesId: old.id, representation: syntheticRepresentation({ identities: [], c1TransactionId: "synthetic-reversal", event: { ...event, id: "synthetic-reversal-event" } }) });
    const corrected = sourceRow({ id: "synthetic-corrected", posting: "posted", correctsId: old.id, representation: syntheticRepresentation({ identities: [], c1TransactionId: "synthetic-corrected", event: { ...event, id: "synthetic-corrected-event", amountCents: 3000 } }) });
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ ledger: [old, reversal, corrected] }));
    expect(r.postedLedger.operatingExpenses.value).toBe(3000);
    const missing = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ ledger: [old, corrected] }));
    expect(missing.complete).toBe(false);
  });
  it("expense and its linked posted C1 record count once", async () => {
    const event = syntheticEvent({ kind: "operating_expense", amountCents: 6000, feeCents: undefined });
    const expense = sourceRow({ expenseId: "synthetic-expense", representation: syntheticRepresentation({ identities: [], event }) });
    const c1 = { ...expense, id: "synthetic-c1-expense", posting: "posted" as const, representation: { ...expense.representation, id: "synthetic-c1-expense", source: "c1" as const, event, identities: [], c1TransactionId: "synthetic-expense-ledger" } };
    const r = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ expenses: [expense], ledger: [c1] }));
    expect(r.verifiedCollections.operatingExpenses.value).toBe(6000);
  });
  it.each(["coordinator", "driver", "user", "partner"])("denies %s before any injected read", async role => {
    const read = vi.fn();
    await expect(buildMockUnifiedFinanceReport(request, { userId: "synthetic-user", roles: [role] }, { stripe: read })).rejects.toThrow("Forbidden");
    expect(read).not.toHaveBeenCalled();
  });
  it("denies anonymous and unavailable current role evidence", async () => {
    const read = vi.fn();
    await expect(buildMockUnifiedFinanceReport(request, { userId: null, roles: ["admin"] }, { stripe: read })).rejects.toThrow("Forbidden");
    await expect(buildMockUnifiedFinanceReport(request, { userId: "synthetic-user", roles: [] }, { stripe: read })).rejects.toThrow("Forbidden");
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["admin", "team"])("disabled response for %s never invokes reporting readers", role => {
    expect(UNIFIED_FINANCE_ENDPOINT_ENABLED).toBe(false);
    expect(disabledUnifiedFinanceResponse("synthetic-staff", [role])).toEqual({ status: "disabled", report: null });
  });
  it("Manager excludes owner-only values before reconciliation and aggregation", async () => {
    const secret = sourceRow({ id: "synthetic-owner-only", visibility: "owner_only", representation: syntheticRepresentation({ event: syntheticEvent({ amountCents: 900000 }) }) });
    const manager = await buildMockUnifiedFinanceReport(request, { ...identity, roles: ["team"] }, mockPlan({ stripe: [secret] }));
    expect(manager.verifiedCollections.grossCollected.value).toBe(0);
    expect(JSON.stringify(manager)).not.toContain("900000");
    const owner = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: [secret] }));
    expect(owner.verifiedCollections.grossCollected.value).toBe(900000);
  });
  it("current vehicle field is insufficient for historical vehicle scope", async () => {
    const vehicleId = "00000000-0000-4000-8000-000000000001";
    const r = await buildMockUnifiedFinanceReport({ ...request, vehicleId }, identity, mockPlan({ stripe: [sourceRow({ representation: syntheticRepresentation({ event: syntheticEvent({ vehicleId }) }) })] }));
    expect(r.attributionComplete.vehicle).toBe(false); expect(r.verifiedCollections.netCollections.value).toBeNull();
  });
  it("validated dated evidence permits one-vehicle scope without permanent numbering", async () => {
    const vehicleId = "00000000-0000-4000-8000-000000000001";
    const relationship = sourceRow({ representation: undefined, relationship: { eventId: "synthetic-receipt-a", customerId: "synthetic-customer-a", rentalId: "synthetic-booking-a", servicePeriod: request.period,
      allocations: [{ vehicleId, ...request.period, amountCents: 35000 }] } });
    const r = await buildMockUnifiedFinanceReport({ ...request, vehicleId }, identity, mockPlan({ stripe: [sourceRow()], relationships: [relationship] }));
    expect(r.attributionComplete.vehicle).toBe(true); expect(r.verifiedCollections.grossCollected.value).toBe(35000);
  });
  it("rejects invalid periods, currency and client actor overrides", () => {
    expect(unifiedFinanceRequestSchema.safeParse({ ...request, actor: "owner" }).success).toBe(false);
    expect(unifiedFinanceRequestSchema.safeParse({ ...request, currency: "EUR" }).success).toBe(false);
    expect(unifiedFinanceRequestSchema.safeParse({ ...request, period: { from: "2026-02-30", to: "2026-11-01" } }).success).toBe(false);
  });
});

describe("Read-only pagination and session boundaries", () => {
  it("deduplicates identical overlapping pages", async () => {
    const row = sourceRow(); const read = vi.fn().mockResolvedValueOnce({ rows: [row], nextCursor: "synthetic-next" }).mockResolvedValueOnce({ rows: [row], nextCursor: null });
    const r = await readMockStripeFinance(read, "owner"); expect(r.rows).toHaveLength(1); expect(r.coverage.state).toBe("complete");
  });
  it("conflicting overlap withholds all partial data", async () => {
    const read = vi.fn().mockResolvedValueOnce({ rows: [sourceRow()], nextCursor: "synthetic-next" }).mockResolvedValueOnce({ rows: [sourceRow({ posting: "draft" })], nextCursor: null });
    expect((await readFinancePages(read, "owner")).rows).toEqual([]);
  });
  it("page failure cannot turn partial evidence into complete zero", async () => {
    const read = vi.fn().mockResolvedValueOnce({ rows: [sourceRow()], nextCursor: "synthetic-next" }).mockRejectedValueOnce(new Error("synthetic failure"));
    const r = await buildMockUnifiedFinanceReport(request, identity, { ...mockPlan(), stripe: read });
    expect(r.sources.stripe.state).toBe("incomplete"); expect(r.verifiedCollections.grossCollected.value).toBeNull();
  });
  it("missing readers and first-page failure are unavailable", async () => {
    const r = await buildMockUnifiedFinanceReport(request, identity, { stripe: vi.fn().mockRejectedValue(new Error("synthetic failure")) });
    expect(r.sources.stripe.state).toBe("unavailable"); expect(r.sources.payments.state).toBe("unavailable"); expect(r.complete).toBe(false);
  });
  it("repeated cursors stop instead of looping", async () => {
    const read = vi.fn().mockResolvedValue({ rows: [sourceRow()], nextCursor: "synthetic-same" });
    expect((await readFinancePages(read, "owner")).coverage.state).toBe("incomplete"); expect(read).toHaveBeenCalledTimes(2);
  });
  it("rejects delayed responses after a session change and clears caches", async () => {
    const client = new QueryClient(); let session = { userId: "synthetic-a", revision: 1 };
    let finish: ((value: { status: "disabled"; report: null }) => void) | undefined;
    const delayed = vi.fn(() => new Promise<{ status: "disabled"; report: null }>(resolve => { finish = resolve; }));
    const options = unifiedFinanceQueryOptions(request, session, () => session, delayed);
    expect(options.enabled).toBe(false); expect(options.refetchInterval).toBe(false);
    const pending = client.fetchQuery(options);
    session = { userId: "synthetic-b", revision: 2 };
    if (!finish) throw new Error("Mock query did not start");
    finish({ status: "disabled", report: null });
    await expect(pending).rejects.toThrow("session changed");
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    await clearUnifiedFinanceQueries(client); expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("signed-out query refuses even explicit fetch before any read", async () => {
    const client = new QueryClient(); const session = { userId: null, revision: 1 }; const read = vi.fn();
    await expect(client.fetchQuery(unifiedFinanceQueryOptions(request, session, () => session, read))).rejects.toThrow("session changed");
    expect(read).not.toHaveBeenCalled();
  });
});