import { describe, expect, it } from "vitest";
import { pickupAmountCents, pickupPaymentDraft, pickupPaymentDraftIssues, PICKUP_PAYMENT_VERIFICATION_ENABLED, type PickupPaymentFact } from "../src/lib/pickup-payment";
const app = "11111111-1111-4111-8111-111111111111", car = "22222222-2222-4222-8222-222222222222", obligation = "33333333-3333-4333-8333-333333333333", evidence = "44444444-4444-4444-8444-444444444444";
const draft = { applicationId: app, vehicleId: car, obligationId: obligation, method: "zelle_bank" as const, otherMethod: null, amountCents: 35000, paidAt: "2026-11-09T18:00:00Z", payer: "Invented Renter", reference: "fixture-reference", evidenceReference: evidence, note: "Invented bank receipt reviewed" };
const scope = { applicationId: app, vehicleId: car, obligationId: obligation, sourceAccountReference: "fixture-account", currentFacts: [] as PickupPaymentFact[] };
describe("Mock-only multi-method payment review", () => {
  it("keeps live verification disabled", () => expect(PICKUP_PAYMENT_VERIFICATION_ENABLED).toBe(false));
  for (const method of ["stripe", "zelle_bank", "cash_app_venmo", "cash", "other"] as const) it(`accepts a fully evidenced ${method} draft without posting`, () => expect(pickupPaymentDraftIssues({ ...draft, method, otherMethod: method === "other" ? "Check" : null }, scope)).toEqual([]));
  it("Other needs the actual method name", () => expect(pickupPaymentDraft.safeParse({ ...draft, method: "other" }).success).toBe(false));
  it("method or checkbox alone cannot become verified", () => {
    for (const value of [{ method: "cash", paid: true }, { ...draft, verified: true }, { ...draft, actorId: app }, { ...draft, evidenceReference: null }]) expect(pickupPaymentDraft.safeParse(value).success).toBe(false);
  });
  it("preserves exact cents and refuses unknown/negative/fractional amounts", () => {
    expect(pickupAmountCents("350.01")).toBe(35001);
    expect(pickupAmountCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(pickupAmountCents("90071992547409.92")).toBeNull();
    for (const value of ["", "0", "-350", "350.001", "NaN", "unknown", "99999999999999999999"]) expect(pickupAmountCents(value)).toBeNull();
    for (const value of [null, 0, -1, 35000.5]) expect(pickupPaymentDraft.safeParse({ ...draft, amountCents: value }).success).toBe(false);
  });
  it("checks renter, final vehicle and obligation independently", () => {
    for (const key of ["applicationId", "vehicleId", "obligationId"] as const) expect(pickupPaymentDraftIssues({ ...draft, [key]: evidence }, scope)).toContain("Payment Does Not Match This Handoff");
  });
  it("refuses evidence already used by another renter", () => {
    const fact: PickupPaymentFact = { id: "fixture", ...draft, applicationId: car, status: "verified", sourceAccountReference: scope.sourceAccountReference };
    expect(pickupPaymentDraftIssues(draft, { ...scope, currentFacts: [fact] })).toContain("Payment Evidence Already Recorded; Review Existing Payment");
  });
  it("a refund/void does not free the same payment for recording again", () => {
    for (const status of ["refunded", "voided"] as const) expect(pickupPaymentDraftIssues(draft, { ...scope, currentFacts: [{ id: "fixture", ...draft, status, sourceAccountReference: scope.sourceAccountReference }] })).toContain("Payment Evidence Already Recorded; Review Existing Payment");
  });
  it("same reference in a different account is not assumed to be the same payment", () => {
    expect(pickupPaymentDraftIssues(draft, { ...scope, currentFacts: [{ id: "fixture", ...draft, evidenceReference: app, sourceAccountReference: "different-fixture-account", status: "proposed" }] })).toEqual([]);
    expect(pickupPaymentDraftIssues(draft, { ...scope, sourceAccountReference: "" })).toContain("Payment Source Account Required");
  });
  it("changing the method label cannot re-record the same account transaction", () => {
    expect(pickupPaymentDraftIssues({ ...draft, method: "cash_app_venmo" }, { ...scope, currentFacts: [{ id: "fixture", ...draft, evidenceReference: app, sourceAccountReference: scope.sourceAccountReference, status: "verified" }] })).toContain("Payment Evidence Already Recorded; Review Existing Payment");
  });
});