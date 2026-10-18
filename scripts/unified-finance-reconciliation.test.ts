import { describe, expect, it } from "vitest";
import { providerIdentityKey, reconcileFinance, validateVehicleAllocations } from "../src/lib/unified-finance-reconciliation";
import { summarizeFinance } from "../src/lib/unified-finance";
import { duplicateRepresentations, period, syntheticEvent, syntheticRepresentation } from "./fixtures/unified-finance";

describe("Unified finance synthetic reconciliation", () => {
  it("matches Stripe Charge/Invoice/PaymentIntent, operational and C1 as one receipt", () => {
    const result = reconcileFinance(duplicateRepresentations);
    expect(result.groups).toHaveLength(1);
    expect(result.counts.Matched).toBe(1);
    const r = summarizeFinance({ events: result.events, period, basis: "cash", currency: "USD", coverage: result.complete ? "complete" : "incomplete" });
    expect(r.grossCollected.value).toBe(35000);
    expect(r.processingFees.value).toBe(1045);
  });
  it("is independent of input arrival order", () => {
    expect(reconcileFinance([...duplicateRepresentations].reverse())).toEqual(reconcileFinance(duplicateRepresentations));
  });
  it("detects contradictory concurrent claims instead of first-wins", () => {
    const rows = [syntheticRepresentation(), syntheticRepresentation({ id: "synthetic-conflict", event: syntheticEvent({ amountCents: 15000 }) })];
    const r = reconcileFinance(rows);
    expect(r.counts.Conflict).toBe(1);
    expect(r.events).toEqual([]);
    expect(reconcileFinance([...rows].reverse())).toEqual(r);
  });
  it("keeps unlinked but verified receipts Unmatched", () => {
    const r = reconcileFinance([syntheticRepresentation({ event: syntheticEvent({ customerId: null, bookingId: null }) })]);
    expect(r.counts.Unmatched).toBe(1);
    expect(r.events).toHaveLength(1);
  });
  it("uses customer/booking UUID-like keys without any permanent numbers", () => {
    expect(reconcileFinance(duplicateRepresentations).events[0]?.bookingId).toBe("synthetic-booking-a");
  });
  it("does not merge same customer/amount/date without identity", () => {
    const r = reconcileFinance([syntheticRepresentation({ id: "synthetic-one", identities: [] }), syntheticRepresentation({ id: "synthetic-two", identities: [] })]);
    expect(r.counts.Incomplete).toBe(2);
    expect(r.events).toEqual([]);
  });
  it("does not use evidence hash alone as payment identity", () => {
    const r = reconcileFinance([syntheticRepresentation({ identities: [], evidenceHash: "synthetic-evidence-hash" })]);
    expect(r.counts.Incomplete).toBe(1);
  });
  it("uses verified manual transfer references scoped to method/account", () => {
    const manual = syntheticRepresentation({ source: "manual", identities: [], manualIdentity: { method: "zelle", account: "synthetic-bank", reference: "synthetic-transfer" }, event: syntheticEvent({ method: "zelle", feeCents: 0 }) });
    const r = reconcileFinance([manual, { ...manual, id: "synthetic-manual-retry" }]);
    expect(r.counts.Matched).toBe(1);
    expect(r.events).toHaveLength(1);
  });
  it("supports mixed methods and partial receipts for one customer", () => {
    const rows = [10000, 15000, 10000].map((amountCents, i) => syntheticRepresentation({ id: `synthetic-part-${i}`, source: "manual", identities: [],
      manualIdentity: { method: ["zelle", "venmo", "cash"][i], account: "synthetic-bank", reference: `synthetic-transfer-${i}` },
      event: syntheticEvent({ id: `synthetic-part-event-${i}`, amountCents, feeCents: 0, method: i === 0 ? "zelle" : i === 1 ? "venmo" : "cash" }) }));
    const r = reconcileFinance(rows);
    expect(r.events).toHaveLength(3);
    expect(summarizeFinance({ events: r.events, period, basis: "cash", currency: "USD", coverage: "complete" }).grossCollected.value).toBe(35000);
  });
  it.each(["missing", "unverified"] as const)("withholds %s manual evidence", evidence => {
    expect(reconcileFinance([syntheticRepresentation({ event: syntheticEvent({ evidence }) })]).counts.Incomplete).toBe(1);
  });
  it("fails closed on a shared identity with contradictory currency", () => {
    const r = reconcileFinance([syntheticRepresentation(), syntheticRepresentation({ id: "synthetic-euro", event: syntheticEvent({ currency: "EUR" }) })]);
    expect(r.counts.Conflict).toBe(1);
  });
  it("scopes provider IDs to account, environment and object type", () => {
    const identity = syntheticRepresentation().identities[0];
    if (!identity) throw new Error("Fixture missing identity");
    expect(new Set([identity, { ...identity, account: "synthetic-other" }, { ...identity, environment: "test" as const }, { ...identity, object: "invoice" as const }].map(providerIdentityKey)).size).toBe(4);
  });
  it("does not merge separate charges sharing an invoice", () => {
    const first = duplicateRepresentations[0];
    if (!first) throw new Error("Fixture missing representation");
    const second = { ...first, id: "synthetic-another-charge", identities: first.identities.map(i => i.object === "charge" ? { ...i, id: "synthetic-charge-b" } : i) };
    expect(reconcileFinance([first, second]).counts.Conflict).toBe(1);
  });
  it("flags two C1 identities claiming one payment", () => {
    const r = reconcileFinance([syntheticRepresentation({ c1TransactionId: "synthetic-ledger-one" }), syntheticRepresentation({ id: "synthetic-other", c1TransactionId: "synthetic-ledger-two" })]);
    expect(r.counts.Conflict).toBe(1);
  });
  it("joins contradictory retries by source-row identity", () => {
    expect(reconcileFinance([syntheticRepresentation({ identities: [] }), syntheticRepresentation({ identities: [], event: syntheticEvent({ amountCents: 100 }) })]).counts.Conflict).toBe(1);
  });
  it("does not collapse a refund into its original charge", () => {
    const row = syntheticRepresentation();
    const refund = syntheticRepresentation({ id: "synthetic-refund-row", event: syntheticEvent({ id: "synthetic-refund", kind: "refund", amountCents: 5000, relatedEventId: row.event.id, feeCents: undefined }) });
    const r = reconcileFinance([row, refund]);
    expect(r.events).toHaveLength(2);
    expect(r.events.find(e => e.kind === "refund")?.relatedEventId).toBe(row.id);
    expect(summarizeFinance({ events: r.events, period, basis: "cash", currency: "USD", coverage: "complete" }).netCollections.value).toBe(28955);
  });
  it("quarantines malformed provider identities", () => {
    const row = syntheticRepresentation();
    const r = reconcileFinance([{ ...row, identities: row.identities.map(i => ({ ...i, account: "" })) }]);
    expect(r.counts.Incomplete).toBe(1);
  });
  it("does not mutate supplied representations", () => {
    const before = JSON.stringify(duplicateRepresentations);
    reconcileFinance(duplicateRepresentations);
    expect(JSON.stringify(duplicateRepresentations)).toBe(before);
  });
});

describe("Dated synthetic vehicle allocations", () => {
  const allocations = [
    { vehicleId: "synthetic-vehicle-a", from: "2026-10-01", to: "2026-10-15", amountCents: 17500 },
    { vehicleId: "synthetic-vehicle-b", from: "2026-10-15", to: "2026-11-01", amountCents: 17500, swapId: "synthetic-swap-a" },
  ];
  it("validates explicit pre/post swap cents and half-open dates", () => {
    expect(validateVehicleAllocations(35000, period, allocations).state).toBe("Matched");
  });
  it("does not invent missing allocations", () => {
    expect(validateVehicleAllocations(35000, period, []).state).toBe("Incomplete");
  });
  it("rejects overlapping assignment dates", () => {
    expect(validateVehicleAllocations(35000, period, allocations.map((a, i) => i ? { ...a, from: "2026-10-14" } : a)).state).toBe("Conflict");
  });
  it("rejects unallocated gaps", () => {
    expect(validateVehicleAllocations(35000, period, allocations.map((a, i) => i ? { ...a, from: "2026-10-16" } : a)).state).toBe("Conflict");
  });
  it("requires amounts to reconcile to the cent", () => {
    expect(validateVehicleAllocations(35001, period, allocations).state).toBe("Conflict");
  });
  it("rejects fractional cents", () => {
    expect(validateVehicleAllocations(35000, period, allocations.map(a => ({ ...a, amountCents: 17500.5 }))).state).toBe("Conflict");
  });
});