import type { FinanceEvent } from "../../src/lib/unified-finance";
import type { Representation } from "../../src/lib/unified-finance-reconciliation";

// Entirely invented data. No customer names, live IDs, API clients or ledger writes.
export const period = { from: "2026-10-01", to: "2026-11-01" };
export function syntheticEvent(overrides: Partial<FinanceEvent> = {}): FinanceEvent {
  return { id: "synthetic-receipt-a", kind: "collection", amountCents: 35000, currency: "USD", status: "succeeded",
    cashDate: "2026-10-08", recognitionDate: "2026-10-08", evidence: "verified", method: "stripe", feeCents: 1045,
    customerId: "synthetic-customer-a", bookingId: "synthetic-booking-a", ...overrides };
}
export const weeklyPayments = ["a", "b", "c"].map((suffix, i) => syntheticEvent({ id: `synthetic-week-${suffix}`, cashDate: `2026-10-${String(8 + i * 7).padStart(2, "0")}`, recognitionDate: `2026-10-${String(8 + i * 7).padStart(2, "0")}` }));
export const compensation = syntheticEvent({ id: "synthetic-compensation", kind: "customer_compensation", amountCents: 5000, method: "zelle", feeCents: undefined });
export function syntheticRepresentation(overrides: Partial<Representation> = {}): Representation {
  return { id: "synthetic-provider-row", source: "provider", event: syntheticEvent(),
    identities: [{ provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "charge", id: "synthetic-charge-a" }], ...overrides };
}
export const duplicateRepresentations: Representation[] = [
  syntheticRepresentation({ identities: [
    { provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "charge", id: "synthetic-charge-a" },
    { provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "invoice", id: "synthetic-invoice-a" },
    { provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "payment_intent", id: "synthetic-intent-a" },
  ] }),
  syntheticRepresentation({ id: "synthetic-operational-row", source: "operational", event: syntheticEvent({ id: "synthetic-operational-event", feeCents: undefined }), operationalPaymentId: "synthetic-payment-a",
    identities: [{ provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "payment_intent", id: "synthetic-intent-a" }] }),
  syntheticRepresentation({ id: "synthetic-c1-row", source: "c1", event: syntheticEvent({ id: "synthetic-c1-event", feeCents: undefined }), operationalPaymentId: "synthetic-payment-a", c1TransactionId: "synthetic-ledger-a", identities: [] }),
];