import { FINANCE_SOURCES, type FinanceReadPlan, type FinanceSourceRow, type UnifiedFinanceRequest } from "../../src/lib/unified-finance-contract";
import { duplicateRepresentations, period, syntheticEvent, syntheticRepresentation } from "./unified-finance";
export const request: UnifiedFinanceRequest = { period, basis: "cash", currency: "USD" };
export const identity = { userId: "synthetic-staff", roles: ["admin"] };
export function sourceRow(overrides: Partial<FinanceSourceRow> = {}): FinanceSourceRow {
  return { id: "synthetic-row", visibility: "operating", representation: syntheticRepresentation(), ...overrides };
}
export function mockPlan(overrides: Partial<Record<typeof FINANCE_SOURCES[number], FinanceSourceRow[]>> = {}): FinanceReadPlan {
  return Object.fromEntries(FINANCE_SOURCES.map(source => [source, async () => ({ rows: overrides[source] ?? [], nextCursor: null })]));
}
export const duplicateRows = {
  stripe: [sourceRow({ id: "synthetic-provider", representation: duplicateRepresentations[0] })],
  payments: [sourceRow({ id: "synthetic-payment", representation: duplicateRepresentations[1] })],
  ledger: [sourceRow({ id: "synthetic-ledger", representation: duplicateRepresentations[2], posting: "posted" })],
};
export function refundRow(id: string, amountCents = 5000): FinanceSourceRow {
  return sourceRow({ id, representation: syntheticRepresentation({ id, identities: [{ provider: "stripe", environment: "synthetic", account: "synthetic-account", object: "refund", id }],
    event: syntheticEvent({ id, kind: "refund", amountCents, feeCents: undefined, relatedEventId: "synthetic-receipt-a" }) }) });
}