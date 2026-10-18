import type { AuthenticatedReadClient, LedgerRow, ProviderRow, SourceFacts, RawSources, RawPage } from "../../src/lib/unified-finance-source-contracts";
export const scope = { environment: "synthetic" as const, account: "synthetic-account" };
export const actor = { userId: "synthetic-owner", roles: ["admin"] };
export function facts(overrides: Partial<SourceFacts> = {}): SourceFacts {
  return { id: "synthetic-charge", kind: "collection", amountCents: 35000, currency: "USD", cashDate: "2026-10-18", recognitionDate: "2026-10-18", feeCents: 1045,
    status: "succeeded", verified: true, method: "stripe", customerId: "synthetic-customer", rentalId: "synthetic-rental", relatedEventId: null,
    identities: [{ provider: "stripe", ...scope, object: "charge", id: "synthetic-charge" }], ...overrides };
}
export const charge = (overrides: Partial<ProviderRow> = {}): ProviderRow => ({ ...facts(), object: "charge", parentChargeId: null, ...overrides });
export const ledger = (overrides: Partial<LedgerRow> = {}): LedgerRow => ({ ...facts(), id: "synthetic-c1", transactionId: "synthetic-c1", posting: "posted", direction: "in",
  visibility: "operating", reversesId: null, correctsId: null, paymentId: "synthetic-payment", expenseId: null, ...overrides });
export function client(pages: Partial<{ [S in keyof RawSources]: RawPage<RawSources[S]> }> = {}, roles: readonly string[] = ["admin"]): AuthenticatedReadClient {
  return { userId: actor.userId as string, authorization: "authenticated_rls", readCurrentRoles: async () => roles,
    readPage: async <S extends Exclude<keyof RawSources, "stripe">>(source: S) => (pages[source] ?? { rows: [], complete: true, nextCursor: null }) as RawPage<RawSources[S]> };
}